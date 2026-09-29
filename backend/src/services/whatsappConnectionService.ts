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
export type WhatsAppConnectionMode = "STANDARD" | "COEXISTENCE";
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
    connectionMode: connection.connectionMode || "STANDARD",
    readinessStatus: connection.readinessStatus ||
      (connection.status === "CONNECTED" ? "CONNECTED" : "NOT_CONNECTED"),
    businessVerificationStatus: connection.businessVerificationStatus || "UNKNOWN",
    synchronizationStatus: connection.synchronizationStatus || "NOT_STARTED",
    capabilities: connection.capabilities,
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
    lastErrorCode: connection.lastErrorCode,
    diagnosticReference: connection.diagnosticReference,
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
        connectionMode: "STANDARD",
        readinessStatus: "CONNECTING",
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
      coexistenceEnabled: env.WHATSAPP_COEXISTENCE_ENABLED,
      coexistenceReady: Boolean(
        env.WHATSAPP_COEXISTENCE_ENABLED &&
          env.WHATSAPP_APP_ID &&
          env.WHATSAPP_APP_SECRET &&
          (env.WHATSAPP_COEXISTENCE_CONFIG_ID || env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID) &&
          env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY,
      ),
      embeddedSignupVersion: "v4",
      webhookReady: Boolean(env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_APP_SECRET),
    },
    connection: publicConnection(connection),
  };
}

function requireEmbeddedSignupConfiguration(mode: WhatsAppConnectionMode) {
  if (env.WHATSAPP_MODE === "disabled")
    throw new AppError(503, "WHATSAPP_DISABLED", "WhatsApp integration is disabled.");
  const configId = mode === "COEXISTENCE"
    ? env.WHATSAPP_COEXISTENCE_CONFIG_ID || env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
    : env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID;
  if (
    !env.WHATSAPP_APP_ID ||
    !env.WHATSAPP_APP_SECRET ||
    !configId ||
    !env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY
  )
    throw new AppError(
      503,
      "WHATSAPP_CONFIGURATION_MISSING",
      "Meta Embedded Signup configuration is incomplete.",
    );
  if (mode === "COEXISTENCE" && !env.WHATSAPP_COEXISTENCE_ENABLED)
    throw new AppError(
      404,
      "WHATSAPP_COEXISTENCE_DISABLED",
      "Connecting an existing WhatsApp Business app number is not enabled for this deployment.",
    );
}

export function normalizeEmbeddedSignupEvent(
  mode: WhatsAppConnectionMode,
  payload: { event?: unknown; version?: unknown; data?: Record<string, unknown> },
) {
  const event = String(payload.event || "");
  const allowed = mode === "COEXISTENCE"
    ? ["FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"]
    : ["FINISH"];
  if (!allowed.includes(event))
    throw new AppError(
      422,
      "WHATSAPP_ONBOARDING_EVENT_INVALID",
      "Meta returned an onboarding event for a different connection mode. Start again.",
    );
  const data = payload.data || {};
  const wabaId = String(data.waba_id || "");
  const phoneNumberId = String(data.phone_number_id || "");
  if (!/^\d{5,40}$/.test(wabaId))
    throw new AppError(
      422,
      "WHATSAPP_ONBOARDING_EVENT_INCOMPLETE",
      "Meta did not return the WhatsApp Business Account. Continue or restart onboarding.",
    );
  const historyValue = data.history_sharing ?? data.is_history_sharing_enabled;
  return {
    event,
    version: String(payload.version || ""),
    wabaId,
    phoneNumberId: /^\d{5,40}$/.test(phoneNumberId) ? phoneNumberId : undefined,
    historySharing: historyValue === true
      ? "ACCEPTED" as const
      : historyValue === false
        ? "DECLINED" as const
        : "UNKNOWN" as const,
  };
}

