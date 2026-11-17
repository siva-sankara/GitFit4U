import type { Request } from "express";
import { Conversation, Message } from "../models/Collaboration.js";
import { ClassBooking, SupportTicket, Review } from "../models/Engagement.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { Invoice } from "../models/Business.js";
import { MemberProfile } from "../models/Member.js";
import { Gym } from "../models/Gym.js";
import { ensureSupportConversation } from "./supportConversationService.js";
import { getWhatsAppConversation } from "./whatsappDeliveryService.js";
import { AppError } from "../utils/AppError.js";

export interface NotificationTarget {
  _id?: unknown; event?: string; entityId?: string; entityType?: string; dedupeKey?: string; gymId?: unknown; actionUrl?: string;
  metadata?: Record<string, unknown>;
}
export interface NotificationDestination { path: string; available: boolean; explanation?: string }
const absent = (): NotificationDestination => ({ path: "/notifications", available: false,
  explanation: "This update no longer has an accessible destination. Your notification remains in the inbox." });
const found = (path: string): NotificationDestination => ({ path, available: true });
const objectId = (id: string) => /^[a-f\d]{24}$/i.test(id);
const identity = (id: string) => objectId(id) ? { $or: [{ _id: id }, { publicId: id }] } : { publicId: id };
export function notificationWorkspace(role: string) {
  return role === "ADMIN" ? "/admin" : role === "TRAINER" ? "/trainer" : ["GYM_OWNER", "GYM_STAFF"].includes(role) ? "/owner" : "/app";
}

/** Run only on a notification already scoped to this recipient. The resource is
 * checked again here; neither push payload URLs nor message text grant access. */
