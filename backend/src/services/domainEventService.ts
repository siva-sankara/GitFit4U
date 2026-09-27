import type { ClientSession, Types } from "mongoose";
import { Notification } from "../models/Engagement.js";
import { User } from "../models/User.js";

// Copy belongs here, not in controllers or browser event handlers. Messages
// intentionally exclude amounts, diagnoses, message contents and contact data.
export const notificationEvents = {
  "account.registered": [
    "SYSTEM",
    "Welcome to GETFIT4U",
    "Your account is ready.",
  ],
  "account.verified": [
    "SYSTEM",
    "Account verified",
    "Your account verification is complete.",
  ],
  "membership.created": [
    "MEMBERSHIP",
    "Membership created",
    "View your new membership details.",
  ],
  "membership.activated": [
    "MEMBERSHIP",
    "Membership active",
    "Your gym membership is now active.",
  ],
  "membership.frozen": [
    "MEMBERSHIP",
    "Membership frozen",
    "Your membership has been paused. View its return date.",
  ],
  "membership.reactivated": [
    "MEMBERSHIP",
    "Membership reactivated",
    "Your membership is active again. View the updated dates.",
  ],
  "membership.expiring": [
    "MEMBERSHIP",
    "Membership expiring soon",
    "View your membership renewal options.",
  ],
  "membership.expired": [
    "MEMBERSHIP",
    "Membership expired",
    "Your membership has reached its end date.",
  ],
  "membership.cancelled": [
    "MEMBERSHIP",
    "Membership cancelled",
    "Your membership status has changed.",
  ],
  "membership.requested": [
    "MEMBERSHIP",
    "Join request received",
    "Your gym join request is awaiting review.",
  ],
  "payment.successful": [
    "PAYMENT",
    "Payment confirmed",
    "Your payment receipt is available in your account.",
  ],
  "payment.offline": [
    "PAYMENT",
    "Offline payment recorded",
    "Your gym has recorded an offline payment. View your receipt.",
  ],
  "payment.failed": [
    "PAYMENT",
    "Payment unsuccessful",
    "Review your payment status and retry when ready.",
  ],
  "payment.refunded": [
    "PAYMENT",
    "Refund recorded",
    "A refund has been recorded. View your payment history for details.",
  ],
  "workout.assigned": [
    "TRAINER",
    "Workout assigned",
    "A workout plan has been assigned to you.",
  ],
  "referral.created": [
    "SYSTEM",
    "Referral ready",
    "Your referral invitation is ready to share.",
  ],
  "trainer.assigned": [
    "TRAINER",
    "Trainer assigned",
    "Your trainer assignment has changed.",
  ],
  "attendance.checked_in": [
    "ATTENDANCE",
    "Check-in recorded",
    "Your gym attendance has been recorded.",
  ],
  "message.received": [
    "SYSTEM",
    "New message",
    "You have a new message. Open your conversations to read it.",
  ],
  "support.updated": [
    "SYSTEM",
    "Support update",
    "Your support conversation has been updated.",
  ],
  "review.created": [
    "GYM",
    "New gym review",
    "A member has reviewed your gym.",
  ],
  "review.updated": [
    "GYM",
    "Gym review updated",
    "A gym review has been updated.",
  ],
  "admin.announcement": [
    "SYSTEM",
    "Platform announcement",
    "A new platform announcement is available.",
  ],
  "gym.activated": ["GYM", "Gym activated", "Your gym is now active."],
  "gym.suspended": [
    "GYM",
    "Gym status changed",
    "Review your gym status in the owner workspace.",
  ],
  "gym.archived": ["GYM", "Gym archived", "Your gym has been archived."],
} as const;

type Event = keyof typeof notificationEvents;
export function notificationPayload(
  event: Event,
  entityId: string,
  occurrenceId = "once",
) {
  const [category, title, message] = notificationEvents[event];
  return {
    category,
    title,
    message,
    entityId,
    entityType: "SYSTEM",
    dedupeKey: `${event}:${entityId}:${occurrenceId}`,
  };
}

export async function emitDomainEvent(input: {
  event: Event;
  userId: string | Types.ObjectId;
  gymId?: string | Types.ObjectId;
  entityId: string;
  occurrenceId?: string;
  actionUrl?: string;
  session?: ClientSession;
}) {
  const user = await User.findById(input.userId)
    .select("status notificationPreferences")
    .session(input.session || null)
    .lean();
  if (!user || !["ACTIVE", "PENDING_VERIFICATION"].includes(user.status))
    return;
  const payload = notificationPayload(
    input.event,
    input.entityId,
    input.occurrenceId,
  );
  const prefs = user.notificationPreferences;
  const push =
    user.status === "ACTIVE" &&
    prefs?.push !== false &&
    (!prefs?.categories || prefs.categories.includes(payload.category));
  const actionUrl =
    input.actionUrl?.startsWith("/") && !input.actionUrl.startsWith("//")
      ? input.actionUrl
      : "/notifications";
  return Notification.updateOne(
    { userId: input.userId, dedupeKey: payload.dedupeKey },
    {
      $setOnInsert: {
        ...payload,
        userId: input.userId,
        gymId: input.gymId,
        actionUrl,
        channels: push ? ["IN_APP", "PUSH"] : ["IN_APP"],
        pushStatus: push ? "QUEUED" : "NOT_REQUESTED",
        deliveredAt: new Date(),
      },
    },
    { upsert: true, ...(input.session ? { session: input.session } : {}) },
  );
}
