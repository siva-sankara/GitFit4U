import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { RoleAssignment } from "../models/Auth.js";
import { Campaign } from "../models/Engagement.js";
import { User } from "../models/User.js";
import {
  WhatsAppConnection,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppOutbox,
  WhatsAppWebhookReceipt,
} from "../models/WhatsApp.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import { emitDomainEvents } from "./domainEventService.js";
import {
  maskedWhatsAppPhone,
  normalizeWhatsAppRecipient,
  suppressWhatsAppContact,
} from "./whatsappConnectionService.js";

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}

export function verifyWhatsAppChallenge(query: Record<string, unknown>) {
  const mode = String(query["hub.mode"] || "");
  const token = String(query["hub.verify_token"] || "");
  const challenge = String(query["hub.challenge"] || "");
  if (
    mode !== "subscribe" ||
    !env.WHATSAPP_VERIFY_TOKEN ||
    !token ||
    !safeEqual(token, env.WHATSAPP_VERIFY_TOKEN)
  )
    throw new AppError(403, "WHATSAPP_WEBHOOK_VERIFICATION_FAILED", "Webhook verification failed.");
  return challenge;
}

export function verifyWhatsAppSignature(rawBody: Buffer, signature?: string) {
  if (!env.WHATSAPP_APP_SECRET)
    throw new AppError(503, "WHATSAPP_WEBHOOK_NOT_CONFIGURED", "WhatsApp webhook verification is not configured.");
  if (!signature || !/^sha256=[a-f0-9]{64}$/i.test(signature))
    throw new AppError(401, "WHATSAPP_SIGNATURE_MISSING", "A valid webhook signature is required.");
  const expected = `sha256=${createHmac("sha256", env.WHATSAPP_APP_SECRET).update(rawBody).digest("hex")}`;
  if (!safeEqual(signature.toLowerCase(), expected.toLowerCase()))
    throw new AppError(401, "WHATSAPP_SIGNATURE_INVALID", "Webhook signature verification failed.");
}

