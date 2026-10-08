import type { Request } from "express";
import { Conversation, Message } from "../models/Collaboration.js";
import { ClassBooking, SupportTicket } from "../models/Engagement.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { Invoice } from "../models/Business.js";
import { MemberProfile } from "../models/Member.js";
import { Gym } from "../models/Gym.js";
import { ensureSupportConversation } from "./supportConversationService.js";

export interface NotificationTarget {
  event?: string; entityId?: string; gymId?: unknown; actionUrl?: string;
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
  if (event === "message.received") {
    const message = await Message.findOne({ publicId: id, deletedAt: null }).lean();
    const conversation = message && await Conversation.findOne({ _id: message.conversationId, participants: auth.userId }).lean();
    return conversation ? found(`${root}/messages?conversation=${encodeURIComponent(conversation.publicId)}`) : absent();
  }
  if (event.startsWith("class.")) {
    if (!objectId(id)) return absent();
    const memberIds = await MemberProfile.distinct("_id", { userId: auth.userId });
    const booking = await ClassBooking.findOne({ _id: id, memberProfileId: { $in: memberIds } }).populate("sessionId").lean();
    return booking?.sessionId ? memberDestination(`/app/classes?booking=${id}`) : absent();
  }
  if (event.startsWith("payment.") || event === "invoice.ready") {
    let paymentId = id;
    if (event === "invoice.ready") {
      const invoice = await Invoice.findOne({ ...identity(id), ...(admin ? {} : { userId: auth.userId }) }).lean();
      if (!invoice?.paymentId) return absent();
      paymentId = String(invoice.paymentId);
    }
    const payment = await Payment.findOne({ ...identity(paymentId), ...(admin ? {} : { payerId: auth.userId }) }).lean();
    return payment ? found(`${root === "/app" ? "/app/profile?section=payments&" : root + "/payments?"}payment=${encodeURIComponent(payment.publicId)}`) : absent();
  }
  if (event === "platform.expiring" || event.startsWith("gym.")) {
    if (!row.gymId) return absent();
    const gym = await Gym.findOne({ _id: row.gymId, deletedAt: null, ...(admin ? {} : { ownerId: auth.userId }) }).lean();
    if (!gym) return absent();
    return found(admin ? `/admin/gyms?gym=${encodeURIComponent(gym.publicId)}` : `/platform-renewal?gym=${encodeURIComponent(gym.publicId)}`);
  }
  if (event.startsWith("membership.")) {
    const subscription = await Subscription.findOne({ ...identity(id), type: "GYM_MEMBERSHIP", userId: auth.userId }).lean();
    if (subscription) return memberDestination(`/app/profile?section=membership&membership=${encodeURIComponent(subscription.publicId)}`);
    const member = await MemberProfile.findOne({ ...identity(id), userId: auth.userId }).lean();
    return member ? memberDestination("/app/profile?section=membership") : absent();
  }
  if (event === "attendance.checked_in") return memberDestination("/app/attendance");
  if (event === "account.registered" || event === "account.verified") return found(root === "/app" ? "/app/home" : `${root}/dashboard`);
  // Legacy campaign/trainer/review links are restricted to existing workspace
  // sections. Their APIs still enforce ownership; unknown links stay in inbox.
  const path = row.actionUrl || "";
  const allowed = new RegExp(`^${root}/(?:notifications|workouts|reviews|referrals|trainers)(?:\\?[^#]*)?$`);
  return allowed.test(path) && !path.includes("\\") ? found(path) : absent();
}
