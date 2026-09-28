import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

// The bearer secret is held only in the encrypted email envelope. Authentication
// compares its SHA-256 digest; opening a link never consumes the invitation.
const invitationSchema = new Schema({
  publicId: { type: String, required: true, unique: true },
  memberId: { type: Schema.Types.ObjectId, ref: "MemberProfile", required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
  kind: { type: String, enum: ["ACTIVATE", "LINK"], required: true },
  email: { type: String, required: true, select: false },
  tokenHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  consumedAt: Date,
  lastQueuedAt: { type: Date, required: true },
  revision: { type: Number, default: 1 },
}, { timestamps: true });

const emailSchema = new Schema({
  eventKey: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  kind: { type: String, enum: ["INVITATION", "INVOICE"], required: true },
  entityId: { type: Schema.Types.ObjectId, required: true },
  revision: Number,
  encryptedPayload: { type: String, required: true, select: false },
  status: { type: String, enum: ["QUEUED", "SENDING", "SENT", "DELIVERED", "FAILED", "CANCELLED", "BOUNCED"], default: "QUEUED" },
  attempts: { type: Number, default: 0 },
  nextAttemptAt: { type: Date, default: Date.now },
  firstAttemptAt: Date,
  leaseUntil: Date,
  leaseToken: String,
  sentAt: Date,
  deliveredAt: Date,
  providerMessageId: String,
  lastErrorCode: String,
  nextCheckAt: Date,
}, { timestamps: true });
emailSchema.index({ status: 1, nextAttemptAt: 1, leaseUntil: 1 });
emailSchema.index({ status: 1, nextCheckAt: 1 });
export const AccountInvitation = models.AccountInvitation || model("AccountInvitation", invitationSchema);
export const TransactionalEmail = models.TransactionalEmail || model("TransactionalEmail", emailSchema);
