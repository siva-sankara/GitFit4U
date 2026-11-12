import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const classSessionSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    category: {
      type: String,
      enum: [
        "YOGA",
        "ZUMBA",
        "CROSSFIT",
        "HIIT",
        "STRENGTH",
        "CARDIO",
        "OTHER",
      ],
    },
    trainerId: { type: Schema.Types.ObjectId, ref: "Trainer" },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    capacity: { type: Number, min: 1, required: true },
    bookedCount: { type: Number, min: 0, default: 0 },
    status: {
      type: String,
      enum: ["SCHEDULED", "CANCELLED", "COMPLETED"],
      default: "SCHEDULED",
    },
    room: String,
    imageUrl: String,
    imageAttachmentId: { type: Schema.Types.ObjectId, ref: "Attachment" },
    reminderLock: { type: Number, default: 0 },
    description: { type: String, maxlength: 3000 },
    cancelledAt: Date,
    cancellationReason: { type: String, maxlength: 500 },
  },
  { timestamps: true, versionKey: "version", optimisticConcurrency: true },
);
classSessionSchema.index({ gymId: 1, startsAt: 1 });
classSessionSchema.index({ gymId: 1, status: 1, startsAt: -1 });
classSessionSchema.index({ imageAttachmentId: 1 });
classSessionSchema.index({ status: 1, startsAt: 1 });

const classBookingSchema = new Schema(
  {
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: "ClassSession",
      required: true,
      index: true,
    },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    memberProfileId: {
      type: Schema.Types.ObjectId,
      ref: "MemberProfile",
      required: true,
    },
    status: {
      type: String,
      enum: ["BOOKED", "WAITLISTED", "CANCELLED", "ATTENDED", "NO_SHOW"],
      required: true,
    },
    waitlistPosition: Number,
    bookedAt: { type: Date, default: Date.now },
    cancelledAt: Date,
  },
  { timestamps: true },
);
classBookingSchema.index(
  { sessionId: 1, memberProfileId: 1 },
  { unique: true },
);
classBookingSchema.index({ sessionId: 1, status: 1, bookedAt: 1 });
classBookingSchema.index({ memberProfileId: 1, status: 1, bookedAt: -1 });

const trainerSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: "User" },
    name: { type: String, required: true },
    photoUrl: String,
    photoAttachmentId: { type: Schema.Types.ObjectId, ref: "Attachment" },
    phone: String,
    email: String,
    experienceYears: { type: Number, min: 0, max: 70 },
    availability: [
      { day: { type: Number, min: 0, max: 6 }, from: String, to: String },
    ],
    qualifications: [String],
    specializations: [String],
    bio: String,
    status: {
      type: String,
      enum: ["ACTIVE", "INACTIVE", "ARCHIVED"],
      default: "ACTIVE",
    },
  },
  { timestamps: true },
);
trainerSchema.index({ gymId: 1, status: 1, createdAt: -1 });
trainerSchema.index({ gymId: 1, userId: 1 }, { unique: true, sparse: true });

const notificationSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym" },
    category: {
      type: String,
      enum: [
        "PAYMENT",
        "SUBSCRIPTION",
        "ATTENDANCE",
        "MEMBERSHIP",
        "TRAINER",
        "SYSTEM",
        "PROMOTION",
        "GYM",
      ],
      required: true,
    },
    title: { type: String, required: true },
    message: { type: String, required: true },
    actionUrl: String,
    actionLabel: { type: String, maxlength: 80 },
    source: { type: String, maxlength: 160 },
    event: { type: String, maxlength: 100 },
    metadata: { type: Schema.Types.Mixed },
    entityType: {
      type: String,
      enum: [
        "PAYMENT",
        "SUBSCRIPTION",
        "ATTENDANCE",
        "CLASS",
        "GYM",
        "MEMBER",
        "SESSION",
        "SUPPORT",
        "SYSTEM",
      ],
    },
    entityId: String,
    dedupeKey: { type: String, sparse: true },
    channels: {
      type: [{ type: String, enum: ["IN_APP", "PUSH", "WHATSAPP", "EMAIL"] }],
      default: ["IN_APP", "PUSH"],
    },
    pushStatus: {
      type: String,
      enum: ["NOT_REQUESTED", "QUEUED", "SENT", "FAILED", "SKIPPED"],
      default: function (this: any) {
        return this?.channels?.includes("PUSH") ? "QUEUED" : "NOT_REQUESTED";
      },
    },
    pushAttempts: { type: Number, default: 0 },
    pushNextAttemptAt: Date,
    pushLeaseUntil: Date,
    pushLeaseId: String,
    pushDeliveredTokens: { type: [String], select: false },
    readAt: Date,
    archivedAt: Date,
    deliveredAt: Date,
    providerAcceptedAt: Date,
    openedAt: Date,
  },
  { timestamps: true },
);
notificationSchema.index({
  pushStatus: 1,
  pushNextAttemptAt: 1,
  pushLeaseUntil: 1,
});
notificationSchema.index({ userId: 1, readAt: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, archivedAt: 1, createdAt: -1, _id: -1 });
notificationSchema.index(
  { userId: 1, dedupeKey: 1 },
  { unique: true, partialFilterExpression: { dedupeKey: { $type: "string" } } },
);

const reviewSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    rating: { type: Number, min: 1, max: 5, required: true },
    title: String,
    body: { type: String, maxlength: 3000 },
    photoUrls: [String],
    attachmentIds: [{ type: Schema.Types.ObjectId, ref: "Attachment" }],
    editedAt: Date,
    status: {
      type: String,
      enum: ["PUBLISHED", "PENDING", "HIDDEN", "REMOVED"],
      default: "PUBLISHED",
    },
    ownerResponse: {
      body: String,
      respondedBy: { type: Schema.Types.ObjectId, ref: "User" },
      respondedAt: Date,
    },
  },
  { timestamps: true },
);
reviewSchema.index({ gymId: 1, userId: 1 }, { unique: true });
reviewSchema.index({ gymId: 1, status: 1, createdAt: -1 });
reviewSchema.index({ attachmentIds: 1 });

const campaignSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: function (this: any) {
        return this.scope !== "PLATFORM";
      },
      index: true,
    },
    scope: { type: String, enum: ["GYM", "PLATFORM"], default: "GYM" },
    idempotencyKey: { type: String, sparse: true, unique: true },
    leaseId: String,
    leaseUntil: Date,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    name: { type: String, required: true },
    channel: {
      type: String,
      enum: ["WHATSAPP", "IN_APP", "PUSH", "EMAIL"],
      required: true,
    },
    audience: { type: Schema.Types.Mixed, required: true },
    audienceSnapshot: { type: Schema.Types.Mixed },
    templateId: String,
    deliveryCursor: { type: Schema.Types.ObjectId, default: null },
    message: { type: String, required: true },
    scheduledAt: Date,
    status: {
      type: String,
      enum: [
        "DRAFT",
        "SCHEDULED",
        "QUEUED",
        "PROCESSING",
        "COMPLETED",
        "PARTIALLY_FAILED",
        "CANCELLED",
      ],
      default: "DRAFT",
    },
    analytics: {
      recipients: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      delivered: { type: Number, default: 0 },
      read: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
  },
  { timestamps: true },
);
campaignSchema.index({ gymId: 1, status: 1, scheduledAt: 1 });

const supportTicketSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    requesterId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym" },
    subject: { type: String, required: true },
    category: String,
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    related: { type: { type: String, enum: ["PAYMENT", "MEMBERSHIP", "BOOKING"] }, id: String, label: String },
    activity: [{ type: { type: String }, actorId: { type: Schema.Types.ObjectId, ref: "User" },
      from: String, to: String, at: { type: Date, default: Date.now } }],
    internalNotes: { type: [{ key: String, authorId: { type: Schema.Types.ObjectId, ref: "User" }, body: String, at: { type: Date, default: Date.now } }], select: false },
    revision: { type: Number, default: 0 },
    priority: {
      type: String,
      enum: ["LOW", "NORMAL", "HIGH", "URGENT"],
      default: "NORMAL",
    },
    status: {
      type: String,
      enum: ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"],
      default: "OPEN",
    },
    messages: [
      {
        authorId: { type: Schema.Types.ObjectId, ref: "User" },
        body: String,
        attachments: [String],
        createdAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);
supportTicketSchema.index({ requesterId: 1, status: 1, updatedAt: -1 });

export const ClassSession =
  models.ClassSession || model("ClassSession", classSessionSchema);
export const ClassBooking =
  models.ClassBooking || model("ClassBooking", classBookingSchema);
export const Trainer = models.Trainer || model("Trainer", trainerSchema);
export const Notification =
  models.Notification || model("Notification", notificationSchema);
export const Review = models.Review || model("Review", reviewSchema);
export const Campaign = models.Campaign || model("Campaign", campaignSchema);
export const SupportTicket =
  models.SupportTicket || model("SupportTicket", supportTicketSchema);