export async function startWhatsAppOnboarding(
  actor: WhatsAppActor,
  connectionMode: WhatsAppConnectionMode = "STANDARD",
) {
  requireEmbeddedSignupConfiguration(connectionMode);
  const context = communicationScope(actor);
  if (connectionMode === "COEXISTENCE" && context.scope !== "GYM")
    throw new AppError(
      422,
      "WHATSAPP_COEXISTENCE_GYM_REQUIRED",
      "Select a gym before connecting its existing WhatsApp Business app number.",
    );
  const state = nanoid(40);
  const row = await WhatsAppOnboardingSession.create({
    publicId: nanoid(24),
    stateHash: sha256(state),
    userId: actor.userId,
    scope: context.scope,
    gymId: context.gymId,
    connectionMode,
    status: "STARTED",
    authorizationStatus: "PENDING",
    diagnosticReference: nanoid(12),
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  return {
    onboardingSessionId: row.publicId,
    state,
    connectionMode,
    appId: env.WHATSAPP_APP_ID,
    configId: connectionMode === "COEXISTENCE"
      ? env.WHATSAPP_COEXISTENCE_CONFIG_ID || env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID
      : env.WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID,
    graphApiVersion: env.WHATSAPP_API_VERSION,
    embeddedSignupVersion: "v4" as const,
    featureType: connectionMode === "COEXISTENCE"
      ? "whatsapp_business_app_onboarding"
      : undefined,
    diagnosticReference: row.diagnosticReference,
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
      status: {
        $in: [
          "STARTED",
          "AWAITING_AUTHORIZATION",
          "AWAITING_OWNER_CONFIRMATION",
          "AWAITING_PHONE_SELECTION",
          "ACTION_REQUIRED",
          "FAILED",
        ],
      },
    },
    { $set: { status: "CANCELLED" } },
    { returnDocument: "after" },
  );
  if (!row)
    throw new AppError(404, "WHATSAPP_ONBOARDING_NOT_FOUND", "Onboarding session is unavailable.");
  return { status: row.status };
}

type OnboardingCompletionInput = {
  onboardingSessionId: string;
  state: string;
  code?: string;
  selectedPhoneNumberId?: string;
  sessionEvent?: {
    event?: unknown;
    version?: unknown;
    data?: Record<string, unknown>;
  };
};

function onboardingProgress(session: any, connection?: any) {
  return {
    status: session.status,
    connectionMode: session.connectionMode,
    diagnosticReference: session.diagnosticReference,
    candidates: (session.candidatePhones || []).map((candidate: any) => ({
      phoneNumberId: candidate.phoneNumberId,
      displayPhoneNumber: candidate.displayPhoneNumber,
      verifiedName: candidate.verifiedName,
      phoneStatus: candidate.phoneStatus,
      platformType: candidate.platformType,
    })),
    connection: publicConnection(connection),
  };
}

export async function completeWhatsAppOnboarding(
  actor: WhatsAppActor,
  input: OnboardingCompletionInput,
) {
  const context = communicationScope(actor);
  let session: any = await WhatsAppOnboardingSession.findOne({
    publicId: input.onboardingSessionId,
    userId: actor.userId,
    scope: context.scope,
    ...(context.gymId ? { gymId: context.gymId } : { gymId: null }),
    expiresAt: { $gt: new Date() },
    status: { $nin: ["CANCELLED", "EXPIRED"] },
  }).select("+stateHash +credentialCiphertext +credentialFingerprint");
  if (!session || session.stateHash !== sha256(input.state))
    throw new AppError(
      403,
      "WHATSAPP_ONBOARDING_STATE_INVALID",
      "This Meta onboarding result cannot be verified. Start again.",
    );
  requireEmbeddedSignupConfiguration(session.connectionMode);

  if (session.status === "COMPLETED") {
    const existing = session.connectionId
      ? await WhatsAppConnection.findById(session.connectionId).lean()
      : null;
    return onboardingProgress(session, existing);
  }

  if (input.sessionEvent) {
    const normalized = normalizeEmbeddedSignupEvent(
      session.connectionMode,
      input.sessionEvent,
    );
    if (session.wabaId && session.wabaId !== normalized.wabaId)
      throw new AppError(
        409,
        "WHATSAPP_ONBOARDING_ASSET_CHANGED",
        "Meta returned different business assets for this attempt. Start again.",
      );
    session.sessionEvent = normalized.event;
    session.sessionEventVersion = normalized.version;
    session.wabaId = normalized.wabaId;
    session.phoneNumberId = normalized.phoneNumberId;
    session.historySharing = normalized.historySharing;
  }

  if (input.selectedPhoneNumberId) {
    const candidate = (session.candidatePhones || []).find(
      (entry: any) => String(entry.phoneNumberId) === input.selectedPhoneNumberId,
    );
    if (!candidate)
      throw new AppError(
        403,
        "WHATSAPP_ASSET_FORBIDDEN",
        "Select a phone number returned by this protected onboarding attempt.",
      );
    session.selectedPhoneNumberId = input.selectedPhoneNumberId;
  }

  if (input.code && session.authorizationStatus !== "READY") {
    if (session.authorizationStatus === "EXCHANGING")
      return onboardingProgress(session);
    session.authorizationStatus = "EXCHANGING";
    await session.save();
    try {
      const exchanged = await provider.exchangeEmbeddedSignupCode(input.code);
      const tokenState = await provider.inspectToken(exchanged.accessToken);
      const requiredPermissions = [
        "whatsapp_business_messaging",
        "whatsapp_business_management",
      ];
      if (
        !tokenState.valid ||
        tokenState.appId !== env.WHATSAPP_APP_ID ||
        requiredPermissions.some((permission) => !tokenState.scopes.includes(permission))
      )
        throw new AppError(
          403,
          "WHATSAPP_PERMISSIONS_REQUIRED",
          "Meta did not grant the required WhatsApp permissions. Review the app access and try again.",
        );
      session.credentialCiphertext = encryptWhatsAppCredential(exchanged.accessToken);
      session.credentialFingerprint = sha256(exchanged.accessToken);
      session.credentialExpiresAt = exchanged.expiresIn
        ? new Date(Date.now() + exchanged.expiresIn * 1000)
        : undefined;
      session.authorizationStatus = "READY";
      session.lastErrorCode = undefined;
      session.lastErrorMessage = undefined;
    } catch (error: any) {
      session.authorizationStatus = "FAILED";
      session.status = "ACTION_REQUIRED";
      session.lastErrorCode = String(
        error?.providerCode || error?.code || error?.category || "WHATSAPP_AUTHORIZATION_FAILED",
      );
      session.lastErrorMessage = String(error?.message || "Meta authorization failed.").slice(0, 500);
      await session.save();
      if (error instanceof AppError) throw error;
      throw new AppError(
        502,
        "WHATSAPP_AUTHORIZATION_FAILED",
        `Meta authorization could not be completed. Reference ${session.diagnosticReference}.`,
      );
    }
  }

  if (session.authorizationStatus !== "READY") {
    session.status = "AWAITING_AUTHORIZATION";
    await session.save();
    return onboardingProgress(session);
  }
  if (!session.wabaId || !session.sessionEvent) {
    session.status = "AWAITING_OWNER_CONFIRMATION";
    await session.save();
    return onboardingProgress(session);
  }

  const token = decryptWhatsAppCredential(session.credentialCiphertext);
  let waba: Record<string, any>;
  let phones: Array<Record<string, any>>;
  try {
    [waba, phones] = await Promise.all([
      provider.inspectWaba(token, session.wabaId),
      provider.listPhoneNumbers(token, session.wabaId),
    ]);
  } catch (error: any) {
    session.status = "ACTION_REQUIRED";
    session.lastErrorCode = String(
      error?.code || error?.category || "WHATSAPP_ASSET_INSPECTION_FAILED",
    ).slice(0, 100);
    session.lastErrorMessage = "Meta could not validate the authorized WhatsApp assets.";
    await session.save();
    throw new AppError(
      502,
      "WHATSAPP_ASSET_INSPECTION_FAILED",
      `Meta could not validate the authorized WhatsApp assets. Reference ${session.diagnosticReference}.`,
    );
  }
  if (String(waba.id) !== session.wabaId)
    throw new AppError(
      403,
      "WHATSAPP_ASSET_FORBIDDEN",
      "The returned WhatsApp Business Account is not authorised by this credential.",
    );
  const selectedPhoneId = session.phoneNumberId || session.selectedPhoneNumberId;
  if (!selectedPhoneId) {
    if (phones.length === 0) {
      session.status = "ACTION_REQUIRED";
      session.lastErrorCode = "WHATSAPP_NO_ELIGIBLE_PHONE";
      session.lastErrorMessage = "Meta did not return an eligible WhatsApp phone number for this business account.";
      await session.save();
      throw new AppError(
        409,
        "WHATSAPP_NO_ELIGIBLE_PHONE",
        `Meta did not return an eligible WhatsApp phone number. Check number eligibility and app access, then retry. Reference ${session.diagnosticReference}.`,
      );
    }
    session.candidatePhones = phones.map((phone) => ({
      phoneNumberId: String(phone.id || ""),
      displayPhoneNumber: String(phone.display_phone_number || ""),
      verifiedName: String(phone.verified_name || ""),
      phoneStatus: String(phone.status || phone.code_verification_status || ""),
      platformType: String(phone.platform_type || ""),
    }));
    session.status = "AWAITING_PHONE_SELECTION";
    await session.save();
    return onboardingProgress(session);
  }
  const phone = phones.find((entry) => String(entry.id) === selectedPhoneId);
  if (!phone)
    throw new AppError(
      403,
      "WHATSAPP_ASSET_FORBIDDEN",
      "The selected phone number is not an authorised asset of this WhatsApp Business Account.",
    );

  const key = bindingKey(context.scope, context.gymId);
  const collision = await WhatsAppConnection.findOne({
    phoneNumberId: selectedPhoneId,
    bindingKey: { $ne: key },
  }).lean();
  if (collision)
    throw new AppError(
      409,
      "WHATSAPP_SENDER_ALREADY_BOUND",
      "This WhatsApp phone number is already connected to another GETFIT4U business scope.",
    );

  const providerPhoneStatus = String(
    phone.status || phone.code_verification_status || "UNKNOWN",
  ).toUpperCase();
  const phoneReady = providerPhoneStatus === "CONNECTED";
  const limitations = phoneReady
    ? []
    : ["Meta has not reported this phone number as connected. Complete the action shown in Meta before enabling outbound delivery."];

  const leaseId = nanoid(20);
  const leaseNow = new Date();
  const claimed = await WhatsAppOnboardingSession.findOneAndUpdate(
    {
      _id: session._id,
      status: { $ne: "COMPLETED" },
      $or: [
        { finalizationLeaseUntil: { $exists: false } },
        { finalizationLeaseUntil: null },
        { finalizationLeaseUntil: { $lte: leaseNow } },
      ],
    },
    {
      $set: {
        status: "FINALIZING",
        finalizationLeaseId: leaseId,
        finalizationLeaseUntil: new Date(leaseNow.getTime() + 60_000),
      },
    },
    { returnDocument: "after" },
  );
  if (!claimed) {
    const latest: any = await WhatsAppOnboardingSession.findOne({
      _id: session._id,
    }).select("+stateHash +credentialCiphertext +credentialFingerprint");
    const existing = latest?.status === "COMPLETED" && latest.connectionId
      ? await WhatsAppConnection.findById(latest.connectionId).lean()
      : null;
    return onboardingProgress(latest || session, existing);
  }

  session.status = "FINALIZING";
  session.finalizationLeaseId = leaseId;
  session.finalizationLeaseUntil = claimed.finalizationLeaseUntil;
  try {
    await provider.subscribeWaba(token, session.wabaId);
    const now = new Date();
    const connection = await WhatsAppConnection.findOneAndUpdate(
      { bindingKey: key },
      {
        $set: {
          scope: context.scope,
          gymId: context.gymId,
          connectionMode: session.connectionMode,
          wabaId: session.wabaId,
          phoneNumberId: selectedPhoneId,
          displayPhoneNumber: String(phone.display_phone_number || ""),
          verifiedName: String(phone.verified_name || waba.name || ""),
          credentialCiphertext: session.credentialCiphertext,
          credentialFingerprint: session.credentialFingerprint,
          credentialExpiresAt: session.credentialExpiresAt,
          permissions: ["whatsapp_business_messaging", "whatsapp_business_management"],
          status: phoneReady ? "CONNECTED" : "RESTRICTED",
          readinessStatus: phoneReady ? "SYNCHRONIZING" : "ACTION_REQUIRED",
          coexistenceStatus: session.connectionMode === "COEXISTENCE" ? "ACTIVE" : "UNKNOWN",
          synchronizationStatus: session.historySharing === "DECLINED" ? "DECLINED" : "PENDING",
          capabilities: {
            businessAppMessaging: session.connectionMode === "COEXISTENCE",
            appMessageEchoes: session.connectionMode === "COEXISTENCE",
            historySharing: session.historySharing,
            limitations,
          },
          qualityRating: String(phone.quality_rating || ""),
          phoneStatus: providerPhoneStatus,
          connectedBy: actor.userId,
          connectedAt: now,
          lastVerifiedAt: now,
          outboundPaused: true,
          pauseReason: "New sender connected. Synchronise approved templates and explicitly enable outbound delivery.",
          lastErrorCategory: phoneReady ? null : "SENDER_NOT_READY",
          lastErrorCode: phoneReady ? null : "WHATSAPP_PHONE_NOT_CONNECTED",
          diagnosticReference: session.diagnosticReference,
          disconnectedAt: null,
          disconnectedBy: null,
          disconnectReason: null,
        },
        $setOnInsert: { publicId: nanoid(20), bindingKey: key },
      },
      { upsert: true, returnDocument: "after", runValidators: true },
    );
    session.status = "COMPLETED";
    session.connectionId = connection._id;
    session.phoneNumberId = selectedPhoneId;
    session.completedAt = now;
    session.credentialCiphertext = undefined;
    session.credentialFingerprint = undefined;
    session.finalizationLeaseId = undefined;
    session.finalizationLeaseUntil = undefined;
    await session.save({ validateBeforeSave: false });
    return onboardingProgress(session, connection);
  } catch (error: any) {
    session.status = "ACTION_REQUIRED";
    session.lastErrorCode = String(
      error?.code || error?.category || "WHATSAPP_PROVIDER_SETUP_FAILED",
    ).slice(0, 100);
    session.lastErrorMessage = "Meta could not finish the WhatsApp connection. Retry this protected onboarding session.";
    session.finalizationLeaseId = undefined;
    session.finalizationLeaseUntil = undefined;
    await session.save({ validateBeforeSave: false });
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "WHATSAPP_PROVIDER_SETUP_FAILED",
      `Meta could not finish the WhatsApp connection. Reference ${session.diagnosticReference}.`,
    );
  }
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
    const providerPhoneStatus = String(
      phone.status || phone.code_verification_status || "UNKNOWN",
    ).toUpperCase();
    if (providerPhoneStatus !== "CONNECTED")
      throw new AppError(
        409,
        "WHATSAPP_PHONE_NOT_CONNECTED",
        "Meta reports that this WhatsApp phone number requires action before messaging can be enabled.",
      );
    Object.assign(connection, {
      status: "CONNECTED",
      readinessStatus: connection.lastTemplateSyncAt
        ? (connection.capabilities?.limitations?.length ? "CONNECTED_LIMITED" : "CONNECTED")
        : "SYNCHRONIZING",
      displayPhoneNumber: String(phone.display_phone_number || ""),
      verifiedName: String(phone.verified_name || ""),
      qualityRating: String(phone.quality_rating || ""),
      phoneStatus: providerPhoneStatus,
      lastVerifiedAt: new Date(),
      lastErrorCategory: undefined,
      lastErrorCode: undefined,
    });
    await connection.save();
    return publicConnection(connection);
  } catch (error: any) {
    await WhatsAppConnection.updateOne(
      { _id: connection._id },
      {
        $set: {
          status: "RESTRICTED",
          readinessStatus: "ACTION_REQUIRED",
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
  connection.readinessStatus = "DISCONNECTED";
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
  resolved.connection.readinessStatus = resolved.connection.capabilities?.limitations?.length
    ? "CONNECTED_LIMITED"
    : "CONNECTED";
  if (resolved.connection.synchronizationStatus === "PENDING")
    resolved.connection.synchronizationStatus = "COMPLETE";
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
