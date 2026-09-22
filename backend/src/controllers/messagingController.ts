import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Conversation, Message } from "../models/Collaboration.js";
import { AppError } from "../utils/AppError.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import { allowedContacts } from "../services/contactService.js";

async function authorizedConversation(publicId: string, userId: string) {
  const conversation = await Conversation.findOne({ publicId, participants: userId });
  if (!conversation) throw new AppError(404, "CONVERSATION_NOT_FOUND", "Conversation not found.");
  return conversation;
}

export async function listConversations(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { participants: req.auth!.userId, archivedBy: { $ne: req.auth!.userId } };
  const [data, total] = await Promise.all([
    Conversation.find(filter).populate("participants", "publicId name avatarUrl activeRole").populate("lastMessageId").sort({ lastMessageAt: -1 }).skip(skip).limit(limit).lean(),
    Conversation.countDocuments(filter)
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}

export async function createConversation(req: Request, res: Response) {
  const allowed = new Set((await allowedContacts(req)).map(user => String(user._id)));
  if (req.body.participantIds.some((id: string) => id !== req.auth!.userId && !allowed.has(id))) throw new AppError(403, "PARTICIPANT_FORBIDDEN", "Select a contact assigned to your gym or account.");
  const participantIds = [...new Set([req.auth!.userId, ...req.body.participantIds])].map(id => new mongoose.Types.ObjectId(id));
  if (participantIds.length < 2) throw new AppError(400, "PARTICIPANTS_REQUIRED", "Select at least one other participant.");
  if (req.body.type === "DIRECT") {
    const existing = await Conversation.findOne({ type: "DIRECT", gymId: req.auth!.gymId || null, participants: { $all: participantIds, $size: participantIds.length } });
    if (existing) return res.json({ success: true, data: existing });
  }
  const data = await Conversation.create({ publicId: nanoid(20), gymId: req.auth!.gymId, type: req.body.type, title: req.body.title, participants: participantIds, lastMessageAt: new Date() });
  res.status(201).json({ success: true, data });
}

export async function listMessages(req: Request, res: Response) {
  const conversation = await authorizedConversation(String(req.params.id), req.auth!.userId);
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const filter: Record<string, unknown> = { conversationId: conversation._id, deletedAt: null };
  if (req.query.before) filter.createdAt = { $lt: new Date(String(req.query.before)) };
  const data = await Message.find(filter).populate("senderId", "publicId name avatarUrl").sort({ createdAt: -1 }).limit(limit + 1).lean();
  const hasMore = data.length > limit; const items = data.slice(0, limit).reverse();
  res.json({ success: true, data: items, meta: { hasMore, nextCursor: hasMore ? data[limit - 1].createdAt : null } });
}

export async function sendMessage(req: Request, res: Response) {
  const conversation = await authorizedConversation(String(req.params.id), req.auth!.userId);
  let message;
  try {
    message = await Message.create({ publicId: nanoid(20), conversationId: conversation._id, senderId: req.auth!.userId, clientMessageId: req.body.clientMessageId, type: req.body.type || "TEXT", text: req.body.text, attachments: req.body.attachments || [], readBy: [{ userId: req.auth!.userId, at: new Date() }] });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    message = await Message.findOne({ conversationId: conversation._id, senderId: req.auth!.userId, clientMessageId: req.body.clientMessageId });
    if (!message) throw new AppError(409, "MESSAGE_ID_CONFLICT", "Use a new message identifier.");
  }
  await Conversation.updateOne({ _id: conversation._id }, { $set: { lastMessageId: message!._id, lastMessageAt: message!.createdAt } });
  req.app.get("io")?.to(`conversation:${conversation.publicId}`).emit("message.created", message);
  res.status(201).json({ success: true, data: message });
}

export async function markRead(req: Request, res: Response) {
  const conversation = await authorizedConversation(String(req.params.id), req.auth!.userId);
  await Message.updateMany({ conversationId: conversation._id, "readBy.userId": { $ne: req.auth!.userId } }, { $push: { readBy: { userId: req.auth!.userId, at: new Date() } } });
  req.app.get("io")?.to(`conversation:${conversation.publicId}`).emit("conversation.read", { conversationId: conversation.publicId, userId: req.auth!.userId });
  res.json({ success: true, data: { conversationId: conversation.publicId, readAt: new Date() } });
}