export async function resolveNotificationDestination(row: NotificationTarget, auth: NonNullable<Request["auth"]>): Promise<NotificationDestination> {
  const event = row.event || "", id = row.entityId || "", root = notificationWorkspace(auth.role);
  const admin = auth.role === "ADMIN" && auth.permissions.includes("admin:platform");
  const switchGym = (): NotificationDestination => ({ path: "/notifications", available: false,
    explanation: "This update belongs to another gym. Select that gym in your workspace, then reopen this notification." });
  if (["gym.announcement", "admin.announcement"].includes(event) || row.entityType === "CAMPAIGN" || row.dedupeKey?.startsWith("campaign:"))
    return row._id ? found(`${root}/notifications?notification=${encodeURIComponent(String(row._id))}`) : absent();
  // ProtectedRoute restricts /app to the active member role. Do not send a
  // dual-role account into a route that would silently redirect to its dashboard.
  const memberDestination = (path: string) => auth.role === "USER" ? found(path) : {
    path: "/notifications", available: false,
    explanation: "This update belongs to your member workspace. Switch to your User role, then reopen this notification.",
  };
  if (event === "support.updated") {
    let ticket = await SupportTicket.findOne({ ...identity(id), ...(admin ? {} : { requesterId: auth.userId }) });
    if (!ticket) {
      const message = await Message.findOne({ publicId: id, deletedAt: null }).lean();
      const conversation = message && await Conversation.findOne({ _id: message.conversationId, type: "SUPPORT" }).lean();
      if (conversation?.supportTicketId) ticket = await SupportTicket.findOne({ _id: conversation.supportTicketId, ...(admin ? {} : { requesterId: auth.userId }) });
    }
    if (!ticket) return absent();
    const conversation = await ensureSupportConversation(ticket);
    return found(`${root}/support?ticket=${encodeURIComponent(conversation.publicId)}`);
  }
  // Owner-issued reminders/activation invitations identify a member but their
  // intended destination is a persisted chat. Recheck participation, not just URL shape.
  const thread = /^\/messages\/([A-Za-z0-9_-]+)$/.exec(row.actionUrl || "");
  if (event !== "message.received" && thread) {
    const conversation = await Conversation.findOne({ publicId: thread[1], participants: auth.userId }).lean();
    return conversation ? found(`${root}/messages?conversation=${encodeURIComponent(conversation.publicId)}`) : absent();
  }
  if (event === "message.received") {
    if (row.actionUrl?.includes("channel=whatsapp")) {
      if (!admin && !auth.permissions.includes("member:read")) return absent();
      try {
        const conversation = await getWhatsAppConversation(auth, id);
        return found(`${root}/messages?channel=whatsapp&conversation=${encodeURIComponent(conversation.publicId)}`);
      } catch (error) {
        if (error instanceof AppError && [400, 403, 404, 409].includes(error.statusCode)) return absent();
        throw error;
      }
    }
    const message = await Message.findOne({ publicId: id, deletedAt: null }).lean();
    const conversation = message && await Conversation.findOne({ _id: message.conversationId, participants: auth.userId }).lean();
    return conversation ? found(`${root}/messages?conversation=${encodeURIComponent(conversation.publicId)}`) : absent();
  }
  if (event.startsWith("class.")) {
    if (!objectId(id)) return absent();
    const memberIds = await MemberProfile.distinct("_id", { userId: auth.userId });
    const booking = await ClassBooking.findOne({ _id: id, memberProfileId: { $in: memberIds } }).populate("sessionId").lean();
    return booking?.sessionId ? memberDestination(`/app/profile?section=bookings&booking=${id}`) : absent();
  }
  if (event.startsWith("payment.") || event === "invoice.ready") {
    let paymentId = id;
    if (event === "invoice.ready") {
      const invoice = await Invoice.findOne({ ...identity(id), ...(admin ? {} : { userId: auth.userId }) }).lean();
      if (!invoice?.paymentId) return absent();
      paymentId = String(invoice.paymentId);
    }
    const payment = await Payment.findOne({ ...identity(paymentId), ...(admin ? {} : { payerId: auth.userId }) }).lean();
    if (!payment) return absent();
    if (["GYM_OWNER", "GYM_STAFF"].includes(auth.role) && String(payment.gymId) !== auth.gymId) return switchGym();
    if (root === "/trainer") return memberDestination(`/app/profile?section=payments&payment=${encodeURIComponent(payment.publicId)}`);
    return found(`${root === "/app" ? "/app/profile?section=payments&" : root + "/payments?"}payment=${encodeURIComponent(payment.publicId)}`);
  }
  if (event === "platform.expiring" || ["gym.activated", "gym.suspended", "gym.archived"].includes(event)) {
    if (!row.gymId) return absent();
    const gym = await Gym.findOne({ _id: row.gymId, deletedAt: null, ...(admin ? {} : { ownerId: auth.userId }) }).lean();
    if (!gym) return absent();
    if (admin) return found(`/admin/gyms?gym=${encodeURIComponent(gym.publicId)}`);
    if (event === "platform.expiring") return found(`/platform-renewal?gym=${encodeURIComponent(gym.publicId)}`);
    return auth.gymId === String(gym._id) ? found("/owner/gym-profile") : switchGym();
  }
  if (event.startsWith("membership.") || event === "trainer.assigned") {
    if (event === "membership.requested" && auth.role === "GYM_OWNER") {
      const gym = row.gymId && await Gym.exists({ _id: row.gymId, ownerId: auth.userId, deletedAt: null });
      if (!gym) return absent();
      if (String(row.gymId) !== auth.gymId) return switchGym();
      const member = await MemberProfile.findOne({ ...identity(id), gymId: auth.gymId, isDeleted: { $ne: true } }).lean();
      return member ? found(`/owner/members/${encodeURIComponent(member.publicId)}`) : absent();
    }
    const subscription = await Subscription.findOne({ ...identity(id), userId: auth.userId }).lean();
    if (subscription?.type === "PLATFORM") {
      const gym = await Gym.findOne({ _id: subscription.gymId, ownerId: auth.userId, deletedAt: null }).lean();
      return gym ? found(`/platform-renewal?gym=${encodeURIComponent(gym.publicId)}`) : absent();
    }
    if (subscription) return memberDestination(`/app/profile?section=membership&membership=${encodeURIComponent(subscription.publicId)}`);
    const member = await MemberProfile.findOne({ ...identity(id), userId: auth.userId }).lean();
    if (!member) return absent();
    const current = member.currentSubscriptionId && await Subscription.findOne({ _id: member.currentSubscriptionId, userId: auth.userId, gymId: member.gymId, type: "GYM_MEMBERSHIP" }).lean();
    return memberDestination(`/app/profile?section=membership${current ? `&membership=${encodeURIComponent(current.publicId)}` : ""}`);
  }
  if (event === "workout.assigned") return memberDestination("/app/profile?section=workouts");
  if (event === "referral.created") return memberDestination("/app/profile?section=referrals");
  if (event.startsWith("review.")) {
    const ownedGyms = admin ? [] : await Gym.distinct("_id", { ownerId: auth.userId, deletedAt: null });
    const review = await Review.findOne({ ...identity(id), ...(admin ? {} : { $and: [{ $or: [{ userId: auth.userId }, { gymId: { $in: ownedGyms } }] }] }) }).lean();
    const gym = review && await Gym.findOne({ _id: review.gymId, deletedAt: null }).lean();
    return gym ? found(`${root}/gyms/${encodeURIComponent(gym.slug)}#gym-reviews`) : absent();
  }
  if (event === "attendance.checked_in") return memberDestination("/app/attendance");
  if (event === "account.registered" || event === "account.verified") return found(root === "/app" ? "/app/home" : `${root}/dashboard`);
  // Legacy campaign/trainer/review links are restricted to existing workspace
  // sections. Their APIs still enforce ownership; unknown links stay in inbox.
  const path = row.actionUrl || "";
  const allowed = new RegExp(`^${root}/(?:notifications|workouts|reviews|referrals|trainers)(?:\\?[^#]*)?$`);
  return allowed.test(path) && !path.includes("\\") ? found(path) : absent();
}
