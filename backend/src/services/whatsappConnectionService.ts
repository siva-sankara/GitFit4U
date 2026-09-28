import type { ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { WhatsAppProvider } from "../integrations/messaging/whatsappProvider.js";
import { RoleAssignment, AuthIdentity } from "../models/Auth.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";
import {
  WhatsAppConnection,
  WhatsAppConsent,
  WhatsAppOnboardingSession,
  WhatsAppOutbox,
  WhatsAppTemplate,
} from "../models/WhatsApp.js";
import { AppError } from "../utils/AppError.js";
import {
  decryptWhatsAppCredential,
  encryptWhatsAppCredential,
  sha256,
} from "../utils/crypto.js";

const provider = new WhatsAppProvider();
export type WhatsAppScope = "PLATFORM" | "GYM";
export type WhatsAppActor = {
  userId: string;
  role: string;
  gymId?: string;
  permissions: string[];
};

export function normalizeWhatsAppRecipient(value: string) {
  const digits = value.replace(/\D/g, "");
  if (!/^\d{8,15}$/.test(digits))
    throw new AppError(
      422,
      "WHATSAPP_PHONE_INVALID",
      "A verified international phone number is required.",
    );
  return digits;
}

export function maskedWhatsAppPhone(value?: string) {
  const digits = value?.replace(/\D/g, "") || "";
  return digits ? `******${digits.slice(-4)}` : "Unavailable";
}

export function bindingKey(scope: WhatsAppScope, gymId?: string) {
  if (scope === "GYM" && !gymId)
    throw new AppError(400, "GYM_CONTEXT_REQUIRED", "Select a gym to continue.");
  return scope === "PLATFORM" ? "PLATFORM" : `GYM:${gymId}`;
}

export function communicationScope(actor: WhatsAppActor) {
  if (actor.role === "ADMIN") return { scope: "PLATFORM" as const };
  if (!["GYM_OWNER", "GYM_STAFF"].includes(actor.role) || !actor.gymId)
    throw new AppError(
      403,
      "WHATSAPP_SCOPE_FORBIDDEN",
      "This account cannot manage a WhatsApp sender.",
    );
  return { scope: "GYM" as const, gymId: actor.gymId };
}

export function publicConnection(connection: any) {
  if (!connection) return null;
  return {
    publicId: connection.publicId,
    scope: connection.scope,
    gymId: connection.gymId,
    wabaId: connection.wabaId,
    phoneNumberId: connection.phoneNumberId,
    displayPhoneNumber: connection.displayPhoneNumber,
    verifiedName: connection.verifiedName,
    status: connection.status,
    qualityRating: connection.qualityRating,
    phoneStatus: connection.phoneStatus,
    coexistenceStatus: connection.coexistenceStatus,
    outboundPaused: connection.outboundPaused,
    pauseReason: connection.pauseReason,
    limits: connection.limits,
    eventPreferences: connection.eventPreferences,
    permissions: connection.permissions,
    connectedAt: connection.connectedAt,
    lastVerifiedAt: connection.lastVerifiedAt,
    lastTemplateSyncAt: connection.lastTemplateSyncAt,
    disconnectedAt: connection.disconnectedAt,
    lastErrorCategory: connection.lastErrorCategory,
    mode: env.WHATSAPP_MODE,
    graphApiVersion: env.WHATSAPP_API_VERSION,
  };
}

async function bootstrapPlatformConnection() {
  if (
    env.WHATSAPP_MODE === "disabled" ||
    !env.WHATSAPP_ACCESS_TOKEN ||
    !env.WHATSAPP_PHONE_NUMBER_ID ||
    !env.WHATSAPP_WABA_ID ||
    !env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY
  )
    return;
  return WhatsAppConnection.findOneAndUpdate(
    { bindingKey: "PLATFORM" },
    {
      $setOnInsert: {
        publicId: nanoid(20),
        bindingKey: "PLATFORM",
        scope: "PLATFORM",
        wabaId: env.WHATSAPP_WABA_ID,
        phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
        credentialCiphertext: encryptWhatsAppCredential(env.WHATSAPP_ACCESS_TOKEN),
        credentialFingerprint: sha256(env.WHATSAPP_ACCESS_TOKEN),
        status: "PENDING",
        outboundPaused: true,
        pauseReason: "Run Check connection before enabling outbound delivery.",
      },
    },
    { upsert: true, returnDocument: "after" },
  );
}

export async function getCurrentConnection(actor: WhatsAppActor) {
  const context = communicationScope(actor);
  if (context.scope === "PLATFORM") await bootstrapPlatformConnection();
  const connection = await WhatsAppConnection.findOne({
    bindingKey: bindingKey(context.scope, context.gymId),
  }).lean();
  return {
    configuration: {
      mode: env.WHATSAPP_MODE,
      graphApiVersion: env.WHATSAPP_API_VERSION,
      embeddedSignupReady: Boolean(
        env.WHATSAPP_MODE !== "disabled" &&
          env.WHATSAPP_APP_ID &&
          env.WHATSAPP_APP_SECRET &&
          env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID &&
          env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY,
      ),
      webhookReady: Boolean(env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET),
    },
    connection: publicConnection(connection),
  };
}

function requireEmbeddedSignupConfiguration() {
  if (env.WHATSAPP_MODE === "disabled")
    throw new AppError(503, "WHATSAPP_DISABLED", "WhatsApp integration is disabled.");
  if (
    !env.WHATSAPP_APP_ID ||
    !env.WHATSAPP_APP_SECRET ||
    !env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID ||
    !env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY
  )
    throw new AppError(
      503,
      "WHATSAPP_CONFIGURATION_MISSING",
      "Meta Embedded Signup configuration is incomplete.",
    );
}

export async function startWhatsAppOnboarding(actor: WhatsAppActor) {
  requireEmbeddedSignupConfiguration();
  const context = communicationScope(actor);
  const state = nanoid(40);
  const row = await WhatsAppOnboardingSession.create({
    publicId: nanoid(24),
    stateHash: sha256(state),
    userId: actor.userId,
    scope: context.scope,
    gymId: context.gymId,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return {
    onboardingSessionId: row.publicId,
    state,
    appId: env.WHATSAPP_APP_ID,
    configId: env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID,
    graphApiVersion: env.WHATSAPP_API_VERSION,
  };
}

export async function cancelWhatsAppOnboarding(
  actor: WhatsAppActor,
  onboardingSessionId: string,
) {
  const row = await WhatsAppOnboardingSession.findOneAndUpdate(
    {
      publicId: onboardingSessionId,
      userId: actor.userId,
      status: "STARTED",
    },
    { $set: { status: "CANCELLED" } },
    { returnDocument: "after" },
  );
  if (!row)
    throw new AppError(404, "WHATSAPP_ONBOARDING_NOT_FOUND", "Onboarding session is unavailable.");
  return { status: row.status };
}

export async function completeWhatsAppOnboarding(
  actor: WhatsAppActor,
  input: {
    onboardingSessionId: string;
    state: string;
    code: string;
    wabaId: string;
    phoneNumberId: string;
  },
) {
  requireEmbeddedSignupConfiguration();
  const context = communicationScope(actor);
  const session = await WhatsAppOnboardingSession.findOne({
    publicId: input.onboardingSessionId,
    userId: actor.userId,
    scope: context.scope,
    ...(context.gymId ? { gymId: context.gymId } : { gymId: null }),
    status: "STARTED",
    expiresAt: { $gt: new Date() },
  }).select("+stateHash");
  if (!session || session.stateHash !== sha256(input.state))
    throw new AppError(
      403,
      "WHATSAPP_ONBOARDING_STATE_INVALID",
      "This Meta onboarding result cannot be verified. Start again.",
    );

  const exchanged = await provider.exchangeEmbeddedSignupCode(input.code);
  const [waba, phones] = await Promise.all([
    provider.inspectWaba(exchanged.accessToken, input.wabaId),
    provider.listPhoneNumbers(exchanged.accessToken, input.wabaId),
  ]);
  const phone = phones.find((entry) => String(entry.id) === input.phoneNumberId);
  if (!phone || String(waba.id) !== input.wabaId)
    throw new AppError(
      403,
      "WHATSAPP_ASSET_FORBIDDEN",
      "The selected phone number is not an authorised asset of this WhatsApp Business Account.",
    );
  const key = bindingKey(context.scope, context.gymId);
  const collision = await WhatsAppConnection.findOne({
    phoneNumberId: input.phoneNumberId,
    bindingKey: { $ne: key },
  }).lean();
  if (collision)
    throw new AppError(
      409,
      "WHATSAPP_SENDER_ALREADY_BOUND",
      "This WhatsApp phone number is already connected to another GETFIT4U business scope.",
    );

  await provider.subscribeWaba(exchanged.accessToken, input.wabaId);
  const now = new Date();
  const connection = await WhatsAppConnection.findOneAndUpdate(
    { bindingKey: key },
    {
      $set: {
        scope: context.scope,
        gymId: context.gymId,
        wabaId: input.wabaId,
        phoneNumberId: input.phoneNumberId,
        displayPhoneNumber: String(phone.display_phone_number || ""),
        verifiedName: String(phone.verified_name || waba.name || ""),
        credentialCiphertext: encryptWhatsAppCredential(exchanged.accessToken),
        credentialFingerprint: sha256(exchanged.accessToken),
        credentialExpiresAt: exchanged.expiresIn
          ? new Date(now.getTime() + exchanged.expiresIn * 1000)
          : undefined,
        permissions: ["whatsapp_business_messaging", "whatsapp_business_management"],
        status: "CONNECTED",
        qualityRating: String(phone.quality_rating || ""),
        phoneStatus: String(phone.status || phone.code_verification_status || ""),
        connectedBy: actor.userId,
        connectedAt: now,
        lastVerifiedAt: now,
        outboundPaused: true,
        pauseReason: "New sender connected. Synchronise approved templates and explicitly enable outbound delivery.",
        lastErrorCategory: null,
        disconnectedAt: null,
        disconnectedBy: null,
        disconnectReason: null,
      },
      $setOnInsert: { publicId: nanoid(20), bindingKey: key },
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  session.status = "COMPLETED";
  session.completedAt = now;
  await session.save();
  return publicConnection(connection);
}

export async function resolveWhatsAppSender(
  scope: WhatsAppScope,
  gymId?: string,
  session?: ClientSession,
) {
  const query = WhatsAppConnection.findOne({
    bindingKey: bindingKey(scope, gymId),
    status: "CONNECTED",
  }).select("+credentialCiphertext +credentialFingerprint");
  if (session) query.session(session);
  const connection = await query;
  if (!connection)
    throw new AppError(
      409,
      "WHATSAPP_SENDER_DISCONNECTED",
      scope === "GYM"
        ? "This gym has not connected an available WhatsApp sender."
        : "The GETFIT4U WhatsApp sender is unavailable.",
    );
  if (!connection.credentialCiphertext)
    throw new AppError(
      409,
      "WHATSAPP_CREDENTIAL_UNAVAILABLE",
      "The WhatsApp connection must be reconnected.",
    );
  return {
    connection,
    token: decryptWhatsAppCredential(connection.credentialCiphertext),
  };
}

export async function checkWhatsAppConnection(actor: WhatsAppActor) {
  const context = communicationScope(actor);
  if (context.scope === "PLATFORM") await bootstrapPlatformConnection();
  const connection = await WhatsAppConnection.findOne({
    bindingKey: bindingKey(context.scope, context.gymId),
    status: { $in: ["PENDING", "CONNECTED", "RESTRICTED"] },
  }).select("+credentialCiphertext +credentialFingerprint");
  if (!connection)
    throw new AppError(
      404,
      "WHATSAPP_CONNECTION_NOT_FOUND",
      "Connect WhatsApp before checking the sender.",
    );
  if (!connection.credentialCiphertext)
    throw new AppError(
      409,
      "WHATSAPP_CREDENTIAL_UNAVAILABLE",
      "The WhatsApp connection must be reconnected.",
    );
  const token = decryptWhatsAppCredential(connection.credentialCiphertext);
  try {
    const phones = await provider.listPhoneNumbers(
      token,
      connection.wabaId,
    );
    const phone = phones.find(
      (entry) => String(entry.id) === connection.phoneNumberId,
    );
    if (!phone)
      throw new AppError(
        409,
        "WHATSAPP_PHONE_UNAVAILABLE",
        "The connected phone number is no longer available to this credential.",
      );
    Object.assign(connection, {
      status: "CONNECTED",
      displayPhoneNumber: String(phone.display_phone_number || ""),
      verifiedName: String(phone.verified_name || ""),
      qualityRating: String(phone.quality_rating || ""),
      phoneStatus: String(phone.status || phone.code_verification_status || ""),
      lastVerifiedAt: new Date(),
      lastErrorCategory: undefined,
    });
    await connection.save();
    return publicConnection(connection);
  } catch (error: any) {
    await WhatsAppConnection.updateOne(
      { _id: connection._id },
      {
        $set: {
          status: "RESTRICTED",
          outboundPaused: true,
          pauseReason: "Connection check failed. Reconnect before sending.",
          lastErrorCategory: error?.category || error?.code || "CONNECTION_CHECK_FAILED",
          lastErrorAt: new Date(),
        },
      },
    );
    throw error;
  }
}

export async function setWhatsAppOutboundState(
  actor: WhatsAppActor,
  paused: boolean,
  reason?: string,
) {
  const context = communicationScope(actor);
  const connection = await WhatsAppConnection.findOne({
    bindingKey: bindingKey(context.scope, context.gymId),
    status: "CONNECTED",
  });
  if (!connection)
    throw new AppError(404, "WHATSAPP_CONNECTION_NOT_FOUND", "Connect WhatsApp first.");
  if (!paused && !connection.lastTemplateSyncAt)
    throw new AppError(
      409,
      "WHATSAPP_TEMPLATES_NOT_SYNCED",
      "Synchronise approved templates before enabling outbound delivery.",
    );
  connection.outboundPaused = paused;
  connection.pauseReason = paused ? (reason || "Paused by an authorised operator.") : undefined;
  await connection.save();
  if (paused)
    await WhatsAppOutbox.updateMany(
      { connectionId: connection._id, status: "QUEUED" },
      { $set: { status: "CANCELLED", policyDecision: "SENDER_PAUSED", completedAt: new Date() } },
    );
  return publicConnection(connection);
}

export async function updateWhatsAppConnectionControls(
  actor: WhatsAppActor,
  input: {
    disabledEvents: string[];
    dailyMessages: number;
    monthlyMessages: number;
    recipientPerDay: number;
    campaignMessages: number;
    concurrentSends: number;
    quietHoursStart: string;
    quietHoursEnd: string;
    timezone: string;
    estimatedMonthlyBudgetMinor?: number;
  },
) {
  const context = communicationScope(actor);
  const connection = await WhatsAppConnection.findOneAndUpdate(
    { bindingKey: bindingKey(context.scope, context.gymId), status: "CONNECTED" },
    {
      $set: {
        "eventPreferences.disabledEvents": input.disabledEvents,
        "limits.dailyMessages": input.dailyMessages,
        "limits.monthlyMessages": input.monthlyMessages,
        "limits.recipientPerDay": input.recipientPerDay,
        "limits.campaignMessages": input.campaignMessages,
        "limits.concurrentSends": input.concurrentSends,
        "limits.quietHoursStart": input.quietHoursStart,
        "limits.quietHoursEnd": input.quietHoursEnd,
        "limits.timezone": input.timezone,
        "limits.estimatedMonthlyBudgetMinor": input.estimatedMonthlyBudgetMinor,
      },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!connection)
    throw new AppError(404, "WHATSAPP_CONNECTION_NOT_FOUND", "Connect WhatsApp before changing delivery controls.");
  return publicConnection(connection);
}

export async function disconnectWhatsApp(
  actor: WhatsAppActor,
  reason: string,
) {
  const context = communicationScope(actor);
  const connection = await WhatsAppConnection.findOne({
    bindingKey: bindingKey(context.scope, context.gymId),
  });
  if (!connection)
    throw new AppError(404, "WHATSAPP_CONNECTION_NOT_FOUND", "WhatsApp is not connected.");
  const now = new Date();
  connection.status = "DISCONNECTED";
  connection.outboundPaused = true;
  connection.pauseReason = "Sender disconnected.";
  connection.disconnectedAt = now;
  connection.disconnectedBy = actor.userId as any;
  connection.disconnectReason = reason;
  connection.set("credentialCiphertext", undefined);
  connection.set("credentialFingerprint", undefined);
  await connection.save({ validateBeforeSave: false });
  await WhatsAppOutbox.updateMany(
    { connectionId: connection._id, status: { $in: ["QUEUED", "SENDING"] } },
    { $set: { status: "CANCELLED", policyDecision: "SENDER_DISCONNECTED", completedAt: now }, $unset: { leaseId: 1, leaseUntil: 1 } },
  );
  return publicConnection(connection);
}

export async function syncWhatsAppTemplates(actor: WhatsAppActor) {
  const context = communicationScope(actor);
  const resolved = await resolveWhatsAppSender(context.scope, context.gymId);
  const templates = await provider.listTemplates(
    resolved.token,
    resolved.connection.wabaId,
  );
  const now = new Date();
  if (templates.length)
    await WhatsAppTemplate.bulkWrite(
      templates.map((template) => ({
        updateOne: {
          filter: {
            connectionId: resolved.connection._id,
            name: String(template.name),
            language: String(template.language),
          },
          update: {
            $set: {
              wabaId: resolved.connection.wabaId,
              providerTemplateId: template.id ? String(template.id) : undefined,
              category: ["UTILITY", "MARKETING", "AUTHENTICATION"].includes(String(template.category))
                ? String(template.category)
                : "UNKNOWN",
              status: ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED"].includes(String(template.status))
                ? String(template.status)
                : "UNKNOWN",
              components: template.components,
              qualityScore: template.quality_score ? String(template.quality_score) : undefined,
              syncedAt: now,
            },
            $setOnInsert: { connectionId: resolved.connection._id },
          },
          upsert: true,
        },
      })),
    );
  resolved.connection.lastTemplateSyncAt = now;
  await resolved.connection.save();
  return WhatsAppTemplate.find({ connectionId: resolved.connection._id })
    .sort({ name: 1, language: 1 })
    .lean();
}

export async function listWhatsAppTemplates(actor: WhatsAppActor) {
  const context = communicationScope(actor);
  const connection = await WhatsAppConnection.findOne({
    bindingKey: bindingKey(context.scope, context.gymId),
  }).lean();
  if (!connection) return [];
  return WhatsAppTemplate.find({ connectionId: connection._id })
    .sort({ name: 1, language: 1 })
    .lean();
}

async function userMayConsentForConnection(user: any, connection: any) {
  if (connection.scope === "PLATFORM") return user.status === "ACTIVE";
  return Boolean(
    (await MemberProfile.exists({
      userId: user._id,
      gymId: connection.gymId,
      status: { $ne: "ARCHIVED" },
    })) ||
      (await RoleAssignment.exists({
        userId: user._id,
        gymId: connection.gymId,
        status: "ACTIVE",
      })),
  );
}

async function verifiedUserPhone(user: any) {
  if (!user.phone) return;
  const digits = normalizeWhatsAppRecipient(user.phone);
  const identity = await AuthIdentity.exists({
    userId: user._id,
    provider: "PHONE",
    providerSubject: { $in: [user.phone, `+${digits}`, digits] },
    verifiedAt: { $ne: null },
  });
  return identity ? digits : undefined;
}

export async function listWhatsAppPreferences(userId: string) {
  const user = await User.findById(userId).select("roles phone").lean();
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account not found.");
  const phone = await verifiedUserPhone(user);
  const gymIds = [
    ...(await MemberProfile.distinct("gymId", { userId, status: { $ne: "ARCHIVED" } })),
    ...(await RoleAssignment.distinct("gymId", { userId, status: "ACTIVE", gymId: { $ne: null } })),
  ];
  const connections = await WhatsAppConnection.find({
    status: "CONNECTED",
    $or: [
      { scope: "PLATFORM" },
      { scope: "GYM", gymId: { $in: gymIds } },
    ],
  }).lean();
  const consents = phone
    ? await WhatsAppConsent.find({
        connectionId: { $in: connections.map((connection) => connection._id) },
        phoneHash: sha256(phone),
      }).lean()
    : [];
  const consentByConnection = new Map(
    consents.map((consent) => [String(consent.connectionId), consent]),
  );
  const gyms = await Gym.find({ _id: { $in: gymIds } }).select("name").lean();
  const gymNames = new Map(gyms.map((gym) => [String(gym._id), gym.name]));
  return {
    verifiedPhone: phone ? maskedWhatsAppPhone(phone) : null,
    businesses: connections.map((connection) => {
      const consent: any = consentByConnection.get(String(connection._id));
      return {
        connectionId: connection.publicId,
        scope: connection.scope,
        gymId: connection.gymId,
        businessName:
          connection.scope === "PLATFORM"
            ? "GETFIT4U"
            : gymNames.get(String(connection.gymId)) || connection.verifiedName || "Your gym",
        sender: connection.displayPhoneNumber || maskedWhatsAppPhone(connection.phoneNumberId),
        service: Boolean(consent?.service?.grantedAt && !consent?.service?.withdrawnAt),
        marketing: Boolean(consent?.marketing?.grantedAt && !consent?.marketing?.withdrawnAt),
        updatedAt: consent?.updatedAt,
      };
    }),
  };
}

export async function updateWhatsAppPreference(
  userId: string,
  input: { connectionId: string; service: boolean; marketing: boolean },
) {
  const [user, connection] = await Promise.all([
    User.findById(userId).select("roles phone status"),
    WhatsAppConnection.findOne({ publicId: input.connectionId, status: "CONNECTED" }),
  ]);
  if (!user || !connection || !(await userMayConsentForConnection(user, connection)))
    throw new AppError(
      404,
      "WHATSAPP_BUSINESS_NOT_FOUND",
      "This WhatsApp business is unavailable to your account.",
    );
  const phone = await verifiedUserPhone(user);
  if (!phone)
    throw new AppError(
      409,
      "WHATSAPP_PHONE_NOT_VERIFIED",
      "Verify your account phone number before enabling WhatsApp messages.",
    );
  const now = new Date();
  const decision = (enabled: boolean, purpose: "service" | "marketing") =>
    enabled
      ? {
          grantedAt: now,
          withdrawnAt: null,
          source: "APPLICATION_SETTINGS",
          wordingVersion: "whatsapp-consent-2026-09-29",
          evidence: `User enabled ${purpose} messages for ${connection.bindingKey}.`,
        }
      : {
          withdrawnAt: now,
          source: "APPLICATION_SETTINGS",
          wordingVersion: "whatsapp-consent-2026-09-29",
          evidence: `User disabled ${purpose} messages for ${connection.bindingKey}.`,
        };
  const consent = await WhatsAppConsent.findOneAndUpdate(
    { connectionId: connection._id, phoneHash: sha256(phone) },
    {
      $set: {
        scope: connection.scope,
        gymId: connection.gymId,
        userId: user._id,
        service: decision(input.service, "service"),
        marketing: decision(input.marketing, "marketing"),
        suppressionReason: !input.service && !input.marketing ? "USER_WITHDREW" : null,
      },
      $setOnInsert: { publicId: nanoid(20), connectionId: connection._id, phoneHash: sha256(phone) },
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  const cancelledPurposes = [
    ...(!input.service ? ["SERVICE"] : []),
    ...(!input.marketing ? ["MARKETING"] : []),
  ];
  if (cancelledPurposes.length)
    await WhatsAppOutbox.updateMany(
      {
        connectionId: connection._id,
        recipientHash: sha256(phone),
        purpose: { $in: cancelledPurposes },
        status: "QUEUED",
      },
      {
        $set: {
          status: "SUPPRESSED",
          policyDecision: "CONSENT_WITHDRAWN",
          completedAt: now,
        },
      },
    );
  return {
    connectionId: connection.publicId,
    service: Boolean(consent.service?.grantedAt && !consent.service?.withdrawnAt),
    marketing: Boolean(consent.marketing?.grantedAt && !consent.marketing?.withdrawnAt),
  };
}

export async function suppressWhatsAppContact(
  connectionId: string,
  providerContactId: string,
  reason = "INBOUND_STOP",
) {
  const phone = normalizeWhatsAppRecipient(providerContactId);
  const now = new Date();
  await WhatsAppConsent.findOneAndUpdate(
    { connectionId, phoneHash: sha256(phone) },
    {
      $set: {
        "service.withdrawnAt": now,
        "service.source": "INBOUND_KEYWORD",
        "marketing.withdrawnAt": now,
        "marketing.source": "INBOUND_KEYWORD",
        lastInboundOptOutAt: now,
        suppressionReason: reason,
      },
      $setOnInsert: { publicId: nanoid(20), connectionId, phoneHash: sha256(phone) },
    },
    { upsert: true },
  );
  await WhatsAppOutbox.updateMany(
    { connectionId, recipientHash: sha256(phone), status: "QUEUED" },
    {
      $set: { status: "SUPPRESSED", policyDecision: reason, completedAt: now },
    },
  );
}
