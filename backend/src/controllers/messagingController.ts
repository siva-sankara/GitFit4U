import type { Request, Response } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { Conversation, Message } from "../models/Collaboration.js";
import { SupportTicket, Campaign } from "../models/Engagement.js";
import { User } from "../models/User.js";
import { Attachment } from "../models/Business.js";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";
import { AppError } from "../utils/AppError.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import { assertAllowedParticipants, conversationPeople, searchContacts } from "../services/contactService.js";
import { ensureSupportConversation } from "../services/supportConversationService.js";
import { emitDomainEvent } from "../services/domainEventService.js";
import { writeAudit } from "../services/auditService.js";
import { withGymMedia } from "../services/gymMediaService.js";
import { withUserMedia } from "../services/userMediaService.js";
import { lockAttachments } from "../services/mediaBindingService.js";
import { Gym } from "../models/Gym.js";

export async function authorizedConversation(
  publicId: string,
  auth: NonNullable<Request["auth"]>,
  session?: ClientSession,
) {
  const query = Conversation.findOne({ publicId });
  if (session) query.session(session);
  const conversation = await query.populate(
    "supportTicketId",
    "requesterId status subject",
  );
  if (!conversation)
    throw new AppError(
      404,
      "CONVERSATION_NOT_FOUND",
      "Conversation not found.",
    );
  const allowed =
    conversation.type === "SUPPORT" && conversation.supportTicketId
      ? auth.role === "ADMIN" ||
        String(conversation.supportTicketId?.requesterId) === auth.userId
      : conversation.participants.some((id: any) => String(id) === auth.userId);
  if (!allowed)
    throw new AppError(
      404,
      "CONVERSATION_NOT_FOUND",
      "Conversation not found.",
    );
  return conversation;
}

