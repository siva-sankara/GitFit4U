import { nanoid } from "nanoid";
import { Conversation, Message } from "../models/Collaboration.js";
import { SupportTicket } from "../models/Engagement.js";
import { User } from "../models/User.js";
import { emitDomainEvent } from "./domainEventService.js";
import { AppError } from "../utils/AppError.js";

/** Idempotent, additive migration. Historical tickets and attachments remain intact. */
export async function ensureSupportConversation(ticket: any) {
  let conversation;
  try {
    conversation = await Conversation.findOneAndUpdate(
      { supportTicketId: ticket._id },
      {
        $setOnInsert: {
          publicId: nanoid(20),
          supportTicketId: ticket._id,
          gymId: ticket.gymId,
          type: "SUPPORT",
          title: ticket.subject,
          participants: [ticket.requesterId],
          lastMessageAt: ticket.updatedAt || ticket.createdAt,
        },
      },
      { upsert: true, returnDocument: "after", setDefaultsOnInsert: true },
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    conversation = await Conversation.findOne({ supportTicketId: ticket._id });
    if (!conversation) throw error;
  }
  // Existing ticket entries have stable Mongo subdocument IDs. A retry never duplicates history.
  const historical = (ticket.messages || []).map(
    (entry: any, index: number) => ({
      updateOne: {
        filter: {
          senderId: entry.authorId || ticket.requesterId,
          clientMessageId: `support:${ticket._id}:${entry._id || index}`,
        },
        update: {
          $setOnInsert: {
            publicId: nanoid(20),
            conversationId: conversation._id,
            senderId: entry.authorId || ticket.requesterId,
            clientMessageId: `support:${ticket._id}:${entry._id || index}`,
            text: entry.body,
            type: "TEXT",
            attachments: (entry.attachments || [])
              .filter((url: string) => /^https:\/\//.test(url))
              .map((url: string) => ({ url, name: "Support attachment" })),
            createdAt: entry.createdAt || ticket.createdAt,
            updatedAt: entry.createdAt || ticket.createdAt,
          },
        },
        upsert: true,
        timestamps: false,
      },
    }),
  );
  for (let offset = 0; offset < historical.length; offset += 100) {
    try {
      await Message.bulkWrite(historical.slice(offset, offset + 100), {
        ordered: false,
      });
    } catch (error: any) {
      // Concurrent first opens may insert the same historical rows. The unique
      // sender/client key arbitrates safely; never ignore other write errors.
      if (
        error?.code !== 11000 ||
        error.writeErrors?.some((entry: any) => entry.code !== 11000)
      )
        throw error;
    }
  }
  const latest = await Message.findOne({
    conversationId: conversation._id,
  }).sort({ createdAt: -1, _id: -1 });
  if (latest)
    await Conversation.updateOne(
      {
        _id: conversation._id,
        $or: [
          { lastMessageAt: { $lte: latest.createdAt } },
          { lastMessageId: null },
        ],
      },
      { $set: { lastMessageId: latest._id, lastMessageAt: latest.createdAt } },
    );
  return conversation;
}

export async function bridgeSupportTicket(ticketId: string) {
  const ticket = await SupportTicket.findOne({ publicId: ticketId });
  return ticket ? ensureSupportConversation(ticket) : null;
}

export async function notifySupportCreated(
  ticket: any,
  conversationId: string,
) {
  const admins = await User.find({ roles: "ADMIN", status: "ACTIVE" })
    .select("_id")
    .limit(100)
    .lean();
  await Promise.all(
    admins.map((user) =>
      emitDomainEvent({
        event: "support.updated",
        userId: user._id,
        entityId: String(ticket._id),
        occurrenceId: "created",
        actionUrl: `/messages?conversation=${conversationId}`,
      }),
    ),
  );
}

/** Notify a persisted legacy reply using its stable subdocument id, never a timestamp. */
export async function notifySupportReply(
  ticket: any,
  conversationId: string,
  reply: { _id?: unknown; authorId?: unknown } | undefined,
) {
  if (!reply?._id || !reply.authorId)
    throw new AppError(409, "SUPPORT_REPLY_NOT_SAVED", "Save the support reply before notifying participants.");
  const senderId = String(reply.authorId);
  const requesterId = String(ticket.requesterId);
  const fromRequester = senderId === requesterId;
  if (!fromRequester && !(await User.exists({ _id: reply.authorId, roles: "ADMIN", status: "ACTIVE" })))
    throw new AppError(403, "SUPPORT_REPLY_FORBIDDEN", "Only the requester or support administrators may reply.");
  const recipients = fromRequester
    ? await User.find({ roles: "ADMIN", status: "ACTIVE", _id: { $ne: reply.authorId } }).select("_id").limit(100).lean()
    : [{ _id: ticket.requesterId }];
  await Promise.all(recipients.map((recipient) => emitDomainEvent({
    event: "support.updated",
    userId: recipient._id,
    gymId: ticket.gymId,
    entityId: String(ticket._id),
    occurrenceId: `reply:${reply._id}`,
    actionUrl: `/messages/${encodeURIComponent(conversationId)}`,
  })));
}
