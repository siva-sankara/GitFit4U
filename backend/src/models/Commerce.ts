import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const platformPlanSchema = new Schema(
  {
    code: { type: String, required: true },
    version: { type: Number, required: true, default: 1 },
    name: { type: String, required: true },
    billingPeriod: {
      type: String,
      enum: ["MONTHLY", "YEARLY"],
      required: true,
    },
    priceMinor: { type: Number, min: 0, required: true },
    currency: { type: String, default: "INR" },
    memberLimit: Number,
    staffLimit: Number,
    features: [String],
    active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true },
);
platformPlanSchema.index({ code: 1, version: 1 }, { unique: true });

const membershipPlanSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: true,
      index: true,
    },
    code: { type: String, required: true },
    version: { type: Number, required: true, default: 1 },
    name: { type: String, required: true, trim: true },
    description: String,
    durationDays: { type: Number, min: 1, required: true },
    priceMinor: { type: Number, min: 0, required: true },
    discountMinor: { type: Number, min: 0, default: 0 },
    taxRateBasisPoints: { type: Number, min: 0, default: 0 },
    currency: { type: String, default: "INR" },
    benefits: [String],
    classAccess: [String],
    personalTrainingSessions: { type: Number, min: 0, default: 0 },
    accessHours: { from: String, to: String },
    freezeDaysAllowed: { type: Number, min: 0, default: 0 },
    trialDays: { type: Number, min: 0, default: 0 },
    autoRenewAllowed: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"],
      default: "DRAFT",
    },
  },
  {
    timestamps: true,
    versionKey: "documentVersion",
    optimisticConcurrency: true,
  },
);
membershipPlanSchema.index({ gymId: 1, code: 1, version: 1 }, { unique: true });
membershipPlanSchema.index({ gymId: 1, status: 1 });

const planQuoteSchema = new Schema(
  {
    orderRevision: { type: Number, default: 0, select: false },
    publicId: { type: String, required: true, unique: true },
    purchaserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    planId: {
      type: Schema.Types.ObjectId,
      ref: "MembershipPlan",
      required: true,
    },
    planSnapshot: { type: Schema.Types.Mixed, required: true },
    subtotalMinor: { type: Number, required: true },
    discountMinor: { type: Number, required: true, default: 0 },
    taxMinor: { type: Number, required: true, default: 0 },
    totalMinor: { type: Number, required: true },
    currency: { type: String, default: "INR" },
    couponCode: String,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
planQuoteSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const subscriptionSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    type: {
      type: String,
      enum: ["PLATFORM", "GYM_MEMBERSHIP"],
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: true,
      index: true,
    },
    memberProfileId: {
      type: Schema.Types.ObjectId,
      ref: "MemberProfile",
      index: true,
    },
    planSnapshot: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: [
        "PENDING_PAYMENT",
        "ACTIVE",
        "FROZEN",
        "GRACE",
        "EXPIRED",
        "CANCELLED",
      ],
      default: "PENDING_PAYMENT",
      index: true,
    },
    startsAt: Date,
    endsAt: Date,
    renewalAt: Date,
    cancelledAt: Date,
    cancellationReason: String,
    freezePeriods: [{ startsAt: Date, endsAt: Date, reason: String }],
    latestPaymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
  },
  { timestamps: true, versionKey: "version", optimisticConcurrency: true },
);
subscriptionSchema.index({ userId: 1, status: 1, endsAt: 1 });
subscriptionSchema.index({ gymId: 1, status: 1, endsAt: 1 });

const subscriptionEventSchema = new Schema(
  {
    subscriptionId: {
      type: Schema.Types.ObjectId,
      ref: "Subscription",
      required: true,
      index: true,
    },
    type: { type: String, required: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    payload: Schema.Types.Mixed,
    occurredAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
subscriptionEventSchema.index({ subscriptionId: 1, occurredAt: -1 });

const paymentSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    purpose: {
      type: String,
      enum: ["PLATFORM_PLAN", "MEMBERSHIP", "ADVERTISEMENT"],
      required: true,
    },
    payerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    quoteId: { type: Schema.Types.ObjectId, ref: "PlanQuote" },
    subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" },
    amountMinor: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "INR" },
    provider: { type: String, enum: ["RAZORPAY"], default: "RAZORPAY" },
    providerOrderId: { type: String, unique: true, sparse: true },
    providerPaymentId: { type: String, unique: true, sparse: true },
    status: {
      type: String,
      enum: [
        "CREATED",
        "PENDING",
        "AUTHORIZED",
        "CAPTURED",
        "FAILED",
        "CANCELLED",
        "REFUND_PENDING",
        "PARTIALLY_REFUNDED",
        "REFUNDED",
        "DISPUTED",
      ],
      default: "CREATED",
      index: true,
    },
    methodCategory: String,
    failureCode: String,
    failureDescription: String,
    capturedAt: Date,
    lastGatewayCheckAt: { type: Date, select: false },
    metadata: Schema.Types.Mixed,
  },
  { timestamps: true },
);
paymentSchema.index({ payerId: 1, createdAt: -1 });
paymentSchema.index({ gymId: 1, status: 1, createdAt: -1 });

const providerEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventKey: { type: String, required: true },
    eventType: String,
    payloadHash: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true, select: false },
    status: {
      type: String,
      enum: ["RECEIVED", "PROCESSING", "PROCESSED", "FAILED"],
      default: "RECEIVED",
    },
    attempts: { type: Number, default: 0 },
    processedAt: Date,
    lastError: String,
  },
  { timestamps: true },
);
providerEventSchema.index({ provider: 1, eventKey: 1 }, { unique: true });
providerEventSchema.index({ status: 1, createdAt: 1 });

export const PlatformPlan =
  models.PlatformPlan || model("PlatformPlan", platformPlanSchema);
export const MembershipPlan =
  models.MembershipPlan || model("MembershipPlan", membershipPlanSchema);
export const PlanQuote =
  models.PlanQuote || model("PlanQuote", planQuoteSchema);
export const Subscription =
  models.Subscription || model("Subscription", subscriptionSchema);
export const SubscriptionEvent =
  models.SubscriptionEvent ||
  model("SubscriptionEvent", subscriptionEventSchema);
export const Payment = models.Payment || model("Payment", paymentSchema);
export const ProviderEvent =
  models.ProviderEvent || model("ProviderEvent", providerEventSchema);