export async function recordWhatsAppWebhook(rawBody: Buffer, signature?: string) {
  verifyWhatsAppSignature(rawBody, signature);
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    throw new AppError(400, "WHATSAPP_WEBHOOK_JSON_INVALID", "Webhook payload is invalid JSON.");
  }
  if (payload?.object !== "whatsapp_business_account" || !Array.isArray(payload.entry))
    throw new AppError(400, "WHATSAPP_WEBHOOK_PAYLOAD_INVALID", "Webhook payload is not a WhatsApp event.");
  const contentHash = sha256(rawBody.toString("base64"));
  const eventKey = `whatsapp:${contentHash}`;
  const expiresAt = new Date(Date.now() + env.WHATSAPP_WEBHOOK_RETENTION_DAYS * 24 * 60 * 60_000);
  const receipt = await WhatsAppWebhookReceipt.findOneAndUpdate(
    { eventKey },
    {
      $setOnInsert: {
        eventKey,
        contentHash,
        payload,
        status: "RECEIVED",
        availableAt: new Date(),
        expiresAt,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  return { accepted: true, duplicate: receipt.createdAt.getTime() !== receipt.updatedAt.getTime() };
}

function inboundContent(message: any) {
  const type = String(message.type || "unsupported").toUpperCase();
  const supported = ["TEXT", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "LOCATION", "CONTACT"];
  const contentType = supported.includes(type) ? type : "UNSUPPORTED";
  const media = ["IMAGE", "DOCUMENT", "AUDIO", "VIDEO"].includes(contentType)
    ? {
        providerMediaId: String(message[message.type]?.id || ""),
        mimeType: String(message[message.type]?.mime_type || ""),
        filename: String(message[message.type]?.filename || ""),
      }
    : undefined;
  return {
    contentType,
    text: contentType === "TEXT" ? String(message.text?.body || "").slice(0, 5000) : undefined,
    media,
  };
}

async function inboundAudience(connection: any) {
  if (connection.scope === "PLATFORM") {
    return User.find({ roles: "ADMIN", status: "ACTIVE" }).distinct("_id");
  }
  return RoleAssignment.find({
    gymId: connection.gymId,
    role: { $in: ["GYM_OWNER", "GYM_STAFF"] },
    status: "ACTIVE",
    permissions: { $in: ["member:read", "member:write", "gym:update"] },
  }).distinct("userId");
}

async function processInbound(connection: any, value: any, message: any) {
  if (!message?.id || !message?.from) return;
  const recipient = normalizeWhatsAppRecipient(String(message.from));
  const providerContactHash = sha256(recipient);
  const contact = Array.isArray(value.contacts)
    ? value.contacts.find((entry: any) => String(entry.wa_id || "") === recipient)
    : undefined;
  const linkedUser = await User.findOne({
    phone: { $in: [recipient, `+${recipient}`] },
  }).select("_id name").lean();
  const receivedAt = message.timestamp
    ? new Date(Number(message.timestamp) * 1000)
    : new Date();
  const conversation = await WhatsAppConversation.findOneAndUpdate(
    { connectionId: connection._id, providerContactHash },
    {
      $set: {
        providerContactId: recipient,
        displayPhone: maskedWhatsAppPhone(recipient),
        contactName: String(contact?.profile?.name || linkedUser?.name || "WhatsApp contact").slice(0, 160),
        linkedUserId: linkedUser?._id,
        archivedAt: null,
        status: "OPEN",
      },
      $setOnInsert: {
        publicId: nanoid(20),
        connectionId: connection._id,
        scope: connection.scope,
        gymId: connection.gymId,
        providerContactHash,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  const content = inboundContent(message);
  try {
    await WhatsAppMessage.create({
      publicId: nanoid(20),
      conversationId: conversation._id,
      connectionId: connection._id,
      gymId: connection.gymId,
      direction: "INBOUND",
      source: "WEBHOOK",
      providerMessageId: String(message.id),
      ...content,
      status: "RECEIVED",
      providerTimestamp: receivedAt,
      correlationId: nanoid(16),
    });
  } catch (error: any) {
    if (error?.code === 11000) return;
    throw error;
  }
  await WhatsAppConversation.updateOne(
    { _id: conversation._id },
    {
      $set: { lastInboundAt: receivedAt, lastMessageAt: receivedAt, archivedAt: null, status: "OPEN" },
      $inc: { unreadCount: 1 },
    },
  );
  if (content.contentType === "TEXT" && /^(stop|unsubscribe|cancel|end|quit)$/i.test(content.text?.trim() || ""))
    await suppressWhatsAppContact(String(connection._id), recipient);
  const recipients = await inboundAudience(connection);
  await emitDomainEvents(
    recipients.map((userId: any) => ({
      event: "message.received" as const,
      userId,
      gymId: connection.gymId,
      entityId: conversation.publicId,
      occurrenceId: String(message.id),
      actionUrl: `/messages?channel=whatsapp&conversation=${conversation.publicId}`,
      source: connection.verifiedName || "WhatsApp",
    })),
  );
}

export function coexistenceMessageIdentity(
  kind: "ECHO" | "HISTORY",
  message: any,
  businessDisplayPhone?: string,
) {
  const from = normalizeWhatsAppRecipient(String(message?.from || ""));
  const to = normalizeWhatsAppRecipient(String(message?.to || ""));
  const business = businessDisplayPhone
    ? normalizeWhatsAppRecipient(businessDisplayPhone)
    : "";
  const outbound = kind === "ECHO" || (Boolean(business) && from === business);
  return {
    direction: outbound ? "OUTBOUND" as const : "INBOUND" as const,
    source: kind === "ECHO" ? "BUSINESS_APP" as const : "HISTORY_IMPORT" as const,
    contactId: outbound ? to : from,
    importedHistory: kind === "HISTORY",
  };
}

async function conversationForContact(connection: any, recipient: string) {
  const providerContactHash = sha256(recipient);
  const linkedUser = await User.findOne({
    phone: { $in: [recipient, `+${recipient}`] },
  }).select("_id name").lean();
  return WhatsAppConversation.findOneAndUpdate(
    { connectionId: connection._id, providerContactHash },
    {
      $set: {
        providerContactId: recipient,
        displayPhone: maskedWhatsAppPhone(recipient),
        contactName: String(linkedUser?.name || "WhatsApp contact").slice(0, 160),
        linkedUserId: linkedUser?._id,
        archivedAt: null,
        status: "OPEN",
      },
      $setOnInsert: {
        publicId: nanoid(20),
        connectionId: connection._id,
        scope: connection.scope,
        gymId: connection.gymId,
        providerContactHash,
      },
    },
    { upsert: true, returnDocument: "after" },
  );
}

async function processBusinessAppEcho(connection: any, message: any) {
  if (!message?.id || !message?.from || !message?.to) return;
  const identity = coexistenceMessageIdentity("ECHO", message);
  const conversation = await conversationForContact(connection, identity.contactId);
  const occurredAt = message.timestamp
    ? new Date(Number(message.timestamp) * 1000)
    : new Date();
  try {
    await WhatsAppMessage.create({
      publicId: nanoid(20),
      conversationId: conversation._id,
      connectionId: connection._id,
      gymId: connection.gymId,
      direction: identity.direction,
      source: identity.source,
      providerMessageId: String(message.id),
      ...inboundContent(message),
      status: "SENT",
      providerTimestamp: occurredAt,
      correlationId: nanoid(16),
    });
  } catch (error: any) {
    if (error?.code === 11000) return;
    throw error;
  }
  await WhatsAppConversation.updateOne(
    { _id: conversation._id },
    {
      $max: { lastMessageAt: occurredAt, lastOutboundAt: occurredAt },
      $set: { archivedAt: null, status: "OPEN" },
    },
  );
}

async function processImportedHistory(connection: any, value: any) {
  let imported = 0;
  for (const batch of value.history || []) {
    for (const thread of batch?.threads || []) {
      for (const message of thread?.messages || []) {
        if (!message?.id || !message?.from || !message?.to) continue;
        const identity = coexistenceMessageIdentity(
          "HISTORY",
          message,
          String(value.metadata?.display_phone_number || connection.displayPhoneNumber || ""),
        );
        const conversation = await conversationForContact(connection, identity.contactId);
        const occurredAt = message.timestamp
          ? new Date(Number(message.timestamp) * 1000)
          : new Date(0);
        try {
          await WhatsAppMessage.create({
            publicId: nanoid(20),
            conversationId: conversation._id,
            connectionId: connection._id,
            gymId: connection.gymId,
            direction: identity.direction,
            source: identity.source,
            providerMessageId: String(message.id),
            ...inboundContent(message),
            status: identity.direction === "OUTBOUND" ? "SENT" : "RECEIVED",
            providerTimestamp: occurredAt,
            correlationId: nanoid(16),
            importedHistory: true,
          });
          imported++;
        } catch (error: any) {
          if (error?.code !== 11000) throw error;
        }
        await WhatsAppConversation.updateOne(
          { _id: conversation._id },
          { $max: { lastMessageAt: occurredAt } },
        );
      }
    }
  }
  if (Array.isArray(value.history))
    await WhatsAppConnection.updateOne(
      { _id: connection._id },
      {
        $set: {
          synchronizationStatus: "COMPLETE",
          readinessStatus: connection.lastTemplateSyncAt
            ? (connection.capabilities?.limitations?.length ? "CONNECTED_LIMITED" : "CONNECTED")
            : "SYNCHRONIZING",
        },
      },
    );
  return imported;
}

const statusRank: Record<string, number> = {
  QUEUED: 0,
  ACCEPTED: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
};

async function processStatus(connection: any, statusEvent: any) {
  const providerMessageId = String(statusEvent?.id || "");
  const nextStatus = String(statusEvent?.status || "").toUpperCase();
  if (!providerMessageId || !statusRank[nextStatus]) return;
  const message: any = await WhatsAppMessage.findOne({
    connectionId: connection._id,
    providerMessageId,
  });
  const previousRank = statusRank[message?.status] ?? 0;
  if (!message || statusRank[nextStatus] <= previousRank) return;
  const timestamp = statusEvent.timestamp
    ? new Date(Number(statusEvent.timestamp) * 1000)
    : new Date();
  const timestampField: Record<string, string> = {
    SENT: "sentAt",
    DELIVERED: "deliveredAt",
    READ: "readAt",
    FAILED: "failedAt",
  };
  const failure = Array.isArray(statusEvent.errors) ? statusEvent.errors[0] : undefined;
  const update = {
    status: nextStatus,
    ...(timestampField[nextStatus] ? { [timestampField[nextStatus]]: timestamp } : {}),
    ...(failure
      ? {
          errorCategory: String(failure.title || failure.message || "PROVIDER_FAILURE").slice(0, 160),
          providerErrorCode: String(failure.code || ""),
        }
      : {}),
  };
  await Promise.all([
    WhatsAppMessage.updateOne({ _id: message._id }, { $set: update }),
    WhatsAppOutbox.updateOne(
      { _id: message.outboxId, connectionId: connection._id },
      {
        $set: {
          ...update,
          ...(nextStatus === "FAILED" ? { completedAt: timestamp } : {}),
        },
      },
    ),
  ]);
  const outbox = message.outboxId
    ? await WhatsAppOutbox.findById(message.outboxId).select("businessEvent businessEntityId").lean()
    : null;
  if (outbox?.businessEvent === "whatsapp.campaign" && outbox.businessEntityId) {
    const increments: Record<string, number> = {};
    if (nextStatus === "FAILED") increments["analytics.failed"] = 1;
    else {
      if (previousRank < statusRank.SENT && statusRank[nextStatus] >= statusRank.SENT) increments["analytics.sent"] = 1;
      if (previousRank < statusRank.DELIVERED && statusRank[nextStatus] >= statusRank.DELIVERED) increments["analytics.delivered"] = 1;
      if (previousRank < statusRank.READ && statusRank[nextStatus] >= statusRank.READ) increments["analytics.read"] = 1;
    }
    if (Object.keys(increments).length)
      await Campaign.updateOne({ publicId: outbox.businessEntityId }, { $inc: increments });
  }
}

async function processReceiptPayload(payload: any) {
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      if (!["messages", "smb_message_echoes"].includes(change.field)) continue;
      const value = change.value || {};
      const phoneNumberId = String(value.metadata?.phone_number_id || "");
      const wabaId = String(entry.id || "");
      const connection = await WhatsAppConnection.findOne({
        phoneNumberId,
        wabaId,
        status: "CONNECTED",
      });
      if (!connection) {
        logger.error({ phoneNumberId, wabaId }, "WhatsApp webhook did not match an isolated sender binding");
        continue;
      }
      if (change.field === "smb_message_echoes") {
        for (const message of value.message_echoes || [])
          await processBusinessAppEcho(connection, message);
        continue;
      }
      for (const message of value.messages || []) await processInbound(connection, value, message);
      for (const status of value.statuses || []) await processStatus(connection, status);
      for (const message of value.message_echoes || [])
        await processBusinessAppEcho(connection, message);
      await processImportedHistory(connection, value);
    }
  }
}

export async function processWhatsAppWebhooks(limit = 20) {
  let processed = 0;
  while (processed < limit) {
    const now = new Date();
    const leaseId = randomUUID();
    const receipt = await WhatsAppWebhookReceipt.findOneAndUpdate(
      {
        status: { $in: ["RECEIVED", "PROCESSING"] },
        availableAt: { $lte: now },
        $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
      },
      {
        $set: { status: "PROCESSING", leaseId, leaseUntil: new Date(now.getTime() + 2 * 60_000) },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after", sort: { createdAt: 1 } },
    ).select("+payload");
    if (!receipt) break;
    processed++;
    const claim = { _id: receipt._id, leaseId };
    try {
      await processReceiptPayload(receipt.payload);
      await WhatsAppWebhookReceipt.updateOne(claim, {
        $set: { status: "PROCESSED", processedAt: new Date() },
        $unset: { leaseId: 1, leaseUntil: 1, lastErrorCategory: 1 },
      });
    } catch (error: any) {
      const retry = receipt.attempts < 8;
      await WhatsAppWebhookReceipt.updateOne(claim, {
        $set: {
          status: retry ? "RECEIVED" : "FAILED",
          availableAt: retry
            ? new Date(Date.now() + Math.min(60 * 60_000, 15_000 * 2 ** receipt.attempts))
            : receipt.availableAt,
          lastErrorCategory: String(error?.code || error?.name || "WEBHOOK_PROCESSING_FAILED"),
        },
        $unset: { leaseId: 1, leaseUntil: 1 },
      });
      logger.error({ err: error, receiptId: receipt.eventKey }, "WhatsApp webhook processing failed");
    }
  }
  return processed;
}
