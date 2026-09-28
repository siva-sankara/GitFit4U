import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const auditLogSchema = new Schema(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    actorRole: String,
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: String,
    outcome: {
      type: String,
      enum: ["SUCCESS", "DENIED", "FAILED"],
      required: true,
    },
    reason: String,
    before: Schema.Types.Mixed,
    after: Schema.Types.Mixed,
    requestId: String,
    ipHash: String,
    device: String,
    occurredAt: { type: Date, default: Date.now },
  },
  { timestamps: false },
);
auditLogSchema.index({ actorId: 1, occurredAt: -1 });
auditLogSchema.index({ gymId: 1, occurredAt: -1 });
auditLogSchema.index({ entityType: 1, entityId: 1, occurredAt: -1 });

const idempotencySchema = new Schema(
  {
    scope: { type: String, required: true },
    key: { type: String, required: true },
    requestHash: { type: String, required: true },
    status: {
      type: String,
      enum: ["PROCESSING", "COMPLETED", "FAILED"],
      default: "PROCESSING",
    },
    statusCode: Number,
    responseBody: Schema.Types.Mixed,
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
idempotencySchema.index({ scope: 1, key: 1 }, { unique: true });
idempotencySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const outboxSchema = new Schema(
  {
    eventId: { type: String, required: true, unique: true },
    aggregateType: { type: String, required: true },
    aggregateId: { type: String, required: true },
    eventType: { type: String, required: true },
    payload: Schema.Types.Mixed,
    status: {
      type: String,
      enum: ["PENDING", "PROCESSING", "PUBLISHED", "FAILED"],
      default: "PENDING",
    },
    availableAt: { type: Date, default: Date.now },
    attempts: { type: Number, default: 0 },
    lastError: String,
    publishedAt: Date,
  },
  { timestamps: true },
);
outboxSchema.index({ status: 1, availableAt: 1 });

export const AuditLog = models.AuditLog || model("AuditLog", auditLogSchema);
export const IdempotencyRecord =
  models.IdempotencyRecord || model("IdempotencyRecord", idempotencySchema);
export const OutboxEvent =
  models.OutboxEvent || model("OutboxEvent", outboxSchema);
const platformSettingsSchema = new Schema(
  {
    key: { type: String, unique: true, required: true },
    values: Schema.Types.Mixed,
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);
export const PlatformSettings =
  models.PlatformSettings || model("PlatformSettings", platformSettingsSchema);
