import { randomUUID } from "node:crypto";
import type { ClientSession, Types } from "mongoose";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import {
  WhatsAppProvider,
  WhatsAppProviderError,
} from "../integrations/messaging/whatsappProvider.js";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";
import { Campaign } from "../models/Engagement.js";
import { MemberCommunication } from "../models/Communication.js";
import {
  WhatsAppConnection,
  WhatsAppConsent,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppOutbox,
  WhatsAppTemplate,
} from "../models/WhatsApp.js";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import {
  membershipWhatsAppTemplates,
  membershipWhatsAppTemplate,
  membershipTemplateMatches,
  resolveMembershipWhatsAppTemplate,
  membershipWhatsAppStillCurrent,
} from "./whatsappMembershipTemplateService.js";
import {
  bindingKey,
  communicationScope,
  maskedWhatsAppPhone,
  normalizeWhatsAppRecipient,
  resolveWhatsAppSender,
  type WhatsAppActor,
  type WhatsAppScope,
} from "./whatsappConnectionService.js";

const provider = new WhatsAppProvider();

export const whatsappEventMatrix = {
  "invoice.ready": { scope: "GYM", template: "gfu_invoice_available" },
  "membership.renewed": { scope: "GYM", template: "gfu_membership_renewed" },
  "member.activation_invitation": { scope: "GYM", template: "gfu_member_invitation" },
  "membership.payment_reminder": { scope: "GYM", template: "gfu_payment_reminder" },
  "member.general_followup": { scope: "GYM", template: "gfu_member_followup" },
  "class.booked": { scope: "GYM", template: "gfu_class_booking_confirmed" },
  "class.cancelled": { scope: "GYM", template: "gfu_class_cancelled" },
  "class.updated": { scope: "GYM", template: "gfu_class_updated" },
  "class.trainer_changed": { scope: "GYM", template: "gfu_class_updated" },
  "class.reminder": { scope: "GYM", template: "gfu_class_reminder" },
  "account.registered": { scope: "PLATFORM", template: "gfu_account_welcome" },
  "account.verified": { scope: "GYM", template: "gfu_member_invitation" },
  "membership.created": { scope: "GYM", template: "gfu_membership_created" },
  "membership.frozen": { scope: "GYM", template: "gfu_membership_frozen" },
  "membership.reactivated": { scope: "GYM", template: "gfu_membership_reactivated" },
  "membership.deactivated": { scope: "GYM", template: "gfu_membership_deactivated" },
  "membership.expired": { scope: "GYM", template: "gfu_membership_expired" },
  "membership.cancelled": { scope: "GYM", template: "gfu_membership_cancelled" },
  "payment.successful": { scope: "GYM", template: "gfu_payment_confirmed" },
  "payment.offline": { scope: "GYM", template: "gfu_offline_payment_recorded" },
  "payment.refunded": { scope: "GYM", template: "gfu_refund_updated" },
  "trainer.assigned": { scope: "GYM", template: "gfu_trainer_assigned" },
  "support.updated": { scope: "DYNAMIC", template: "gfu_support_updated" },
  ...membershipWhatsAppTemplates,
  "gym.activated": { scope: "PLATFORM", template: "gfu_gym_status_updated" },
  "gym.suspended": { scope: "PLATFORM", template: "gfu_gym_status_updated" },
  "gym.archived": { scope: "PLATFORM", template: "gfu_gym_status_updated" },
} as const;

type DomainEventForWhatsApp = {
  event: string;
  userId: string | Types.ObjectId;
  gymId?: string | Types.ObjectId;
  entityId: string;
  subscriptionId?: string;
  occurrenceId?: string;
  actionUrl?: string;
  session?: ClientSession;
};

function eventScope(input: DomainEventForWhatsApp, configured: string): WhatsAppScope {
  if (configured === "PLATFORM") return "PLATFORM";
  if (configured === "DYNAMIC") return input.gymId ? "GYM" : "PLATFORM";
  return "GYM";
}

async function ensureConversation(input: {
  connection: any;
  recipient: string;
  linkedUserId?: string | Types.ObjectId;
  contactName?: string;
  session?: ClientSession;
}) {
  const providerContactHash = sha256(input.recipient);
  return WhatsAppConversation.findOneAndUpdate(
    {
      connectionId: input.connection._id,
      providerContactHash,
    },
    {
      $set: {
        linkedUserId: input.linkedUserId,
        contactName: input.contactName,
        displayPhone: maskedWhatsAppPhone(input.recipient),
      },
      $setOnInsert: {
        publicId: nanoid(20),
        connectionId: input.connection._id,
        scope: input.connection.scope,
        gymId: input.connection.gymId,
        providerContactId: input.recipient,
        providerContactHash,
        status: "OPEN",
      },
    },
    {
      upsert: true,
      returnDocument: "after",
      ...(input.session ? { session: input.session } : {}),
    },
  );
}

function consentAllows(consent: any, purpose: "SERVICE" | "MARKETING") {
  const decision = purpose === "MARKETING" ? consent?.marketing : consent?.service;
  return Boolean(decision?.grantedAt && !decision?.withdrawnAt);
}

