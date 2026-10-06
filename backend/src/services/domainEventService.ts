import type { ClientSession, Types } from "mongoose";
import { Notification } from "../models/Engagement.js";
import { User } from "../models/User.js";
import { enqueueWhatsAppDomainEvent } from "./whatsappDeliveryService.js";

// Copy belongs here, not in controllers or browser event handlers. Messages
// intentionally exclude amounts, diagnoses, message contents and contact data.
export const notificationEvents = {
  "invoice.ready": ["PAYMENT", "Invoice ready", "Your invoice is available. Sign in to view or download it."],
  "membership.renewed": [
    "MEMBERSHIP",
    "Membership renewed",
    "Your renewed membership is ready. View the updated dates.",
  ],
  "membership.renewal_reminder": [
    "MEMBERSHIP",
    "Membership renewal reminder",
    "Review your gym membership and renewal options.",
  ],
  "platform.expiring": [
    "SUBSCRIPTION",
    "Platform subscription renewal",
    "Review your gym's platform subscription renewal options.",
  ],
  "class.booked": [
    "SYSTEM",
    "Class booked",
    "Your class reservation is confirmed.",
  ],
  "class.cancelled": [
    "SYSTEM",
    "Class booking cancelled",
    "Your class booking has been cancelled.",
  ],
  "class.updated": [
    "SYSTEM",
    "Class schedule updated",
    "A class you booked has changed. Review the updated schedule.",
  ],
  "class.trainer_changed": ["SYSTEM", "Class trainer updated", "The trainer for your booked class has changed. View your booking for details."],
  "class.reminder": ["SYSTEM", "Upcoming class", "Your booked class starts soon. View your booking for details."],
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
  "membership.deactivated": [
    "MEMBERSHIP",
    "Gym access deactivated",
    "Your gym access has been deactivated. Contact gym management to review your access.",
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
  "gym.announcement": [
    "GYM",
    "Update from your gym",
    "Your gym has shared a member update. Open GETFIT4U to read it.",
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

export interface DomainEventInput {
  event: Event;
  userId: string | Types.ObjectId;
  gymId?: string | Types.ObjectId;
  entityId: string;
  occurrenceId?: string;
  actionUrl?: string;
  actionLabel?: string;
  source?: string;
  details?: {
    title?: string;
    message?: string;
    metadata?: Record<string, unknown>;
  };
  session?: ClientSession;
}
function storedNotification(input: DomainEventInput, user: any) {
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
    input.actionUrl?.startsWith("/") &&
    !input.actionUrl.startsWith("//") &&
    !input.actionUrl.includes("\\")
      ? input.actionUrl
      : "/notifications";
  return {
    ...payload,
    event: input.event,
    ...(input.details?.title
      ? { title: input.details.title.slice(0, 160) }
      : {}),
    ...(input.details?.message
      ? { message: input.details.message.slice(0, 5000) }
      : {}),
    ...(input.details?.metadata ? { metadata: input.details.metadata } : {}),
    source: input.source?.slice(0, 160) || "GETFIT4U",
    actionLabel: input.actionLabel?.slice(0, 80) || "View details",
    userId: input.userId,
    gymId: input.gymId,
    actionUrl,
    channels: push ? ["IN_APP", "PUSH"] : ["IN_APP"],
    pushStatus: push ? "QUEUED" : "NOT_REQUESTED",
    deliveredAt: new Date(),
  };
}
export async function emitDomainEvents(inputs: DomainEventInput[]) {
  if (!inputs.length) return;
  if (
    inputs.length > 1000 ||
    inputs.some((input) => input.session !== inputs[0].session)
  )
    throw new Error(
      "Notification batches require at most 1000 events in one session.",
    );
  const users = await User.find({
    _id: { $in: [...new Set(inputs.map((input) => String(input.userId)))] },
    status: { $in: ["ACTIVE", "PENDING_VERIFICATION"] },
  })
    .select("name phone status notificationPreferences")
    .session(inputs[0].session || null)
    .lean();
  const byId = new Map(users.map((user) => [String(user._id), user]));
  const writes = inputs.flatMap((input) => {
    const user = byId.get(String(input.userId));
    if (!user) return [];
    const document = storedNotification(input, user);
    return [
      {
        updateOne: {
          filter: { userId: input.userId, dedupeKey: document.dedupeKey },
          update: { $setOnInsert: document },
          upsert: true,
        },
      },
    ];
  });
  let result;
  if (writes.length)
    result = await Notification.bulkWrite(writes, {
      ...(inputs[0].session ? { session: inputs[0].session } : {}),
      ordered: true,
    });
  for (let index = 0; index < inputs.length; index += 25) {
    const batch = inputs.slice(index, index + 25);
    await Promise.all(
      batch.map((input) => {
        const user = byId.get(String(input.userId));
        return user ? enqueueWhatsAppDomainEvent(input, user) : undefined;
      }),
    );
  }
  return result;
}
export async function emitDomainEvent(input: DomainEventInput) {
  const user = await User.findById(input.userId)
    .select("name phone status notificationPreferences")
    .session(input.session || null)
    .lean();
  if (!user || !["ACTIVE", "PENDING_VERIFICATION"].includes(user.status))
    return;
  const document = storedNotification(input, user);
  const result = await Notification.updateOne(
    { userId: input.userId, dedupeKey: document.dedupeKey },
    {
      $setOnInsert: document,
    },
    { upsert: true, ...(input.session ? { session: input.session } : {}) },
  );
  await enqueueWhatsAppDomainEvent(input, user);
  return result;
}
