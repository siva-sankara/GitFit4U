import crypto from "node:crypto";
import bcrypt from "bcrypt";
import mongoose, { type ClientSession } from "mongoose";
import { User } from "../models/User.js";
import { AccountInvitation } from "../models/Delivery.js";
import { MemberProfile } from "../models/Member.js";
import { sha256 } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  setupHash: { type: String, select: false }, setupExpiresAt: Date,
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const MemberBootstrap = mongoose.models.MemberBootstrap || mongoose.model("MemberBootstrap", schema);
export async function createMemberBootstrap(userId: unknown, session: ClientSession) {
  const password = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + env.MEMBER_TEMP_PASSWORD_HOURS * 3600_000);
  await MemberBootstrap.create([{ userId, expiresAt, passwordHash: await bcrypt.hash(password, 12) }], { session });
  return { password, expiresAt };
}
// This grant is not a JWT and cannot authorize any normal application endpoint.
export async function temporaryMemberLogin(identifier: string, password: string) {
  const user = await User.findOne({ ...(identifier.includes("@") ? { email: identifier } : { phone: identifier }), status: "ACTIVE", firstAccessPending: true });
  if (!user) return null;
  const credential = await MemberBootstrap.findOne({ userId: user._id, expiresAt: { $gt: new Date() } }).select("+passwordHash");
  if (!credential || !await bcrypt.compare(password, credential.passwordHash)) return null;
  const setupToken = crypto.randomBytes(32).toString("base64url");
  await MemberBootstrap.updateOne({ _id: credential._id }, { $set: { setupHash: sha256(setupToken), setupExpiresAt: new Date(Date.now() + 600_000) } });
  return { setupRequired: true as const, setupToken, expiresInSeconds: 600 };
}
export async function setupAccount(setupToken: string) {
  const grant = await MemberBootstrap.findOne({ setupHash: sha256(setupToken), setupExpiresAt: { $gt: new Date() }, expiresAt: { $gt: new Date() } });
  const user = grant && await User.findOne({ _id: grant.userId, status: "ACTIVE", firstAccessPending: true });
  if (!user?.email) throw new AppError(401, "SETUP_EXPIRED", "Sign in again or request a new setup email from your gym.");
  return user;
}
export async function completeMemberSetup(user: any, session: ClientSession) {
  user.firstAccessPending = false;
  await user.save({ session });
  await MemberBootstrap.deleteMany({ userId: user._id }, { session });
  await AccountInvitation.updateMany({ userId: user._id, kind: "ACTIVATE", consumedAt: null }, { $set: { consumedAt: new Date() } }, { session });
  await MemberProfile.updateMany({ userId: user._id, offlineAccessGranted: true, "invitation.kind": "ACTIVATE", "invitation.status": "PENDING" }, { $set: { "invitation.status": "ACCEPTED", "invitation.acceptedAt": new Date() } }, { session });
}
