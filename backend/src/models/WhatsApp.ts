import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const connectionSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    bindingKey: { type: String, required: true, unique: true },
    scope: { type: String, enum: ["PLATFORM", "GYM"], required: true, index: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    wabaId: { type: String, required: true, index: true },
    phoneNumberId: { type: String, required: true, unique: true },
    displayPhoneNumber: { type: String, maxlength: 40 },
    verifiedName: { type: String, maxlength: 160 },
    credentialCiphertext: { type: String, required: true, select: false },
    credentialFingerprint: { type: String, required: true, select: false },
    credentialExpiresAt: Date,
    permissions: [{ type: String, maxlength: 100 }],
    connectionMode: {
      type: String,
      enum: ["STANDARD", "COEXISTENCE"],
      default: "STANDARD",
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "CONNECTED", "RESTRICTED", "DISCONNECTED", "ERROR"],
      default: "PENDING",
      index: true,
    },
    qualityRating: String,
    phoneStatus: String,
    coexistenceStatus: {
      type: String,
      enum: ["UNKNOWN", "ELIGIBLE", "ACTIVE", "NOT_ELIGIBLE", "MIGRATION_REQUIRED"],
      default: "UNKNOWN",
    },
    readinessStatus: {
      type: String,
      enum: [
        "NOT_CONNECTED",
        "CONNECTING",
        "AWAITING_OWNER_CONFIRMATION",
        "FINALIZING",
        "SYNCHRONIZING",
        "CONNECTED",
        "CONNECTED_LIMITED",
        "ACTION_REQUIRED",
        "DISCONNECTED",
        "FAILED",
      ],
      default: "NOT_CONNECTED",
      index: true,
    },
    businessVerificationStatus: {
      type: String,
      enum: ["UNKNOWN", "VERIFIED", "NOT_VERIFIED", "IN_REVIEW", "REQUIRED"],
      default: "UNKNOWN",
    },
    synchronizationStatus: {
      type: String,
      enum: ["NOT_STARTED", "PENDING", "IN_PROGRESS", "COMPLETE", "PARTIAL", "DECLINED", "FAILED"],
      default: "NOT_STARTED",
    },
    capabilities: {
      businessAppMessaging: { type: Boolean, default: false },
      appMessageEchoes: { type: Boolean, default: false },
      historySharing: { type: String, enum: ["UNKNOWN", "ACCEPTED", "DECLINED"], default: "UNKNOWN" },
      limitations: [{ type: String, maxlength: 200 }],
    },
    outboundPaused: { type: Boolean, default: true },
    pauseReason: { type: String, maxlength: 500 },
    eventPreferences: { disabledEvents: [{ type: String, maxlength: 120 }] },
    limits: {
      dailyMessages: { type: Number, min: 1, max: 1_000_000, default: 500 },
      monthlyMessages: { type: Number, min: 1, max: 10_000_000, default: 10_000 },
      recipientPerDay: { type: Number, min: 1, max: 100, default: 5 },
      campaignMessages: { type: Number, min: 1, max: 100_000, default: 250 },
      concurrentSends: { type: Number, min: 1, max: 100, default: 5 },
      quietHoursStart: { type: String, default: "21:00" },
      quietHoursEnd: { type: String, default: "08:00" },
      timezone: { type: String, default: "Asia/Kolkata" },
      estimatedMonthlyBudgetMinor: { type: Number, min: 0 },
    },
    connectedBy: { type: Schema.Types.ObjectId, ref: "User" },
    connectedAt: Date,
    lastVerifiedAt: Date,
    lastTemplateSyncAt: Date,
    disconnectedBy: { type: Schema.Types.ObjectId, ref: "User" },
    disconnectedAt: Date,
    disconnectReason: { type: String, maxlength: 500 },
    lastErrorCategory: String,
    lastErrorCode: String,
    diagnosticReference: { type: String, maxlength: 80 },
    lastErrorAt: Date,
  },
  { timestamps: true },
);
connectionSchema.index({ scope: 1, gymId: 1, status: 1 });

const consentDecision = new Schema(
  {
    grantedAt: Date,
    withdrawnAt: Date,
    source: { type: String, maxlength: 80 },
    wordingVersion: { type: String, maxlength: 80 },
    evidence: { type: String, maxlength: 500 },
  },
  { _id: false },
);

const consentSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    connectionId: {
      type: Schema.Types.ObjectId,
      ref: "WhatsAppConnection",
      required: true,
      index: true,
    },
    scope: { type: String, enum: ["PLATFORM", "GYM"], required: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    phoneHash: { type: String, required: true },
    service: { type: consentDecision, default: () => ({}) },
    marketing: { type: consentDecision, default: () => ({}) },
    lastInboundOptOutAt: Date,
    suppressionReason: String,
  },
  { timestamps: true },
);
consentSchema.index({ connectionId: 1, phoneHash: 1 }, { unique: true });
consentSchema.index({ userId: 1, scope: 1, gymId: 1 });

const conversationSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    connectionId: {
      type: Schema.Types.ObjectId,
      ref: "WhatsAppConnection",
      required: true,
      index: true,
    },
    scope: { type: String, enum: ["PLATFORM", "GYM"], required: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    providerContactId: { type: String, required: true, select: false },
    providerContactHash: { type: String, required: true },
    displayPhone: { type: String, maxlength: 40 },
    contactName: { type: String, maxlength: 160 },
    linkedUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    assignmentUserId: { type: Schema.Types.ObjectId, ref: "User" },
    lastInboundAt: Date,
    lastOutboundAt: Date,
    lastMessageAt: { type: Date, index: true },
    unreadCount: { type: Number, min: 0, default: 0 },
    archivedAt: Date,
    status: { type: String, enum: ["OPEN", "CLOSED"], default: "OPEN" },
  },
  { timestamps: true },
);
conversationSchema.index(
  { connectionId: 1, providerContactHash: 1 },
  { unique: true },
);
conversationSchema.index({ connectionId: 1, archivedAt: 1, lastMessageAt: -1 });

const messageSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "WhatsAppConversation",
      required: true,
      index: true,
    },
    connectionId: {
      type: Schema.Types.ObjectId,
      ref: "WhatsAppConnection",
      required: true,
      index: true,
    },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    direction: { type: String, enum: ["INBOUND", "OUTBOUND"], required: true },
    source: {
      type: String,
      enum: ["WEBHOOK", "HUMAN", "BUSINESS_APP", "HISTORY_IMPORT", "BUSINESS_EVENT", "CAMPAIGN", "SYSTEM"],
      required: true,
    },
    providerMessageId: { type: String, unique: true, sparse: true },
    outboxId: { type: Schema.Types.ObjectId, ref: "WhatsAppOutbox" },
    contentType: {
      type: String,
      enum: ["TEXT", "TEMPLATE", "IMAGE", "DOCUMENT", "AUDIO", "VIDEO", "LOCATION", "CONTACT", "UNSUPPORTED"],
      required: true,
    },
    text: { type: String, maxlength: 5000 },
    template: {
      name: String,
      language: String,
      category: String,
      parameters: Schema.Types.Mixed,
    },
    media: {
      providerMediaId: String,
      attachmentId: { type: Schema.Types.ObjectId, ref: "Attachment" },
      mimeType: String,
      filename: String,
      size: Number,
    },
    status: {
      type: String,
      enum: ["RECEIVED", "QUEUED", "SENDING", "ACCEPTED", "SENT", "DELIVERED", "READ", "FAILED", "SUPPRESSED", "CANCELLED", "EXPIRED", "UNKNOWN_OUTCOME"],
      required: true,
      index: true,
    },
    providerTimestamp: Date,
    acceptedAt: Date,
    sentAt: Date,
    deliveredAt: Date,
    readAt: Date,
    failedAt: Date,
    errorCategory: String,
    providerErrorCode: String,
    correlationId: String,
    importedHistory: { type: Boolean, default: false },
  },
  { timestamps: true },
);
messageSchema.index({ conversationId: 1, createdAt: -1 });

const outboxSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    dedupeKey: { type: String, required: true, unique: true },
    businessEvent: { type: String, maxlength: 120 },
    businessEntityId: String,
    connectionId: {
      type: Schema.Types.ObjectId,
      ref: "WhatsAppConnection",
      required: true,
      index: true,
    },
    scope: { type: String, enum: ["PLATFORM", "GYM"], required: true, index: true },
    conversationId: { type: Schema.Types.ObjectId, ref: "WhatsAppConversation" },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    recipientUserId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    recipientId: { type: String, required: true, select: false },
    recipientHash: { type: String, required: true },
    purpose: { type: String, enum: ["SERVICE", "MARKETING"], required: true },
    contentType: { type: String, enum: ["TEXT", "TEMPLATE"], required: true },
    text: { type: String, maxlength: 5000 },
    template: {
      name: String,
      language: String,
      parameters: Schema.Types.Mixed,
    },
    actionUrl: String,
    status: {
      type: String,
      enum: ["QUEUED", "SENDING", "ACCEPTED", "SENT", "DELIVERED", "READ", "FAILED", "SUPPRESSED", "CANCELLED", "EXPIRED", "UNKNOWN_OUTCOME"],
      default: "QUEUED",
      index: true,
    },
    policyDecision: String,
    attempts: { type: Number, min: 0, default: 0 },
    availableAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    leaseId: String,
    leaseUntil: Date,
    providerMessageId: { type: String, unique: true, sparse: true },
    lastErrorCategory: String,
    lastProviderCode: String,
    acceptedAt: Date,
    completedAt: Date,
    correlationId: String,
  },
  { timestamps: true },
);
outboxSchema.index({ status: 1, availableAt: 1, leaseUntil: 1 });
outboxSchema.index({ connectionId: 1, recipientHash: 1, createdAt: -1 });