export async function enqueueWhatsAppDomainEvent(
  input: DomainEventForWhatsApp,
  user: any,
) {
  const configured = whatsappEventMatrix[input.event as keyof typeof whatsappEventMatrix];
  if (!configured || env.WHATSAPP_MODE === "disabled" || !user?.phone) return;
  const scope = eventScope(input, configured.scope);
  if (scope === "GYM" && !input.gymId) return;
  try {
    const phone = normalizeWhatsAppRecipient(user.phone);
    const connection = await WhatsAppConnection.findOne({
      bindingKey: bindingKey(scope, input.gymId ? String(input.gymId) : undefined),
      status: "CONNECTED",
      outboundPaused: false,
    }).session(input.session || null);
    if (!connection) return;
    if (connection.eventPreferences?.disabledEvents?.includes(input.event)) return;
    const membershipTemplate = membershipWhatsAppTemplate(input.event);
    const language = membershipTemplate?.language || env.WHATSAPP_DEFAULT_LANGUAGE;
    const approvedTemplate = await WhatsAppTemplate.findOne({
      connectionId: connection._id,
      name: configured.template,
      language,
      status: "APPROVED",
      category: "UTILITY",
    })
      .select("components")
      .session(input.session || null)
      .lean();
    if (!approvedTemplate) return;
    if (membershipTemplate
      ? !membershipTemplateMatches(approvedTemplate.components, membershipTemplate.bodyParameters)
      : JSON.stringify(approvedTemplate.components || []).includes("{{")) {
      logger.warn({ event: input.event, template: configured.template }, "WhatsApp template components do not match the configured event");
      return;
    }
    const membershipPayload = membershipTemplate
      ? await resolveMembershipWhatsAppTemplate(input, user)
      : undefined;
    if (membershipTemplate && !membershipPayload) return;
    const phoneHash = sha256(phone);
    const consent = await WhatsAppConsent.findOne({
      connectionId: connection._id,
      phoneHash,
    })
      .session(input.session || null)
      .lean();
    const conversation = await ensureConversation({
      connection,
      recipient: phone,
      linkedUserId: input.userId,
      contactName: user.name,
      session: input.session,
    });
    const dedupeKey = [
      input.event,
      input.entityId,
      input.event === "membership.activated" ? "once" : input.occurrenceId || "once",
      connection.publicId,
      phoneHash,
      "WHATSAPP",
    ].join(":");
    const allowed = consentAllows(consent, "SERVICE");
    const now = new Date();
    const outbox = await WhatsAppOutbox.findOneAndUpdate(
      { dedupeKey },
      {
        $setOnInsert: {
          publicId: nanoid(20),
          dedupeKey,
          businessEvent: input.event,
          businessEntityId: input.entityId,
          connectionId: connection._id,
          scope,
          conversationId: conversation._id,
          gymId: input.gymId,
          recipientUserId: input.userId,
          recipientId: phone,
          recipientHash: phoneHash,
          purpose: "SERVICE",
          contentType: "TEMPLATE",
          template: {
            name: configured.template,
            language,
            parameters: membershipPayload?.parameters || [],
          },
          membershipContext: membershipPayload?.membershipContext,
          actionUrl: input.actionUrl,
          status: allowed ? "QUEUED" : "SUPPRESSED",
          policyDecision: allowed ? "PENDING_DISPATCH_RECHECK" : "CONSENT_MISSING",
          availableAt: now,
          expiresAt: membershipPayload?.expiresAt || new Date(now.getTime() + 48 * 60 * 60_000),
          completedAt: allowed ? undefined : now,
          correlationId: nanoid(16),
        },
      },
      {
        upsert: true,
        returnDocument: "after",
        ...(input.session ? { session: input.session } : {}),
      },
    );
    if (outbox && !(await WhatsAppMessage.exists({ outboxId: outbox._id })))
      await WhatsAppMessage.create(
        [
          {
            publicId: nanoid(20),
            conversationId: conversation._id,
            connectionId: connection._id,
            gymId: input.gymId,
            direction: "OUTBOUND",
            source: "BUSINESS_EVENT",
            outboxId: outbox._id,
            contentType: "TEMPLATE",
            template: outbox.template,
            status: outbox.status,
            correlationId: outbox.correlationId,
          },
        ],
        input.session ? { session: input.session } : undefined,
      );
    return outbox;
  } catch (error) {
    // WhatsApp is an additive channel; configuration or policy failure must not
    // roll back the authoritative business operation or other notification channels.
    logger.warn(
      { err: error, eventId: `${input.event}:${input.entityId}` },
      "WhatsApp event was not queued; core business event remains committed",
    );
  }
}

