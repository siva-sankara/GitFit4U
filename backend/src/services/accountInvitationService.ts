import crypto from "node:crypto";
import bcrypt from "bcrypt";
import mongoose, { type ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { AccountInvitation, TransactionalEmail } from "../models/Delivery.js";
import { AuthIdentity } from "../models/Auth.js";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { Refund } from "../models/Business.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import { appEmailUrl, emailTemplate, queueTransactionalEmail } from "./transactionalEmailService.js";
import { emitDomainEvent } from "./domainEventService.js";

const EXPIRY_MS = 48 * 3600_000;
export const invitationError = () => new AppError(400, "INVITATION_INVALID", "This invitation is expired, replaced or already used. Ask the gym to resend it.");
export async function issueMemberInvitation(
  member: any,
  user: any,
  gym: any,
  session: ClientSession,
  now = new Date(),
  options: { includeActionUrl?: boolean; bypassCooldown?: boolean } = {},
) {
  if (!user.email) throw new AppError(422, "INVITATION_EMAIL_REQUIRED", "An account email is required to send a secure invitation.");
  const existing = await AccountInvitation.findOne({ memberId: member._id }).session(session);
  if (
    !options.bypassCooldown &&
    existing &&
    now.getTime() - existing.lastQueuedAt.getTime() < 60_000
  )
    throw new AppError(429, "INVITATION_RATE_LIMITED", "Wait one minute before requesting another invitation.");
  if (existing?.consumedAt || member.invitation?.status === "ACCEPTED")
    throw new AppError(409, "INVITATION_ALREADY_ACCEPTED", "This member has already accepted their invitation.");
  const secret = crypto.randomBytes(32).toString("base64url"), publicId = existing?.publicId || nanoid(24);
  const token = `${publicId}.${secret}`, expiresAt = new Date(now.getTime() + EXPIRY_MS);
  // An established account always signs in and accepts; its password and roles
  // are never changed by gym management or a possession-only invitation.
  const kind = user.status === "PENDING_VERIFICATION" && !await AuthIdentity.exists({ userId: user._id }).session(session) ? "ACTIVATE" : "LINK";
  const revision = (existing?.revision || 0) + 1;
  const invitation = await AccountInvitation.findOneAndUpdate({ memberId: member._id }, { $set: { publicId, userId: user._id, gymId: gym._id, kind, email: user.email, tokenHash: sha256(token), expiresAt, consumedAt: null, lastQueuedAt: now, revision } }, { upsert: true, returnDocument: "after", session });
  await TransactionalEmail.updateMany({ kind: "INVITATION", entityId: invitation._id, status: { $in: ["QUEUED", "FAILED"] } }, { $set: { status: "CANCELLED" } }, { session });
  const action = kind === "ACTIVATE" ? "Activate Account" : "Accept gym invitation";
  // Fragment keeps the bearer secret out of server access logs and referrers.
  const url = appEmailUrl(`/activate-account#token=${encodeURIComponent(token)}&kind=${kind}`);
  await queueTransactionalEmail({ eventKey: `invitation:${publicId}:${revision}`, userId: user._id, entityId: invitation._id, kind: "INVITATION", revision, content: { to: user.email, ...emailTemplate(`Welcome to ${gym.name}`, `Your membership at ${gym.name} is ready to review. ${kind === "ACTIVATE" ? "Set your own password to activate your GETFIT4U account." : "Sign in to your existing GETFIT4U account and accept this gym invitation."}`, action, url, "This single-use invitation expires in 48 hours. If you were not expecting it, ignore this email or contact the gym. Opening the link does not activate your account.") } }, session);
  member.invitation = { status: "PENDING", kind, expiresAt, lastQueuedAt: now };
  await member.save({ session });
  return {
    status: "PENDING",
    expiresAt,
    kind,
    ...(options.includeActionUrl ? { actionUrl: url } : {}),
  };
}

export async function acceptMemberInvitation(input: { token: string; password?: string; userId?: string }, now = new Date()) {
  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : undefined;
  return mongoose.connection.transaction(async session => {
    const invitation = await AccountInvitation.findOneAndUpdate({ tokenHash: sha256(input.token), consumedAt: null, expiresAt: { $gt: now } }, { $set: { consumedAt: now } }, { session, returnDocument: "after" }).select("+email");
    if (!invitation) throw invitationError();
    const member = await MemberProfile.findOne({ _id: invitation.memberId, gymId: invitation.gymId, userId: invitation.userId, "invitation.status": "PENDING" }).session(session);
    const user = await User.findById(invitation.userId).session(session);
    if (!member || !user || ["BLOCKED", "DISABLED"].includes(user.status) || user.email !== invitation.email) throw invitationError();
    if (invitation.kind === "ACTIVATE") {
      if (!passwordHash || user.status !== "PENDING_VERIFICATION" || await AuthIdentity.exists({ userId: user._id }).session(session)) throw invitationError();
      await AuthIdentity.create([{ userId: user._id, provider: "PASSWORD", providerSubject: user.email, verifiedAt: now, passwordHash }], { session });
      user.status = "ACTIVE";
      await user.save({ session });
    } else if (!input.userId || String(user._id) !== input.userId || user.status !== "ACTIVE") {
      throw new AppError(403, "INVITATION_ACCOUNT_REQUIRED", "Sign in to the account that received this invitation before accepting it.");
    }
    // Acceptance only removes the invitation hold. It never extends validity or
    // restores an owner suspension, frozen membership or cancelled payment.
    const subscription = member.currentSubscriptionId && await Subscription.findOneAndUpdate({ _id: member.currentSubscriptionId, type: "GYM_MEMBERSHIP", userId: user._id, gymId: member.gymId, status: "ACTIVE", startsAt: { $lte: now }, endsAt: { $gt: now } }, { $inc: { version: 1 } }, { session, returnDocument: "after" });
    const gymActive = await Gym.exists({ _id: member.gymId, status: "ACTIVE", deletedAt: null }).session(session);
    const paid = subscription?.latestPaymentId && await Payment.findOneAndUpdate({ _id: subscription.latestPaymentId, purpose: "MEMBERSHIP", gymId: member.gymId, payerId: user._id, subscriptionId: subscription._id, status: "CAPTURED", capturedAt: { $ne: null } }, { $inc: { "metadata.accessRevision": 1 } }, { session, returnDocument: "after" });
    const refunded = paid && await Refund.exists({ paymentId: subscription.latestPaymentId, status: { $in: ["REQUESTED", "PROCESSING", "PROCESSED"] } }).session(session);
    const membershipActivated = member.status === "INACTIVE" && !member.deactivatedAt && subscription && gymActive && paid && !refunded;
    if (membershipActivated) member.status = "ACTIVE";
    member.invitation = { ...member.invitation?.toObject?.() || member.invitation, status: "ACCEPTED", acceptedAt: now };
    if (invitation.kind === "LINK" && !user.roles.includes("USER")) {
      user.roles.push("USER");
      await user.save({ session });
    }
    await member.save({ session });
    await emitDomainEvent({ event: "account.verified", userId: user._id, gymId: member.gymId, entityId: invitation.publicId, actionUrl: "/app/profile/membership", session });
    // Owner-created memberships stay on invitation hold until acceptance. Reuse
    // the subscription activation key so only the now-active membership welcomes.
    if (membershipActivated)
      await emitDomainEvent({ event: "membership.activated", userId: user._id, gymId: member.gymId, entityId: subscription.publicId, actionUrl: "/app/subscriptions", session });
    return { activated: invitation.kind === "ACTIVATE", linked: true };
  });
}
