import mongoose from "mongoose";
import type { Request, Response } from "express";
import { z } from "zod";
import { SupportTicket } from "../models/Engagement.js";
import { User } from "../models/User.js";
import { AuditLog } from "../models/Operations.js";
import { authorizedConversation } from "./messagingController.js";
import { emitDomainEvent } from "../services/domainEventService.js";
import { AppError } from "../utils/AppError.js";

const manager = (req: Request) => req.auth!.role === "ADMIN" && req.auth!.permissions.includes("admin:platform");
const workflow = z.object({
  status: z.enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"]).optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(),
  assignedTo: z.string().regex(/^[a-f\d]{24}$/i).nullable().optional(),
}).strict().refine(body => Object.keys(body).length > 0, "Choose a change.");

export async function supportManagement(req: Request, res: Response) {
  if (!manager(req)) throw new AppError(403, "SUPPORT_ADMIN_REQUIRED", "Support administration permission is required.");
  const conversation = await authorizedConversation(String(req.params.id), req.auth!);
  if (conversation.type !== "SUPPORT" || !conversation.supportTicketId) throw new AppError(404, "TICKET_NOT_FOUND", "Support ticket not found.");
  const [ticket, assignees] = await Promise.all([
    SupportTicket.findById(conversation.supportTicketId._id).select("+internalNotes").populate("internalNotes.authorId", "name publicId").lean(),
    User.find({ roles: "ADMIN", status: "ACTIVE" }).select("_id publicId name").sort({ name: 1 }).limit(100).lean(),
  ]);
  res.json({ success: true, data: { notes: ticket?.internalNotes || [], assignees } });
}

export async function updateSupportWorkflow(req: Request, res: Response) {
  const input = workflow.parse(req.body);
  if (!manager(req) && !(input.status === "OPEN" && Object.keys(input).length === 1))
    throw new AppError(403, "STATUS_FORBIDDEN", "Only support administrators can make that change.");
  const result = await mongoose.connection.transaction(async session => {
    const conversation = await authorizedConversation(String(req.params.id), req.auth!, session);
    if (conversation.type !== "SUPPORT" || !conversation.supportTicketId) throw new AppError(404, "TICKET_NOT_FOUND", "Support ticket not found.");
    // Serialize workflow edits with other ticket edits, without trusting client roles.
    const ticket = await SupportTicket.findOneAndUpdate({ _id: conversation.supportTicketId._id }, { $inc: { revision: 1 } }, { session, returnDocument: "after" });
    if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "Support ticket not found.");
    if (!manager(req) && !(input.status === "OPEN" && Object.keys(input).length === 1 && ["RESOLVED", "CLOSED", "OPEN"].includes(ticket.status)))
      throw new AppError(403, "STATUS_FORBIDDEN", "Only support administrators can make that change.");
    if (input.assignedTo && !await User.exists({ _id: input.assignedTo, roles: "ADMIN", status: "ACTIVE" }).session(session))
      throw new AppError(422, "ASSIGNEE_UNAVAILABLE", "Choose an active support administrator.");
    const changes: { type: string; actorId: string; from: string; to: string; at: Date }[] = [];
    for (const field of ["status", "priority", "assignedTo"] as const) {
      if (input[field] === undefined || String(ticket[field] || "") === String(input[field] || "")) continue;
      changes.push({ type: field === "assignedTo" ? "ASSIGNMENT" : field.toUpperCase(), actorId: req.auth!.userId,
        from: String(ticket[field] || ""), to: String(input[field] || ""), at: new Date() });
      ticket[field] = input[field];
    }
    if (!changes.length) return { status: ticket.status, duplicate: true };
    ticket.activity.push(...changes);
    await ticket.save({ session });
    await AuditLog.create([{ actorId: req.auth!.userId, actorRole: req.auth!.role, action: "SUPPORT_WORKFLOW_UPDATED",
      entityType: "SupportTicket", entityId: ticket.publicId, outcome: "SUCCESS", after: input }], { session });
    const recipients = new Set([String(ticket.requesterId), ...(ticket.assignedTo ? [String(ticket.assignedTo)] : [])]);
    if (!manager(req) && !ticket.assignedTo) {
      for (const admin of await User.find({ roles: "ADMIN", status: "ACTIVE" }).select("_id").limit(100).session(session)) recipients.add(String(admin._id));
    }
    recipients.delete(req.auth!.userId);
    for (const userId of recipients) await emitDomainEvent({ event: "support.updated", userId, entityId: String(ticket._id),
      occurrenceId: `workflow:${ticket.revision}`, actionUrl: `/notifications`, session });
    return { status: ticket.status, duplicate: false };
  });
  res.json({ success: true, data: result });
}

export async function addInternalNote(req: Request, res: Response) {
  if (!manager(req)) throw new AppError(403, "SUPPORT_ADMIN_REQUIRED", "Support administration permission is required.");
  const input = z.object({ key: z.string().uuid(), body: z.string().trim().min(1).max(5000) }).strict().parse(req.body);
  const conversation = await authorizedConversation(String(req.params.id), req.auth!);
  if (conversation.type !== "SUPPORT" || !conversation.supportTicketId) throw new AppError(404, "TICKET_NOT_FOUND", "Support ticket not found.");
  const result = await SupportTicket.updateOne({ _id: conversation.supportTicketId._id, "internalNotes.key": { $ne: input.key } },
    { $push: { internalNotes: { ...input, authorId: req.auth!.userId, at: new Date() } } });
  if (!result.modifiedCount) {
    const same = await SupportTicket.exists({ _id: conversation.supportTicketId._id, internalNotes: { $elemMatch: { key: input.key, authorId: req.auth!.userId, body: input.body } } });
    if (!same) throw new AppError(409, "NOTE_KEY_REUSED", "Use a new identifier for a different internal note.");
  }
  res.json({ success: true, data: { saved: true } });
}