function localMinute(timezone: string, date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function clockMinute(value = "00:00") {
  const [hour, minute] = value.split(":").map(Number);
  return (hour || 0) * 60 + (minute || 0);
}

function isQuietHours(connection: any, now = new Date()) {
  const start = clockMinute(connection.limits?.quietHoursStart || "21:00");
  const end = clockMinute(connection.limits?.quietHoursEnd || "08:00");
  const current = localMinute(connection.limits?.timezone || "Asia/Kolkata", now);
  return start === end ? false : start < end ? current >= start && current < end : current >= start || current < end;
}

export async function evaluateWhatsAppDeliveryPolicy(outbox: any, connection: any) {
  const now = new Date();
  if (outbox.expiresAt <= now) return { allowed: false, final: true, reason: "JOB_EXPIRED" };
  if (env.WHATSAPP_MODE === "disabled") return { allowed: false, final: true, reason: "WHATSAPP_DISABLED" };
  if (env.WHATSAPP_MODE === "dry_run") return { allowed: false, final: true, reason: "DRY_RUN" };
  if (connection.status !== "CONNECTED") return { allowed: false, final: true, reason: "SENDER_DISCONNECTED" };
  if (connection.outboundPaused) return { allowed: false, final: true, reason: "SENDER_PAUSED" };
  const inFlight = await WhatsAppOutbox.countDocuments({ connectionId: connection._id, status: "SENDING" });
  if (inFlight > (connection.limits?.concurrentSends || 5))
    return { allowed: false, final: false, reason: "CONCURRENCY_LIMIT", deferMs: 5_000 };
  const consent = await WhatsAppConsent.findOne({
    connectionId: connection._id,
    phoneHash: outbox.recipientHash,
  }).lean();
  const conversation = outbox.conversationId
    ? await WhatsAppConversation.findById(outbox.conversationId).lean()
    : null;
  const insideWindow = Boolean(
    conversation?.lastInboundAt &&
      new Date(conversation.lastInboundAt).getTime() >= now.getTime() - 24 * 60 * 60_000,
  );
  if (outbox.contentType === "TEXT" && !insideWindow)
    return { allowed: false, final: true, reason: "OUTSIDE_SERVICE_WINDOW" };
  if (outbox.contentType === "TEMPLATE") {
    if (!consentAllows(consent, outbox.purpose))
      return { allowed: false, final: true, reason: "CONSENT_MISSING" };
    const template = await WhatsAppTemplate.findOne({
      connectionId: connection._id,
      name: outbox.template?.name,
      language: outbox.template?.language,
      status: "APPROVED",
    }).lean();
    if (!template) return { allowed: false, final: true, reason: "TEMPLATE_UNAVAILABLE" };
    const membershipTemplate = membershipWhatsAppTemplate(outbox.businessEvent);
    if (membershipTemplate) {
      if (template.category !== "UTILITY")
        return { allowed: false, final: true, reason: "TEMPLATE_CATEGORY_MISMATCH" };
      if (outbox.template?.name !== membershipTemplate.template ||
          outbox.template?.language !== membershipTemplate.language ||
          !membershipTemplateMatches(template.components, membershipTemplate.bodyParameters))
        return { allowed: false, final: true, reason: "TEMPLATE_PARAMETERS_MISMATCH" };
      if (!(await membershipWhatsAppStillCurrent(outbox, now)))
        return { allowed: false, final: true, reason: "MEMBERSHIP_CHANGED" };
    }
    if (outbox.purpose === "MARKETING" && template.category !== "MARKETING")
      return { allowed: false, final: true, reason: "TEMPLATE_CATEGORY_MISMATCH" };
  }
  if (isQuietHours(connection, now))
    return { allowed: false, final: false, reason: "QUIET_HOURS", deferMs: 30 * 60_000 };
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const counted = { $in: ["ACCEPTED", "SENT", "DELIVERED", "READ"] };
  const [daily, monthly, recipientDaily] = await Promise.all([
    WhatsAppOutbox.countDocuments({ connectionId: connection._id, status: counted, acceptedAt: { $gte: dayStart } }),
    WhatsAppOutbox.countDocuments({ connectionId: connection._id, status: counted, acceptedAt: { $gte: monthStart } }),
    WhatsAppOutbox.countDocuments({ connectionId: connection._id, recipientHash: outbox.recipientHash, status: counted, acceptedAt: { $gte: dayStart } }),
  ]);
  if (daily >= (connection.limits?.dailyMessages || 500))
    return { allowed: false, final: false, reason: "DAILY_LIMIT", deferMs: 60 * 60_000 };
  if (monthly >= (connection.limits?.monthlyMessages || 10_000))
    return { allowed: false, final: true, reason: "MONTHLY_LIMIT" };
  if (recipientDaily >= (connection.limits?.recipientPerDay || 5))
    return { allowed: false, final: true, reason: "RECIPIENT_FREQUENCY_LIMIT" };
  return { allowed: true, final: false, reason: "ALLOWED" };
}

export async function openGymMemberWhatsAppConversation(
  actor: WhatsAppActor,
  memberPublicId: string,
) {
  const context = communicationScope(actor);
  if (context.scope !== "GYM" || !context.gymId)
    throw new AppError(403, "GYM_CONTEXT_REQUIRED", "Select an authorised gym.");
  const member = await MemberProfile.findOne({
    publicId: memberPublicId,
    gymId: context.gymId,
    status: { $ne: "ARCHIVED" },
  }).populate("userId", "name phone status");
  const user: any = member?.userId;
  if (!member || !user || user.status !== "ACTIVE" || !user.phone)
    throw new AppError(
      409,
      "WHATSAPP_RECIPIENT_UNAVAILABLE",
      "This member does not have an active account with a verified WhatsApp contact.",
    );
  const phone = normalizeWhatsAppRecipient(user.phone);
  const sender = await resolveWhatsAppSender("GYM", context.gymId);
  const conversation = await ensureConversation({
    connection: sender.connection,
    recipient: phone,
    linkedUserId: user._id,
    contactName: user.name,
  });
  return {
    publicId: conversation.publicId,
    contactName: conversation.contactName,
    displayPhone: conversation.displayPhone,
    sender: sender.connection.verifiedName || sender.connection.displayPhoneNumber,
    serviceWindowOpen: Boolean(
      conversation.lastInboundAt &&
        conversation.lastInboundAt.getTime() >= Date.now() - 24 * 60 * 60_000,
    ),
  };
}

async function actorConnection(actor: WhatsAppActor) {
  const context = communicationScope(actor);
  const connection = await WhatsAppConnection.findOne({
    bindingKey: bindingKey(context.scope, context.gymId),
  }).lean();
  if (!connection)
    throw new AppError(404, "WHATSAPP_CONNECTION_NOT_FOUND", "WhatsApp is not connected.");
  return { context, connection };
}

export async function listWhatsAppConversations(
  actor: WhatsAppActor,
  input: { page: number; limit: number; q?: string; archived?: boolean },
) {
  const { connection } = await actorConnection(actor);
  const filter: Record<string, any> = {
    connectionId: connection._id,
    archivedAt: input.archived ? { $ne: null } : null,
  };
  if (input.q)
    filter.$or = [
      { contactName: { $regex: input.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { displayPhone: { $regex: input.q.replace(/\D/g, "").slice(-4) } },
    ];
  const skip = (input.page - 1) * input.limit;
  const [rows, total] = await Promise.all([
    WhatsAppConversation.find(filter)
      .sort({ lastMessageAt: -1, _id: -1 })
      .skip(skip)
      .limit(input.limit)
      .lean(),
    WhatsAppConversation.countDocuments(filter),
  ]);
  return { rows, total };
}

export async function getWhatsAppConversation(
  actor: WhatsAppActor,
  publicId: string,
) {
  const { connection } = await actorConnection(actor);
  const conversation = await WhatsAppConversation.findOne({
    publicId,
    connectionId: connection._id,
  }).lean();
  if (!conversation)
    throw new AppError(404, "WHATSAPP_CONVERSATION_NOT_FOUND", "Conversation not found.");
  return {
    ...conversation,
    serviceWindowOpen: Boolean(
      conversation.lastInboundAt &&
        new Date(conversation.lastInboundAt).getTime() >= Date.now() - 24 * 60 * 60_000,
    ),
    serviceWindowEndsAt: conversation.lastInboundAt
      ? new Date(new Date(conversation.lastInboundAt).getTime() + 24 * 60 * 60_000)
      : null,
    sender: publicSender(connection),
  };
}

function publicSender(connection: any) {
  return {
    publicId: connection.publicId,
    name: connection.verifiedName,
    displayPhoneNumber: connection.displayPhoneNumber,
    status: connection.status,
    outboundPaused: connection.outboundPaused,
  };
}

export async function listWhatsAppMessages(
  actor: WhatsAppActor,
  conversationPublicId: string,
  input: { before?: string; limit: number },
) {
  const { connection } = await actorConnection(actor);
  const conversation = await WhatsAppConversation.findOne({
    publicId: conversationPublicId,
    connectionId: connection._id,
  }).lean();
  if (!conversation)
    throw new AppError(404, "WHATSAPP_CONVERSATION_NOT_FOUND", "Conversation not found.");
  const filter: Record<string, any> = { conversationId: conversation._id };
  if (input.before) {
    const cursor = await WhatsAppMessage.findOne({ publicId: input.before, conversationId: conversation._id })
      .select("createdAt _id")
      .lean();
    if (cursor)
      filter.$or = [
        { createdAt: { $lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, _id: { $lt: cursor._id } },
      ];
  }
  const rows = await WhatsAppMessage.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .limit(input.limit + 1)
    .lean();
  const hasMore = rows.length > input.limit;
  const page = rows.slice(0, input.limit).reverse();
  return { rows: page, hasMore, nextCursor: hasMore ? page[0]?.publicId : undefined };
}

export async function queueWhatsAppConversationMessage(
  actor: WhatsAppActor,
  conversationPublicId: string,
  input: {
    idempotencyKey: string;
    purpose: "SERVICE" | "MARKETING";
    text?: string;
    templateName?: string;
    language?: string;
    parameters?: unknown[];
  },
) {
  const { connection } = await actorConnection(actor);
  const conversation = await WhatsAppConversation.findOne({
    publicId: conversationPublicId,
    connectionId: connection._id,
  }).select("+providerContactId");
  if (!conversation)
    throw new AppError(404, "WHATSAPP_CONVERSATION_NOT_FOUND", "Conversation not found.");
  const contentType = input.templateName ? "TEMPLATE" : "TEXT";
  if (contentType === "TEXT") {
    if (!input.text?.trim())
      throw new AppError(422, "WHATSAPP_MESSAGE_EMPTY", "Enter a message.");
    if (
      !conversation.lastInboundAt ||
      conversation.lastInboundAt.getTime() < Date.now() - 24 * 60 * 60_000
    )
      throw new AppError(
        409,
        "WHATSAPP_OUTSIDE_SERVICE_WINDOW",
        "The 24-hour customer-service window is closed. Choose an approved template.",
      );
  }
  const recipient = normalizeWhatsAppRecipient(conversation.providerContactId);
  const dedupeKey = `manual:${connection.publicId}:${actor.userId}:${input.idempotencyKey}`;
  const now = new Date();
  const outbox = await WhatsAppOutbox.findOneAndUpdate(
    { dedupeKey },
    {
      $setOnInsert: {
        publicId: nanoid(20),
        dedupeKey,
        businessEvent: "whatsapp.human_reply",
        businessEntityId: conversation.publicId,
        connectionId: connection._id,
        scope: conversation.scope,
        conversationId: conversation._id,
        gymId: conversation.gymId,
        recipientUserId: conversation.linkedUserId,
        recipientId: recipient,
        recipientHash: sha256(recipient),
        purpose: input.purpose,
        contentType,
        text: contentType === "TEXT" ? input.text!.trim() : undefined,
        template:
          contentType === "TEMPLATE"
            ? {
                name: input.templateName,
                language: input.language || env.WHATSAPP_DEFAULT_LANGUAGE,
                parameters: input.parameters || [],
              }
            : undefined,
        status: "QUEUED",
        policyDecision: "PENDING_DISPATCH_RECHECK",
        availableAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
        correlationId: nanoid(16),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!(await WhatsAppMessage.exists({ outboxId: outbox._id })))
    await WhatsAppMessage.create({
      publicId: nanoid(20),
      conversationId: conversation._id,
      connectionId: connection._id,
      gymId: conversation.gymId,
      direction: "OUTBOUND",
      source: "HUMAN",
      outboxId: outbox._id,
      contentType,
      text: outbox.text,
      template: outbox.template,
      status: "QUEUED",
      correlationId: outbox.correlationId,
    });
  return outbox;
}

export async function markWhatsAppConversationRead(
  actor: WhatsAppActor,
  publicId: string,
) {
  const { connection } = await actorConnection(actor);
  const result = await WhatsAppConversation.updateOne(
    { publicId, connectionId: connection._id },
    { $set: { unreadCount: 0 } },
  );
  if (!result.matchedCount)
    throw new AppError(404, "WHATSAPP_CONVERSATION_NOT_FOUND", "Conversation not found.");
}

export async function archiveWhatsAppConversation(
  actor: WhatsAppActor,
  publicId: string,
  archived: boolean,
) {
  const { connection } = await actorConnection(actor);
  const result = await WhatsAppConversation.updateOne(
    { publicId, connectionId: connection._id },
    archived ? { $set: { archivedAt: new Date() } } : { $unset: { archivedAt: 1 } },
  );
  if (!result.matchedCount)
    throw new AppError(404, "WHATSAPP_CONVERSATION_NOT_FOUND", "Conversation not found.");
}

function campaignScopeFilter(actor: WhatsAppActor) {
  const context = communicationScope(actor);
  return context.scope === "PLATFORM"
    ? { scope: "PLATFORM" as const }
    : { scope: "GYM" as const, gymId: context.gymId };
}

async function campaignConnection(actor: WhatsAppActor) {
  const context = communicationScope(actor);
  const connection = await WhatsAppConnection.findOne({
    bindingKey: bindingKey(context.scope, context.gymId),
    status: "CONNECTED",
  }).lean();
  if (!connection)
    throw new AppError(409, "WHATSAPP_SENDER_DISCONNECTED", "Connect this business's WhatsApp sender first.");
  return { context, connection };
}

export async function previewWhatsAppCampaign(
  actor: WhatsAppActor,
  input: { templateName: string; language: string; roles: string[] },
) {
  const { context, connection } = await campaignConnection(actor);
  const template = await WhatsAppTemplate.findOne({
    connectionId: connection._id,
    name: input.templateName,
    language: input.language,
    category: "MARKETING",
    status: "APPROVED",
  }).lean();
  if (!template)
    throw new AppError(409, "WHATSAPP_TEMPLATE_UNAVAILABLE", "Choose an approved Marketing template for this sender.");
  if (JSON.stringify(template.components || []).includes("{{"))
    throw new AppError(409, "WHATSAPP_TEMPLATE_PARAMETERS_REQUIRED", "This campaign screen currently supports approved templates without variables.");
  const audiencePipeline: any[] = context.scope === "PLATFORM"
    ? [
        { $match: { roles: { $in: input.roles }, status: "ACTIVE" } },
        { $facet: {
          total: [{ $count: "count" }],
          withPhone: [{ $match: { phone: { $type: "string", $ne: "" } } }, { $count: "count" }],
        } },
      ]
    : [
        { $match: { gymId: connection.gymId, status: { $in: ["ACTIVE", "FROZEN"] } } },
        { $group: { _id: "$userId" } },
        { $lookup: { from: User.collection.name, localField: "_id", foreignField: "_id", as: "user" } },
        { $unwind: "$user" },
        { $match: { "user.status": "ACTIVE" } },
        { $facet: {
          total: [{ $count: "count" }],
          withPhone: [{ $match: { "user.phone": { $type: "string", $ne: "" } } }, { $count: "count" }],
        } },
      ];
  const consentPipeline: any[] = [
    { $match: {
      connectionId: connection._id,
      userId: { $type: "objectId" },
      "marketing.grantedAt": { $ne: null },
      $or: [{ "marketing.withdrawnAt": null }, { "marketing.withdrawnAt": { $exists: false } }],
    } },
    { $group: { _id: "$userId" } },
    { $lookup: { from: User.collection.name, localField: "_id", foreignField: "_id", as: "user" } },
    { $unwind: "$user" },
    { $match: { "user.status": "ACTIVE", "user.phone": { $type: "string", $ne: "" }, ...(context.scope === "PLATFORM" ? { "user.roles": { $in: input.roles } } : {}) } },
    ...(context.scope === "GYM" ? [
      { $lookup: {
        from: MemberProfile.collection.name,
        let: { recipientUserId: "$_id" },
        pipeline: [
          { $match: { gymId: connection.gymId, status: { $in: ["ACTIVE", "FROZEN"] }, $expr: { $eq: ["$userId", "$$recipientUserId"] } } },
          { $limit: 1 },
        ],
        as: "membership",
      } },
      { $match: { "membership.0": { $exists: true } } },
    ] : []),
    { $count: "count" },
  ];
  const [audienceRows, consentRows] = await Promise.all([
    context.scope === "PLATFORM" ? User.aggregate(audiencePipeline) : MemberProfile.aggregate(audiencePipeline),
    WhatsAppConsent.aggregate(consentPipeline),
  ]);
  const totalAudience = audienceRows[0]?.total?.[0]?.count || 0;
  const withPhone = audienceRows[0]?.withPhone?.[0]?.count || 0;
  const consented = consentRows[0]?.count || 0;
  const cap = connection.limits?.campaignMessages || 250;
  return {
    totalAudience,
    withVerifiedContact: withPhone,
    eligibleNow: Math.min(consented, withPhone, cap),
    suppressedNow: Math.max(0, totalAudience - Math.min(consented, withPhone, cap)),
    campaignCap: cap,
    outboundPaused: connection.outboundPaused,
    billingNotice: "Meta charges and category pricing are external. Queued counts are not reconciled charges.",
  };
}

export async function createWhatsAppCampaign(
  actor: WhatsAppActor,
  input: {
    name: string;
    templateName: string;
    language: string;
    roles: string[];
    scheduledAt?: string;
    idempotencyKey: string;
    confirmed: boolean;
  },
) {
  if (!input.confirmed)
    throw new AppError(422, "WHATSAPP_CAMPAIGN_CONFIRMATION_REQUIRED", "Preview and confirm this campaign before scheduling it.");
  const preview = await previewWhatsAppCampaign(actor, input);
  if (!preview.eligibleNow)
    throw new AppError(409, "WHATSAPP_CAMPAIGN_EMPTY", "No consent-qualified recipients are currently eligible.");
  if (preview.outboundPaused)
    throw new AppError(409, "WHATSAPP_SENDER_PAUSED", "Enable outbound delivery before scheduling campaigns.");
  const context = communicationScope(actor);
  const scheduledAt = input.scheduledAt ? new Date(input.scheduledAt) : new Date();
  const key = `whatsapp-campaign:${context.scope}:${context.gymId || "platform"}:${actor.userId}:${input.idempotencyKey}`;
  const campaign = await Campaign.findOneAndUpdate(
    { idempotencyKey: key },
    {
      $setOnInsert: {
        publicId: nanoid(20),
        scope: context.scope,
        gymId: context.gymId,
        idempotencyKey: key,
        createdBy: actor.userId,
        name: input.name,
        channel: "WHATSAPP",
        audience: { roles: input.roles },
        audienceSnapshot: { createdBefore: new Date(), preview },
        templateId: `${input.templateName}:${input.language}`,
        message: `Approved template: ${input.templateName}`,
        scheduledAt,
        status: scheduledAt > new Date() ? "SCHEDULED" : "QUEUED",
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  if (
    !campaign ||
    campaign.name !== input.name ||
    campaign.templateId !== `${input.templateName}:${input.language}` ||
    JSON.stringify([...(campaign.audience?.roles || [])].sort()) !== JSON.stringify([...input.roles].sort()) ||
    (input.scheduledAt && campaign.scheduledAt?.toISOString() !== scheduledAt.toISOString())
  )
    throw new AppError(409, "WHATSAPP_CAMPAIGN_KEY_REUSED", "Use a new submission identifier for a different campaign.");
  return campaign;
}

export async function listWhatsAppCampaigns(actor: WhatsAppActor) {
  return Campaign.find({ ...campaignScopeFilter(actor), channel: "WHATSAPP" })
    .sort({ createdAt: -1 })
    .limit(100)
    .select("publicId name templateId audience status scheduledAt analytics createdAt")
    .lean();
}

export async function cancelWhatsAppCampaign(actor: WhatsAppActor, publicId: string) {
  const campaign = await Campaign.findOneAndUpdate(
    {
      publicId,
      ...campaignScopeFilter(actor),
      channel: "WHATSAPP",
      status: { $in: ["DRAFT", "SCHEDULED", "QUEUED", "PROCESSING"] },
    },
    { $set: { status: "CANCELLED" }, $unset: { leaseId: 1, leaseUntil: 1 } },
    { returnDocument: "after" },
  );
  if (!campaign)
    throw new AppError(404, "WHATSAPP_CAMPAIGN_NOT_CANCELLABLE", "Campaign was not found or can no longer be cancelled.");
  await WhatsAppOutbox.updateMany(
    { businessEvent: "whatsapp.campaign", businessEntityId: publicId, status: "QUEUED" },
    { $set: { status: "CANCELLED", policyDecision: "CAMPAIGN_CANCELLED", completedAt: new Date() } },
  );
  return campaign;
}

async function queueCampaignRecipient(campaign: any, connection: any, user: any) {
  if (!user.phone) return "SUPPRESSED";
  let phone: string;
  try { phone = normalizeWhatsAppRecipient(user.phone); } catch { return "SUPPRESSED"; }
  const phoneHash = sha256(phone);
  const consent = await WhatsAppConsent.findOne({ connectionId: connection._id, phoneHash }).lean();
  if (!consentAllows(consent, "MARKETING")) return "SUPPRESSED";
  const conversation = await ensureConversation({
    connection,
    recipient: phone,
    linkedUserId: user._id,
    contactName: user.name,
  });
  const [templateName, language] = String(campaign.templateId).split(":");
  const dedupeKey = `campaign:${campaign.publicId}:${connection.publicId}:${phoneHash}`;
  const now = new Date();
  const outbox = await WhatsAppOutbox.findOneAndUpdate(
    { dedupeKey },
    {
      $setOnInsert: {
        publicId: nanoid(20),
        dedupeKey,
        businessEvent: "whatsapp.campaign",
        businessEntityId: campaign.publicId,
        connectionId: connection._id,
        scope: connection.scope,
        conversationId: conversation._id,
        gymId: connection.gymId,
        recipientUserId: user._id,
        recipientId: phone,
        recipientHash: phoneHash,
        purpose: "MARKETING",
        contentType: "TEMPLATE",
        template: { name: templateName, language, parameters: [] },
        status: "QUEUED",
        policyDecision: "PENDING_DISPATCH_RECHECK",
        availableAt: now,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60_000),
        correlationId: nanoid(16),
      },
    },
    { upsert: true, returnDocument: "after" },
  );
  if (!(await WhatsAppMessage.exists({ outboxId: outbox._id })))
    await WhatsAppMessage.create({
      publicId: nanoid(20), conversationId: conversation._id, connectionId: connection._id,
      gymId: connection.gymId, direction: "OUTBOUND", source: "CAMPAIGN", outboxId: outbox._id,
      contentType: "TEMPLATE", template: outbox.template, status: outbox.status, correlationId: outbox.correlationId,
    });
  return "QUEUED";
}

export async function processWhatsAppCampaignBatch() {
  const now = new Date();
  const leaseId = randomUUID();
  const campaign: any = await Campaign.findOneAndUpdate(
    {
      channel: "WHATSAPP",
      status: { $in: ["SCHEDULED", "QUEUED", "PROCESSING"] },
      $and: [{ $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }] }, { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] }],
    },
    { $set: { status: "PROCESSING", leaseId, leaseUntil: new Date(now.getTime() + 2 * 60_000) } },
    { returnDocument: "after", sort: { scheduledAt: 1, createdAt: 1 } },
  );
  if (!campaign) return false;
  const owned = { _id: campaign._id, leaseId };
  try {
    const scope = campaign.scope as WhatsAppScope;
    const connection = await WhatsAppConnection.findOne({
      bindingKey: bindingKey(scope, campaign.gymId ? String(campaign.gymId) : undefined),
      status: "CONNECTED",
      outboundPaused: false,
    });
    if (!connection) throw new AppError(409, "WHATSAPP_SENDER_DISCONNECTED", "Campaign sender is unavailable.");
    const cursor = campaign.deliveryCursor;
    let ids: any[];
    if (scope === "PLATFORM") {
      ids = (await User.find({
        ...(cursor ? { _id: { $gt: cursor } } : {}),
        roles: { $in: campaign.audience?.roles || ["GYM_OWNER"] },
        status: "ACTIVE",
      }).sort({ _id: 1 }).limit(100).select("_id").lean()).map((row) => row._id);
    } else {
      ids = (await MemberProfile.find({
        gymId: campaign.gymId,
        status: { $in: ["ACTIVE", "FROZEN"] },
        ...(cursor ? { userId: { $gt: cursor } } : {}),
      }).sort({ userId: 1 }).limit(100).select("userId").lean()).map((row) => row.userId);
    }
    const cap = connection.limits?.campaignMessages || 250;
    const remaining = Math.max(0, cap - (campaign.analytics?.recipients || 0));
    ids = ids.slice(0, remaining);
    const users = await User.find({ _id: { $in: ids }, status: "ACTIVE" }).select("name phone").lean();
    let queued = 0;
    let suppressed = Math.max(0, ids.length - users.length);
    for (const user of users) {
      const outcome = await queueCampaignRecipient(campaign, connection, user);
      outcome === "QUEUED" ? queued++ : suppressed++;
    }
    const done = ids.length < 100 || ids.length >= remaining;
    await Campaign.updateOne(owned, {
      $set: {
        status: done ? (suppressed ? "PARTIALLY_FAILED" : "COMPLETED") : "QUEUED",
        deliveryCursor: ids.at(-1) || campaign.deliveryCursor,
      },
      $inc: { "analytics.recipients": ids.length, "analytics.failed": suppressed },
      $unset: { leaseId: 1, leaseUntil: 1 },
    });
    return true;
  } catch (error: any) {
    await Campaign.updateOne(owned, {
      $set: { status: "QUEUED", leaseUntil: new Date(Date.now() + 5 * 60_000) },
      $unset: { leaseId: 1 },
    });
    logger.warn({ err: error, campaignId: campaign.publicId }, "WhatsApp campaign batch deferred");
    return true;
  }
}

export async function processWhatsAppOutbox(limit = 10) {
  let processed = 0;
  while (processed < limit) {
    const now = new Date();
    const leaseId = randomUUID();
    const outbox = await WhatsAppOutbox.findOneAndUpdate(
      {
        status: { $in: ["QUEUED", "SENDING"] },
        availableAt: { $lte: now },
        $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }],
      },
      {
        $set: {
          status: "SENDING",
          leaseId,
          leaseUntil: new Date(now.getTime() + 2 * 60_000),
        },
        $inc: { attempts: 1 },
      },
      { returnDocument: "after", sort: { availableAt: 1, createdAt: 1 } },
    ).select("+recipientId");
    if (!outbox) break;
    processed++;
    const claim = { _id: outbox._id, leaseId };
    try {
      const resolved = await resolveWhatsAppSender(
        outbox.scope,
        outbox.scope === "GYM" ? String(outbox.gymId) : undefined,
      );
      if (String(resolved.connection._id) !== String(outbox.connectionId))
        throw new AppError(
          409,
          "WHATSAPP_SENDER_CHANGED",
          "The original sender binding is no longer active.",
        );
      const policy = await evaluateWhatsAppDeliveryPolicy(outbox, resolved.connection);
      if (!policy.allowed) {
        if (!policy.final) {
          await WhatsAppOutbox.updateOne(claim, {
            $set: {
              status: "QUEUED",
              policyDecision: policy.reason,
              availableAt: new Date(Date.now() + (policy.deferMs || 60_000)),
            },
            $unset: { leaseId: 1, leaseUntil: 1 },
          });
        } else {
          const status = policy.reason === "JOB_EXPIRED" ? "EXPIRED" : "SUPPRESSED";
          await Promise.all([
            WhatsAppOutbox.updateOne(claim, {
              $set: { status, policyDecision: policy.reason, completedAt: new Date() },
              $unset: { leaseId: 1, leaseUntil: 1 },
            }),
            WhatsAppMessage.updateOne({ outboxId: outbox._id }, { $set: { status } }),
            MemberCommunication.updateOne(
              { whatsappOutboxId: outbox._id },
              {
                $set: {
                  status: "SUPPRESSED",
                  failureCode: policy.reason,
                },
              },
            ),
          ]);
        }
        continue;
      }
      const result =
        outbox.contentType === "TEMPLATE"
          ? await provider.sendTemplate({
              token: resolved.token,
              phoneNumberId: resolved.connection.phoneNumberId,
              to: outbox.recipientId,
              template: outbox.template!.name!,
              language: outbox.template?.language,
              components: outbox.template?.parameters || [],
            })
          : await provider.sendText({
              token: resolved.token,
              phoneNumberId: resolved.connection.phoneNumberId,
              to: outbox.recipientId,
              text: outbox.text!,
            });
      const acceptedAt = new Date();
      await Promise.all([
        WhatsAppOutbox.updateOne(claim, {
          $set: {
            status: "ACCEPTED",
            policyDecision: "PROVIDER_ACCEPTED",
            providerMessageId: result.providerMessageId,
            acceptedAt,
          },
          $unset: { leaseId: 1, leaseUntil: 1, lastErrorCategory: 1, lastProviderCode: 1 },
        }),
        WhatsAppMessage.updateOne(
          { outboxId: outbox._id },
          { $set: { status: "ACCEPTED", providerMessageId: result.providerMessageId, acceptedAt } },
        ),
        WhatsAppConversation.updateOne(
          { _id: outbox.conversationId },
          { $set: { lastOutboundAt: acceptedAt, lastMessageAt: acceptedAt } },
        ),
        MemberCommunication.updateOne(
          { whatsappOutboxId: outbox._id },
          {
            $set: {
              status: "ACCEPTED",
              providerMessageId: result.providerMessageId,
            },
          },
        ),
      ]);
      logger.info(
        {
          eventId: outbox.businessEvent,
          tenant: resolved.connection.bindingKey,
          connectionId: resolved.connection.publicId,
          messageId: outbox.publicId,
          outcome: "ACCEPTED",
          attempt: outbox.attempts,
        },
        "WhatsApp message accepted by provider",
      );
    } catch (error) {
      const providerFailure = error instanceof WhatsAppProviderError ? error : undefined;
      const uncertain = providerFailure?.uncertain === true;
      const retry = providerFailure?.retryable === true && !uncertain && outbox.attempts < 6;
      const status = uncertain ? "UNKNOWN_OUTCOME" : retry ? "QUEUED" : "FAILED";
      await Promise.all([
        WhatsAppOutbox.updateOne(claim, {
          $set: {
            status,
            policyDecision: providerFailure?.category || (error as any)?.code || "INTERNAL_FAILURE",
            lastErrorCategory: providerFailure?.category || (error as any)?.code || "INTERNAL_FAILURE",
            lastProviderCode: providerFailure?.providerCode,
            availableAt: retry
              ? new Date(Date.now() + Math.min(60 * 60_000, 30_000 * 2 ** outbox.attempts))
              : outbox.availableAt,
            completedAt: retry ? undefined : new Date(),
          },
          $unset: { leaseId: 1, leaseUntil: 1 },
        }),
        WhatsAppMessage.updateOne(
          { outboxId: outbox._id },
          {
            $set: {
              status,
              errorCategory: providerFailure?.category || (error as any)?.code || "INTERNAL_FAILURE",
              providerErrorCode: providerFailure?.providerCode,
              failedAt: retry ? undefined : new Date(),
            },
          },
        ),
        MemberCommunication.updateOne(
          { whatsappOutboxId: outbox._id },
          {
            $set: {
              status: status === "QUEUED" ? "QUEUED" : "FAILED",
              failureCode:
                providerFailure?.category ||
                (error as any)?.code ||
                "INTERNAL_FAILURE",
            },
          },
        ),
      ]);
      logger.warn(
        {
          eventId: outbox.businessEvent,
          connectionId: String(outbox.connectionId),
          messageId: outbox.publicId,
          outcome: status,
          errorCategory: providerFailure?.category || (error as any)?.code || "INTERNAL_FAILURE",
          attempt: outbox.attempts,
        },
        "WhatsApp delivery did not complete",
      );
    }
  }
  return processed;
}
