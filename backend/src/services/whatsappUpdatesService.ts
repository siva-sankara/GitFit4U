import type { Request } from "express";
import { z } from "zod";
import { Gym } from "../models/Gym.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { MemberProfile } from "../models/Member.js";
import { AppError } from "../utils/AppError.js";
import { parseWhatsAppInvite, validWhatsAppInvite } from "../utils/whatsappInvite.js";
import { invitationPresentation } from "./invitationQrService.js";
import { PlatformSettings } from "../models/Operations.js";
import { Refund } from "../models/Business.js";

export const whatsappUpdatesInput = z.object({
  enabled: z.boolean(), type: z.enum(["group", "channel"]),
  displayName: z.string().trim().max(100), inviteUrl: z.string().trim().max(500),
  description: z.string().trim().max(400).default(""),
  qrId: z.string().regex(/^[A-Za-z0-9_-]{24}$/).nullable().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.enabled && !value.displayName) ctx.addIssue({ code: "custom", path: ["displayName"], message: "Enter a display name." });
  if ((value.enabled || value.inviteUrl) && !validWhatsAppInvite(value.inviteUrl, value.type))
    ctx.addIssue({ code: "custom", path: ["inviteUrl"], message: parseWhatsAppInvite(value.inviteUrl, value.type).error || "Invalid invitation." });
}).transform(value => ({ ...value, inviteUrl: value.inviteUrl ? parseWhatsAppInvite(value.inviteUrl, value.type).url! : "" }));
export const emptyWhatsAppUpdates = { enabled: false, type: "group", displayName: "", inviteUrl: "", description: "", version: 0 };
export function ownerUpdatesScope(auth: NonNullable<Request["auth"]>) {
  if (auth.role !== "GYM_OWNER" || !auth.gymId)
    throw new AppError(403, "GYM_ACCESS_DENIED", "Only the gym owner can change this invitation.");
  return { _id: auth.gymId, ownerId: auth.userId, deletedAt: null };
}
export async function membershipWhatsAppUpdates(userId: string, publicId: string) {
  const subscription = await Subscription.findOne({ publicId, userId, type: "GYM_MEMBERSHIP" }).lean();
  if (!subscription) throw new AppError(404, "SUBSCRIPTION_NOT_FOUND", "Subscription not found.");
  // Frozen and paid future-start members may receive announcements, but this
  // does not grant attendance access. No grace, expired, cancelled or trial access.
  const endsAt = new Date(subscription.endsAt).getTime();
  if (!["ACTIVE", "FROZEN"].includes(subscription.status) || !Number.isFinite(endsAt) ||
      endsAt <= Date.now() || !subscription.latestPaymentId) return null;
  const [member, payment] = await Promise.all([
    MemberProfile.exists({ _id: subscription.memberProfileId, userId, gymId: subscription.gymId,
      status: "ACTIVE", isDeleted: { $ne: true }, deletedAt: null }),
    Payment.exists({ _id: subscription.latestPaymentId, payerId: userId, gymId: subscription.gymId,
      subscriptionId: subscription._id, purpose: "MEMBERSHIP", status: "CAPTURED", fulfillmentStatus: "APPLIED", $or: [{ provider: "RAZORPAY" }, { provider: "OFFLINE", "metadata.collectorId": { $exists: true }, capturedAt: { $ne: null } }] }),
  ]);
  if (!member || !payment) return null;
  if (await Refund.exists({ paymentId: subscription.latestPaymentId, status: { $in: ["REQUESTED", "PROCESSING", "PROCESSED"] } })) return null;
  const gym = await Gym.findOne({ _id: subscription.gymId, status: "ACTIVE", deletedAt: null })
    .select("name +whatsappUpdates").lean();
  const link = gym?.whatsappUpdates;
  if (!link?.enabled || !validWhatsAppInvite(link.inviteUrl || "", link.type)) return null;
  return invitationPresentation(link, gym!.name);
}

export const ownersInvitationKey = "private.whatsapp.platform-owners";
export async function platformOwnersInvitation(userId: string, gymId: string) {
  const gym = await Gym.findOne({ _id: gymId, ownerId: userId, deletedAt: null, status: "ACTIVE" }).lean();
  if (!gym) return null;
  const sub = await Subscription.findOne({ gymId, userId, type: "PLATFORM", status: "ACTIVE", endsAt: { $gt: new Date() } }).sort({ endsAt: -1 }).lean();
  if (!sub?.latestPaymentId || !await Payment.exists({ _id: sub.latestPaymentId, payerId: userId, gymId, subscriptionId: sub._id, purpose: "PLATFORM_PLAN", status: "CAPTURED", fulfillmentStatus: "APPLIED" })) return null;
  if (await Refund.exists({ paymentId: sub.latestPaymentId, status: { $in: ["REQUESTED", "PROCESSING", "PROCESSED"] } })) return null;
  const setting = await PlatformSettings.findOne({ key: ownersInvitationKey }).lean();
  if (!setting?.values?.enabled || !validWhatsAppInvite(setting.values.inviteUrl, setting.values.type)) return null;
  return invitationPresentation(setting.values, "GETFIT4U Gym Owners");
}