const webhookReceiptSchema = new Schema(
  {
    eventKey: { type: String, required: true, unique: true },
    contentHash: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true, select: false },
    status: {
      type: String,
      enum: ["RECEIVED", "PROCESSING", "PROCESSED", "FAILED"],
      default: "RECEIVED",
      index: true,
    },
    attempts: { type: Number, min: 0, default: 0 },
    availableAt: { type: Date, default: Date.now },
    leaseId: String,
    leaseUntil: Date,
    lastErrorCategory: String,
    processedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
webhookReceiptSchema.index({ status: 1, availableAt: 1, leaseUntil: 1 });
webhookReceiptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const templateSchema = new Schema(
  {
    connectionId: {
      type: Schema.Types.ObjectId,
      ref: "WhatsAppConnection",
      required: true,
      index: true,
    },
    wabaId: { type: String, required: true },
    providerTemplateId: String,
    name: { type: String, required: true },
    language: { type: String, required: true },
    category: { type: String, enum: ["UTILITY", "MARKETING", "AUTHENTICATION", "UNKNOWN"], default: "UNKNOWN" },
    status: { type: String, enum: ["APPROVED", "PENDING", "REJECTED", "PAUSED", "DISABLED", "UNKNOWN"], default: "UNKNOWN", index: true },
    components: Schema.Types.Mixed,
    qualityScore: String,
    syncedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);
templateSchema.index({ connectionId: 1, name: 1, language: 1 }, { unique: true });

const onboardingSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    stateHash: { type: String, required: true, select: false },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    scope: { type: String, enum: ["PLATFORM", "GYM"], required: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    connectionMode: { type: String, enum: ["STANDARD", "COEXISTENCE"], required: true },
    status: {
      type: String,
      enum: [
        "STARTED",
        "AWAITING_AUTHORIZATION",
        "AWAITING_OWNER_CONFIRMATION",
        "AWAITING_PHONE_SELECTION",
        "FINALIZING",
        "COMPLETED",
        "ACTION_REQUIRED",
        "FAILED",
        "CANCELLED",
        "EXPIRED",
      ],
      default: "STARTED",
      index: true,
    },
    authorizationStatus: {
      type: String,
      enum: ["PENDING", "EXCHANGING", "READY", "FAILED"],
      default: "PENDING",
    },
    authorizationLeaseId: String,
    authorizationLeaseUntil: Date,
    credentialCiphertext: { type: String, select: false },
    credentialFingerprint: { type: String, select: false },
    credentialExpiresAt: Date,
    sessionEvent: String,
    sessionEventVersion: String,
    wabaId: String,
    phoneNumberId: String,
    selectedPhoneNumberId: String,
    candidatePhones: [{
      phoneNumberId: String,
      displayPhoneNumber: String,
      verifiedName: String,
      phoneStatus: String,
      platformType: String,
    }],
    historySharing: { type: String, enum: ["UNKNOWN", "ACCEPTED", "DECLINED"], default: "UNKNOWN" },
    connectionId: { type: Schema.Types.ObjectId, ref: "WhatsAppConnection" },
    diagnosticReference: { type: String, maxlength: 80 },
    lastErrorCode: String,
    lastErrorMessage: { type: String, maxlength: 500 },
    finalizationLeaseId: String,
    finalizationLeaseUntil: Date,
    completedAt: Date,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
onboardingSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const WhatsAppConnection =
  models.WhatsAppConnection || model("WhatsAppConnection", connectionSchema);
export const WhatsAppConsent =
  models.WhatsAppConsent || model("WhatsAppConsent", consentSchema);
export const WhatsAppConversation =
  models.WhatsAppConversation || model("WhatsAppConversation", conversationSchema);
export const WhatsAppMessage =
  models.WhatsAppMessage || model("WhatsAppMessage", messageSchema);
export const WhatsAppOutbox =
  models.WhatsAppOutbox || model("WhatsAppOutbox", outboxSchema);
export const WhatsAppWebhookReceipt =
  models.WhatsAppWebhookReceipt || model("WhatsAppWebhookReceipt", webhookReceiptSchema);
export const WhatsAppTemplate =
  models.WhatsAppTemplate || model("WhatsAppTemplate", templateSchema);
export const WhatsAppOnboardingSession =
  models.WhatsAppOnboardingSession || model("WhatsAppOnboardingSession", onboardingSchema);
