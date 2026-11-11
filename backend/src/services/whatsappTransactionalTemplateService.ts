import mongoose, { type ClientSession, type Types } from "mongoose";
import { Payment, Subscription } from "../models/Commerce.js";
import { ClassBooking, ClassSession, Trainer } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { Gym } from "../models/Gym.js";
import { AppError } from "../utils/AppError.js";
import { membershipWhatsAppDate } from "./whatsappMembershipTemplateService.js";

export const transactionalWhatsAppParameterCount = (event: string) =>
  event === "payment.successful" || event === "payment.offline" ? 7
    : ["class.booked", "class.cancelled", "class.updated", "class.trainer_changed", "class.reminder"].includes(event) ? 6 : undefined;

function text(value: unknown) {
  if (typeof value !== "string" || !value.trim() || value.length > 1024)
    throw new AppError(409, "WHATSAPP_TEMPLATE_DATA_INVALID", "The notification does not have complete transactional details.");
  return value.replace(/\s+/g, " ").trim();
}

export async function resolveTransactionalWhatsAppTemplate(input: {
  event: string; userId: string | Types.ObjectId; gymId?: string | Types.ObjectId;
  entityId: string; session?: ClientSession;
}, user: { name?: string }, now = new Date()) {
  if (!input.gymId || transactionalWhatsAppParameterCount(input.event) === undefined) return null;
  const session = input.session || null;
  const gym = await Gym.findOne({ _id: input.gymId, deletedAt: null }).select("name timezone").session(session).lean();
  if (!gym) return null;
  const timezone = gym.timezone || "Asia/Kolkata";
  let values: string[];
  let expiresAt = new Date(now.getTime() + 48 * 60 * 60_000);
  if (input.event.startsWith("payment.")) {
    const payment = await Payment.findOne({ publicId: input.entityId, gymId: input.gymId, payerId: input.userId, purpose: "MEMBERSHIP", status: "CAPTURED" }).session(session).lean();
    if (!payment?.subscriptionId) return null;
    const subscription = await Subscription.findOne({ _id: payment.subscriptionId, gymId: input.gymId, userId: input.userId, type: "GYM_MEMBERSHIP", status: { $ne: "PENDING_PAYMENT" } }).session(session).lean();
    if (!subscription?.startsAt || !subscription.endsAt || !Number.isSafeInteger(payment.amountMinor) || payment.amountMinor < 0 || payment.currency !== "INR") return null;
    values = [text(user.name), text(gym.name), (payment.amountMinor / 100).toFixed(2), text(subscription.planSnapshot?.name), text(payment.publicId), membershipWhatsAppDate(subscription.startsAt, timezone), membershipWhatsAppDate(subscription.endsAt, timezone)];
  } else {
    if (!mongoose.isValidObjectId(input.entityId)) return null;
    const booking = await ClassBooking.findOne({ _id: input.entityId, gymId: input.gymId, status: input.event === "class.cancelled" ? "CANCELLED" : "BOOKED" }).session(session).lean();
    if (!booking || !await MemberProfile.exists({ _id: booking.memberProfileId, gymId: input.gymId, userId: input.userId }).session(session)) return null;
    const classSession = await ClassSession.findOne({ _id: booking.sessionId, gymId: input.gymId, ...(input.event !== "class.cancelled" ? { status: "SCHEDULED", startsAt: { $gt: now } } : {}) }).session(session).lean();
    if (!classSession) return null;
    const trainer = classSession.trainerId ? await Trainer.findOne({ _id: classSession.trainerId, gymId: input.gymId }).select("name").session(session).lean() : null;
    const startsAt = new Date(classSession.startsAt);
    values = [text(user.name), text(gym.name), text(classSession.name), membershipWhatsAppDate(startsAt, timezone), new Intl.DateTimeFormat("en-IN", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(startsAt), text(trainer?.name || "Gym team")];
    if (input.event !== "class.cancelled") expiresAt = new Date(Math.min(expiresAt.getTime(), startsAt.getTime()));
  }
  return { parameters: [{ type: "body", parameters: values.map(value => ({ type: "text", text: value })) }], expiresAt };
}
