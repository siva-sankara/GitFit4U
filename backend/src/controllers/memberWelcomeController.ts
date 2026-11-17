import type { Request, Response } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { z } from "zod";
import { MemberProfile } from "../models/Member.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { AccountInvitation, TransactionalEmail } from "../models/Delivery.js";
import { IdempotencyRecord } from "../models/Operations.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import { manualWhatsAppChatUrl } from "../utils/whatsappDeepLink.js";
import { issueMemberInvitation } from "../services/accountInvitationService.js";
import { appEmailUrl, emailTemplate, queueTransactionalEmail } from "../services/transactionalEmailService.js";
import { membershipWhatsAppUpdates } from "../services/whatsappUpdatesService.js";
import { writeAudit } from "../services/auditService.js";

async function welcomeContext(req: Request, session?: ClientSession) {
  const gym = await Gym.findOne({ _id: req.auth!.gymId, ownerId: req.auth!.userId, deletedAt: null }).session(session || null);
  const member = gym && await MemberProfile.findOne({ publicId: req.params.id, gymId: gym._id, isDeleted: { $ne: true } }).session(session || null);
  const user = member && await User.findOne({ _id: member.userId, status: "ACTIVE" }).session(session || null);
  const subscription = member && await Subscription.findOne({ _id: member.currentSubscriptionId, gymId: gym._id, userId: member.userId, type: "GYM_MEMBERSHIP", status: "ACTIVE", endsAt: { $gt: new Date() } }).session(session || null);
  const payment = subscription && await Payment.findOne({ _id: subscription.latestPaymentId, payerId: member.userId, gymId: gym._id, subscriptionId: subscription._id, purpose: "MEMBERSHIP", status: "CAPTURED", fulfillmentStatus: "APPLIED" }).session(session || null);
  if (!gym || !member || !user || !subscription || !payment || member.status !== "ACTIVE") throw new AppError(404, "WELCOME_UNAVAILABLE", "Welcome details are unavailable for this paid member.");
  // Never disclose another account's contact data through an owner-created record.
  const recipient = member.contact?.email;
  if (!recipient || recipient !== user.email) throw new AppError(409, "WELCOME_CONTACT_CHANGED", "The recorded login email changed. Ask the member to review their account contact details.");
  const invitation = await membershipWhatsAppUpdates(String(user._id), subscription.publicId);
  const date = (value: Date) => new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeZone: gym.timezone || "Asia/Kolkata" }).format(value);
  const access = subscription.startsAt > new Date() ? `Your membership starts on ${date(subscription.startsAt)}.` : "Your membership is active.";
  const summary = `Hi ${member.contact?.name || "Member"},\nWelcome to ${gym.name}!\n${access}\nLogin: ${recipient}\nMembership: ${subscription.planSnapshot.name}\nStart date: ${date(subscription.startsAt)}\nExpiry date: ${date(subscription.endsAt)}\nPayment recorded: ${new Intl.NumberFormat("en-IN", { style: "currency", currency: payment.currency }).format(payment.amountMinor / 100)} (${payment.methodCategory || payment.provider})\nMember reference: ${member.memberCode}${invitation ? `\n${invitation.displayName}: ${invitation.inviteUrl}` : ""}\n${user.firstAccessPending ? "Use your setup email or verify your email at account recovery to choose your own password." : "Sign in using your existing GETFIT4U account."}`;
  return { gym, member, user, subscription, payment, recipient, invitation, summary };
}
export async function memberWelcomeDetails(req: Request, res: Response) {
  const context = await welcomeContext(req);
  const chat = manualWhatsAppChatUrl(context.member.contact?.phone || "");
  const message = `${context.summary}\nLogin: ${appEmailUrl("/auth/login")}`;
  const setup = await AccountInvitation.findOne({ memberId: context.member._id }).select("_id").lean();
  const delivery = await TransactionalEmail.findOne({ userId: context.user._id, $or: [{ eventKey: { $regex: `^member-welcome:${context.member.publicId}:` } }, ...(setup ? [{ kind: "INVITATION", entityId: setup._id }] : [])] }).sort({ createdAt: -1 }).select("status lastErrorCode").lean();
  res.set("Cache-Control", "private, no-store").json({ success: true, data: { recipient: context.recipient, phone: context.member.contact?.phone, message, chatUrl: chat ? `${chat}?text=${encodeURIComponent(message)}` : null, invitation: context.invitation, delivery: delivery?.status || "NOT_REQUESTED" } });
}
export async function sendMemberWelcome(req: Request, res: Response) {
  const { recipient } = z.object({ recipient: z.string().email() }).strict().parse(req.body);
  const key = req.idempotencyKey!;
  const scope = `member.welcome:${req.auth!.userId}:${req.auth!.gymId}:${req.params.id}`;
  const requestHash = sha256(recipient);
  const data = await mongoose.connection.transaction(async session => {
    const replay = await IdempotencyRecord.findOne({ scope, key }).session(session);
    if (replay) {
      if (replay.requestHash !== requestHash) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This request was already used.");
      return replay.responseBody;
    }
    const context = await welcomeContext(req, session);
    if (recipient !== context.recipient) throw new AppError(409, "WELCOME_RECIPIENT_CHANGED", "Refresh and confirm the recorded recipient before sending.");
    const now = new Date();
    if (context.member.welcomeLastQueuedAt && now.getTime() - context.member.welcomeLastQueuedAt.getTime() < 60_000) throw new AppError(429, "WELCOME_COOLDOWN", "Wait one minute before requesting another welcome email.");
    context.member.welcomeLastQueuedAt = now;
    context.member.welcomeRevision = (context.member.welcomeRevision || 0) + 1;
    await context.member.save({ session });
    if (context.user.firstAccessPending || context.member.invitation?.status === "PENDING") {
      await issueMemberInvitation(context.member, context.user, context.gym, session, now, { welcomeMessage: context.summary });
    } else {
      await queueTransactionalEmail({ eventKey: `member-welcome:${context.member.publicId}:${context.member.welcomeRevision}`, userId: context.user._id, entityId: context.member._id, kind: "WELCOME", provider: "GRAPH", content: { to: recipient, ...emailTemplate(`Welcome to ${context.gym.name}`, context.summary, "Sign in", appEmailUrl("/auth/login"), "Use your existing account. This email does not reset your password. WhatsApp joining is optional.") } }, session);
    }
    const result = { status: "QUEUED", recipient };
    await IdempotencyRecord.create([{ scope, key, requestHash, status: "COMPLETED", statusCode: 202, responseBody: result, expiresAt: new Date(now.getTime() + 86400_000) }], { session });
    return result;
  });
  await writeAudit(req, { action: "member.welcome.queued", entityType: "MemberProfile", entityId: String(req.params.id) });
  res.set("Cache-Control", "private, no-store").status(202).json({ success: true, data });
}