export async function listConversations(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const supportOnly = req.query.type === "SUPPORT";
  const archived = req.query.archived === "true";
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  const regex = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : null;
  let migratedIds: any[] = [];
  let supportTotal = 0;
  if (supportOnly) {
    const ticketFilter: any = {
      ...(req.auth!.role === "ADMIN" ? {} : { requesterId: req.auth!.userId }),
      ...(regex ? { subject: regex } : {}),
    };
    const tickets = await SupportTicket.find(ticketFilter)
      .sort({ updatedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit);
    migratedIds = (
      await Promise.all(tickets.map(ensureSupportConversation))
    ).map((row) => row._id);
    supportTotal = await SupportTicket.countDocuments(ticketFilter);
  }
  const supportIds =
    req.auth!.role === "ADMIN"
      ? null
      : await SupportTicket.distinct("_id", { requesterId: req.auth!.userId });
  const visibility =
    req.auth!.role === "ADMIN"
      ? {
          $or: [
            { participants: req.auth!.userId, type: { $ne: "SUPPORT" } },
            { type: "SUPPORT" },
          ],
        }
      : {
          $or: [
            { participants: req.auth!.userId, type: { $ne: "SUPPORT" } },
            { type: "SUPPORT", supportTicketId: { $in: supportIds } },
            {
              type: "SUPPORT",
              supportTicketId: null,
              participants: req.auth!.userId,
            },
          ],
        };
  const searchClause = regex && !supportOnly
    ? { $or: [
        { title: regex },
        {
          participants: {
            $in: await User.distinct("_id", {
              $or: [{ name: regex }, { email: regex }, { phone: regex }],
            }),
          },
        },
        { gymId: { $in: await Gym.distinct("_id", { name: regex }) } },
      ] }
    : null;
  const filter = { $and: [
    visibility,
    supportOnly ? { type: "SUPPORT", _id: { $in: migratedIds } } : { archivedBy: archived ? req.auth!.userId : { $ne: req.auth!.userId } },
    ...(searchClause ? [searchClause] : []),
  ] };
  const [data, total] = await Promise.all([
    Conversation.find(filter)
      .populate("participants", "publicId name avatarUrl avatarAttachmentId")
      .populate("gymId", "publicId name logoUrl logoAttachmentId")
      .populate("supportTicketId", "publicId subject status priority requesterId createdAt updatedAt")
      .populate("lastMessageId", "text createdAt deletedAt senderId")
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip(supportOnly ? 0 : skip)
      .limit(limit)
      .lean(),
    supportOnly ? Promise.resolve(supportTotal) : Conversation.countDocuments(filter),
  ]);
  const counts = data.length
    ? await Message.aggregate([
        {
          $match: {
            conversationId: { $in: data.map((row) => row._id) },
            senderId: { $ne: new mongoose.Types.ObjectId(req.auth!.userId) },
            deletedAt: null,
            "readBy.userId": {
              $ne: new mongoose.Types.ObjectId(req.auth!.userId),
            },
          },
        },
        { $group: { _id: "$conversationId", count: { $sum: 1 } } },
      ])
    : [];
  const unread = new Map(counts.map((row) => [String(row._id), row.count]));
  const gyms = await withGymMedia(data.map((row) => row.gymId).filter(Boolean));
  const people = await conversationPeople(req,
    data.flatMap((row) => row.participants).filter(Boolean),
  );
  res.json({
    success: true,
    data: data.map((row) => ({
      ...row,
      participants: row.participants
        .filter(Boolean)
        .map(
          (person: any) =>
            people.find((value) => String(value._id) === String(person._id)) ||
            person,
        ),
      gymId:
        gyms.find((gym) => String(gym._id) === String(row.gymId?._id)) ||
        row.gymId,
      unreadCount: unread.get(String(row._id)) || 0,
    })),
    meta: pageMeta(page, limit, total),
  });
}

export async function createConversation(req: Request, res: Response) {
  await assertAllowedParticipants(req, req.body.participantIds);
  const participantIds = [
    ...new Set<string>([req.auth!.userId, ...req.body.participantIds]),
  ].map((id) => new mongoose.Types.ObjectId(id));
  if (
    participantIds.length < 2 ||
    (req.body.type === "DIRECT" && participantIds.length !== 2)
  )
    throw new AppError(
      400,
      "PARTICIPANTS_REQUIRED",
      "A direct conversation requires exactly one other contact.",
    );
  if (req.body.type === "DIRECT") {
    const existing = await Conversation.findOne({
      type: "DIRECT",
      participants: { $all: participantIds, $size: 2 },
    });
    if (existing) {
      await Conversation.updateOne(
        { _id: existing._id },
        { $pull: { archivedBy: req.auth!.userId } },
      );
      return res.json({ success: true, data: existing });
    }
  }
  const directKey =
    req.body.type === "DIRECT"
      ? participantIds.map(String).sort().join(":")
      : undefined;
  let data;
  try {
    data = await Conversation.create({
      publicId: nanoid(20),
      gymId: req.auth!.gymId,
      type: req.body.type,
      title: req.body.title,
      participants: participantIds,
      directKey,
      lastMessageAt: new Date(),
    });
  } catch (error: any) {
    if (error?.code !== 11000 || !directKey) throw error;
    data = await Conversation.findOne({ directKey });
    if (!data) throw error;
    await Conversation.updateOne({ _id: data._id }, { $pull: { archivedBy: req.auth!.userId } });
    return res.json({ success: true, data });
  }
  res.status(201).json({ success: true, data });
}

export async function conversationDetails(req: Request, res: Response) {
  const conversation = await authorizedConversation(
    String(req.params.id),
    req.auth!,
  );
  await conversation.populate(
    "participants",
    "publicId name avatarUrl avatarAttachmentId",
  );
  await conversation.populate(
    "gymId",
    "publicId name logoUrl logoAttachmentId",
  );
  const data = conversation.toObject();
  res.json({
    success: true,
    data: {
      ...data,
      participants: await conversationPeople(req, data.participants),
      gymId: data.gymId ? (await withGymMedia([data.gymId]))[0] : data.gymId,
    },
  });
}

export async function listMessages(req: Request, res: Response) {
  const conversation = await authorizedConversation(
    String(req.params.id),
    req.auth!,
  );
  const limit = Math.min(
    Math.max(Math.floor(Number(req.query.limit)) || 30, 1),
    100,
  );
  const filter: Record<string, unknown> = { conversationId: conversation._id };
  if (req.query.before) {
    const [timestamp, id] = String(req.query.before).split("|");
    const before = new Date(timestamp);
    if (
      !Number.isFinite(before.getTime()) ||
      (id && !mongoose.isValidObjectId(id))
    )
      throw new AppError(
        400,
        "INVALID_CURSOR",
        "Invalid message history cursor.",
      );
    Object.assign(
      filter,
      id
        ? {
            $or: [
              { createdAt: { $lt: before } },
              {
                createdAt: before,
                _id: { $lt: new mongoose.Types.ObjectId(id) },
              },
            ],
          }
        : { createdAt: { $lt: before } },
    );
  }
  const data = await Message.find(filter)
    .populate("senderId", "publicId name avatarUrl avatarAttachmentId")
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit + 1)
    .lean();
  const keys = data
    .flatMap((row) => (row.attachments || []).map((item: any) => item.key))
    .filter(Boolean);
  const files = keys.length
    ? await Attachment.find({
        $or: [{ publicId: { $in: keys } }, { objectKey: { $in: keys } }],
        purpose: "MESSAGE",
        status: "READY",
        deletedAt: null,
      })
    : [];
  const urls = new Map(
    files.flatMap((file) => [
      [file.publicId, attachmentUrl(file)],
      [file.objectKey, attachmentUrl(file)],
    ]),
  );
  const senders = await withUserMedia(
    data.map((row) => row.senderId).filter(Boolean),
  );
  for (const row of data) {
    row.senderId =
      senders.find(
        (value) => String(value._id) === String(row.senderId?._id),
      ) || row.senderId;
    if (row.deletedAt) {
      row.text = "";
      row.attachments = [];
      continue;
    }
    row.attachments = (row.attachments || [])
      .map((item: any) => ({
        ...item,
        url: item.key ? urls.get(item.key) : item.url,
      }))
      .filter((item: any) => /^https?:\/\//.test(item.url || ""));
  }
  const hasMore = data.length > limit,
    last = data[limit - 1];
  res.json({
    success: true,
    data: data.slice(0, limit).reverse(),
    meta: {
      hasMore,
      nextCursor: hasMore
        ? `${last.createdAt.toISOString()}|${last._id}`
        : null,
    },
  });
}

export async function listContacts(req: Request, res: Response) {
  const { page, limit } = paginationFromQuery(req.query);
  const { data, total } = await searchContacts(req, { q: String(req.query.q || ""), page, limit });
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}

export async function sendMessage(req: Request, res: Response) {
  let conversation = await authorizedConversation(
    String(req.params.id),
    req.auth!,
  );
  if (conversation.type === "SYSTEM" || req.body.type === "SYSTEM")
    throw new AppError(403, "SYSTEM_CONVERSATION_READ_ONLY", "System receipts are read-only.");
  if (
    conversation.type === "SUPPORT" &&
    ["RESOLVED", "CLOSED"].includes(conversation.supportTicketId?.status)
  )
    throw new AppError(
      409,
      "SUPPORT_CLOSED",
      "Reopen this support conversation before replying.",
    );
  const attachmentKeys = [
    ...new Set<string>(
      (req.body.attachments || []).map((item: any) => item.key),
    ),
  ];
  let attachments: Array<{ key: string; name: string; mimeType: string; size: number }> = [];
  const persist = async (session?: ClientSession) => {
  if (session) {
    conversation = await authorizedConversation(String(req.params.id), req.auth!, session);
    if (conversation.type === "SUPPORT" && ["RESOLVED", "CLOSED"].includes(conversation.supportTicketId?.status))
      throw new AppError(409, "SUPPORT_CLOSED", "Reopen this support conversation before replying.");
  }
  const mediaQuery = attachmentKeys.length
    ? Attachment.find({
        ownerId: req.auth!.userId,
        purpose: "MESSAGE",
        status: "READY",
        deletedAt: null,
        $or: [
          { publicId: { $in: attachmentKeys } },
          { objectKey: { $in: attachmentKeys } },
        ],
      }) : null;
  if (session && mediaQuery) mediaQuery.session(session);
  const media = mediaQuery ? await mediaQuery : [];
  if (media.length !== attachmentKeys.length)
    throw new AppError(
      422,
      "ATTACHMENT_UNAVAILABLE",
      "Upload your message attachments before sending.",
    );
  // Private media URLs expire; persist stable identities and resolve URLs on authorized reads.
  attachments = media.map((item) => ({
    key: item.publicId,
    name: item.originalName,
    mimeType: item.mimeType,
    size: item.size,
  }));
  if (session) await lockAttachments(media.map((item) => item._id), session);
  const input = {
    publicId: nanoid(20),
    conversationId: conversation._id,
    senderId: req.auth!.userId,
    clientMessageId: req.body.clientMessageId,
    type: req.body.type || "TEXT",
    text: req.body.text,
    attachments,
    readBy: [{ userId: req.auth!.userId, at: new Date() }],
  };
  return session ? (await Message.create([input], { session }))[0] : await Message.create(input);
  };
  let message,
    created = true;
  try {
    message = attachmentKeys.length
      ? await mongoose.connection.transaction((session) => persist(session))
      : await persist();
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    message = await Message.findOne({
      conversationId: conversation._id,
      senderId: req.auth!.userId,
      clientMessageId: req.body.clientMessageId,
    });
    if (
      !message ||
      (message.text || "") !== (req.body.text || "") ||
      JSON.stringify(
        message.attachments.map((item: any) => item.key).sort(),
      ) !== JSON.stringify(attachments.map((item) => item.key).sort()) ||
      message.deletedAt
    )
      throw new AppError(
        409,
        "MESSAGE_ID_CONFLICT",
        "Use a new message identifier.",
      );
    created = false;
  }
  await Conversation.updateOne(
    {
      _id: conversation._id,
      $or: [
        { lastMessageAt: { $lte: message!.createdAt } },
        { lastMessageId: null },
      ],
    },
    {
      $set: {
        lastMessageId: message!._id,
        lastMessageAt: message!.createdAt,
      },
    },
  );
  if (conversation.type === "SUPPORT" && conversation.supportTicketId) {
    await Conversation.updateOne(
      { _id: conversation._id },
      { $addToSet: { participants: req.auth!.userId } },
    );
    await SupportTicket.updateOne(
      { _id: conversation.supportTicketId._id },
      {
        $set: {
          updatedAt: new Date(),
          status:
            req.auth!.role === "ADMIN" ? "WAITING_FOR_USER" : "IN_PROGRESS",
        },
      },
    );
  }
  const recipients =
    conversation.type === "SUPPORT" && conversation.supportTicketId
      ? req.auth!.role === "ADMIN"
        ? [conversation.supportTicketId.requesterId]
        : (
            await User.find({ roles: "ADMIN", status: "ACTIVE" })
              .select("_id")
              .limit(100)
              .lean()
          ).map((user) => user._id)
      : conversation.participants;
  await Promise.all(
    recipients
      .filter((id: any) => String(id) !== req.auth!.userId)
      .map((userId: any) =>
        emitDomainEvent({
          event:
            conversation.type === "SUPPORT"
              ? "support.updated"
              : "message.received",
          userId,
          gymId: conversation.gymId,
          entityId: message!.publicId,
          actionUrl: `/messages/${conversation.publicId}`,
        }),
      ),
  );
  if (created)
    req.app
      .get("io")
      ?.to(`conversation:${conversation.publicId}`)
      .emit("message.created", message);
  res.status(created ? 201 : 200).json({ success: true, data: message });
}

export async function markRead(req: Request, res: Response) {
  const conversation = await authorizedConversation(
    String(req.params.id),
    req.auth!,
  );
  const at = new Date();
  await Message.updateMany(
    {
      conversationId: conversation._id,
      "readBy.userId": { $ne: req.auth!.userId },
    },
    { $push: { readBy: { userId: req.auth!.userId, at } } },
  );
  req.app
    .get("io")
    ?.to(`conversation:${conversation.publicId}`)
    .emit("conversation.read", {
      conversationId: conversation.publicId,
      userId: req.auth!.userId,
    });
  res.json({
    success: true,
    data: { conversationId: conversation.publicId, readAt: at },
  });
}

export async function archiveConversation(req: Request, res: Response) {
  const conversation = await authorizedConversation(
    String(req.params.id),
    req.auth!,
  );
  await Conversation.updateOne(
    { _id: conversation._id },
    { $addToSet: { archivedBy: req.auth!.userId } },
  );
  res.json({ success: true, data: { archived: true, scope: "FOR_ME" } });
}

export async function restoreConversation(req: Request, res: Response) {
  const conversation = await authorizedConversation(
    String(req.params.id),
    req.auth!,
  );
  await Conversation.updateOne(
    { _id: conversation._id },
    { $pull: { archivedBy: req.auth!.userId } },
  );
  res.json({ success: true, data: { archived: false, scope: "FOR_ME" } });
}

export async function deleteMessage(req: Request, res: Response) {
  const conversation = await authorizedConversation(
    String(req.params.id),
    req.auth!,
  );
  const data = await Message.findOneAndUpdate(
    {
      publicId: req.params.messageId,
      conversationId: conversation._id,
      senderId: req.auth!.userId,
      type: { $ne: "SYSTEM" },
    },
    { $set: { text: "", attachments: [], deletedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!data)
    throw new AppError(
      404,
      "MESSAGE_NOT_FOUND",
      "You can only delete your own messages.",
    );
  await writeAudit(req, {
    action: "MESSAGE_DELETE_FOR_EVERYONE",
    entityType: "Message",
    entityId: data.publicId,
  });
  req.app
    .get("io")
    ?.to(`conversation:${conversation.publicId}`)
    .emit("message.deleted", { publicId: data.publicId });
  res.json({ success: true, data });
}

export async function updateSupportStatus(req: Request, res: Response) {
  const conversation = await authorizedConversation(
    String(req.params.id),
    req.auth!,
  );
  const ticket = conversation.supportTicketId;
  if (!ticket)
    throw new AppError(
      400,
      "NOT_SUPPORT",
      "This is not a support conversation.",
    );
  if (ticket.status === req.body.status)
    return res.json({ success: true, data: { status: ticket.status } });
  if (
    req.auth!.role !== "ADMIN" &&
    !(
      req.body.status === "OPEN" &&
      ["CLOSED", "RESOLVED"].includes(ticket.status)
    )
  )
    throw new AppError(
      403,
      "STATUS_FORBIDDEN",
      "Only support staff can set that status.",
    );
  await SupportTicket.updateOne(
    { _id: ticket._id },
    { $set: { status: req.body.status } },
  );
  await writeAudit(req, {
    action: "SUPPORT_STATUS_UPDATED",
    entityType: "SupportTicket",
    entityId: String(ticket._id),
    after: { status: req.body.status },
  });
  await emitDomainEvent({
    event: "support.updated",
    userId: ticket.requesterId,
    entityId: String(ticket._id),
    occurrenceId: `${ticket.status}:${req.body.status}:${Date.now()}`,
    actionUrl: `/messages/${conversation.publicId}`,
  });
  res.json({ success: true, data: { status: req.body.status } });
}

export async function listBroadcasts(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { scope: "PLATFORM" };
  const [data, total] = await Promise.all([
    Campaign.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .select("publicId name audience message status analytics createdAt")
      .lean(),
    Campaign.countDocuments(filter),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}

export async function createBroadcast(req: Request, res: Response) {
  const key = `admin:${req.auth!.userId}:${req.body.idempotencyKey}`;
  const existing = await Campaign.findOne({ idempotencyKey: key });
  if (existing) {
    if (
      existing.name !== req.body.name ||
      existing.message !== req.body.message ||
      JSON.stringify(existing.audience?.roles) !==
        JSON.stringify(req.body.roles)
    )
      throw new AppError(
        409,
        "BROADCAST_KEY_REUSED",
        "This submission identifier was already used for another announcement.",
      );
    return res.json({ success: true, data: existing });
  }
  let data;
  try {
    data = await Campaign.create({
      publicId: nanoid(20),
      createdBy: req.auth!.userId,
      scope: "PLATFORM",
      idempotencyKey: key,
      name: req.body.name,
      message: req.body.message,
      channel: "IN_APP",
      audience: { roles: req.body.roles },
      audienceSnapshot: { createdBefore: new Date() },
      status: "QUEUED",
    });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    const duplicate = await Campaign.findOne({ idempotencyKey: key });
    if (!duplicate) throw error;
    if (
      duplicate.name !== req.body.name ||
      duplicate.message !== req.body.message ||
      JSON.stringify(duplicate.audience?.roles) !==
        JSON.stringify(req.body.roles)
    )
      throw new AppError(
        409,
        "BROADCAST_KEY_REUSED",
        "This submission identifier was already used.",
      );
    return res.json({ success: true, data: duplicate });
  }
  await writeAudit(req, {
    action: "ADMIN_ANNOUNCEMENT_QUEUED",
    entityType: "Campaign",
    entityId: data.publicId,
    after: { roles: req.body.roles },
  });
  res.status(202).json({ success: true, data });
}
