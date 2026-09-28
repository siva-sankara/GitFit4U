import mongoose from "mongoose";
const { Schema, model, models } = mongoose;
import { PERMISSIONS, ROLES } from "../constants/domain.js";

const authIdentitySchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, enum: ["PHONE", "GOOGLE", "PASSWORD"], required: true },
    providerSubject: { type: String, required: true },
    verifiedAt: { type: Date, required: true },
    passwordHash: { type: String, select: false }
  },
  { timestamps: true }
);
authIdentitySchema.index({ provider: 1, providerSubject: 1 }, { unique: true });

const roleAssignmentSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ROLES, required: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", default: null, index: true },
    permissions: [{ type: String, enum: PERMISSIONS }],
    status: { type: String, enum: ["ACTIVE", "REVOKED"], default: "ACTIVE" }
  },
  { timestamps: true }
);
roleAssignmentSchema.index({ userId: 1, role: 1, gymId: 1 }, { unique: true });

const sessionSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenFamily: { type: String, required: true, index: true },
    refreshTokenHash: { type: String, required: true, select: false },
    previousRefreshTokenHash: { type: String, select: false },
    refreshGraceUntil: Date,
    activeRole: { type: String, enum: ROLES, required: true },
    activeGymId: { type: Schema.Types.ObjectId, ref: "Gym", default: null },
    device: {
      name: String,
      userAgent: String,
      ipHash: String
    },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, default: Date.now },
    revokedAt: Date,
    revokeReason: String
  },
  { timestamps: true }
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1, revokedAt: 1 });

const otpChallengeSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    phone: { type: String, required: true, index: true },
    purpose: { type: String, enum: ["LOGIN", "STEP_UP", "ACCOUNT_RECOVERY"], default: "LOGIN" },
    codeHash: { type: String, required: true, select: false },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    expiresAt: { type: Date, required: true },
    consumedAt: Date
  },
  { timestamps: true }
);
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
otpChallengeSchema.index({ phone: 1, purpose: 1, createdAt: -1 });

const passwordResetGrantSchema = new Schema({
  publicId: { type: String, required: true, unique: true },
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  tokenHash: { type: String, required: true, unique: true, select: false },
  expiresAt: { type: Date, required: true }, consumedAt: Date
}, { timestamps: true });
passwordResetGrantSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthIdentity = models.AuthIdentity || model("AuthIdentity", authIdentitySchema);
export const RoleAssignment = models.RoleAssignment || model("RoleAssignment", roleAssignmentSchema);
export const Session = models.Session || model("Session", sessionSchema);
export const OtpChallenge = models.OtpChallenge || model("OtpChallenge", otpChallengeSchema);
export const PasswordResetGrant = models.PasswordResetGrant || model("PasswordResetGrant", passwordResetGrantSchema);
