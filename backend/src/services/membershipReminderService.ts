import mongoose from "mongoose";
import { Subscription, MembershipPlan } from "../models/Commerce.js";
import { MemberProfile } from "../models/Member.js";
import { Gym } from "../models/Gym.js";
import { Notification } from "../models/Engagement.js";
import { AuditLog } from "../models/Operations.js";
import { emitDomainEvent, notificationPayload } from "./domainEventService.js";
import { logger } from "../config/logger.js";

const dayMs = 86400000;
export function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}
/** One reminder per gym-local calendar date, expiry -7 through expiry +7. */
export function reminderWindow(now: Date, endsAt: Date, timeZone: string) {
  const date = localDateKey(now, timeZone),
    expiryDate = localDateKey(endsAt, timeZone);
  const daysRemaining = Math.round(
    (Date.parse(expiryDate) - Date.parse(date)) / dayMs,
  );
  return daysRemaining < -7 || daysRemaining > 7
    ? null
    : { date, expiryDate, daysRemaining, expired: endsAt <= now };
}

export async function reminderStillCurrent(notification: any) {
  const meta = notification.metadata;
  if (!meta?.reminderCycle) return true;
  const subscription = await Subscription.findOne({
    publicId: meta.subscriptionId,
    endsAt: new Date(meta.cycleEndsAt),
    status: { $in: ["ACTIVE", "GRACE", "EXPIRED"] },
  }).lean();
  if (!subscription) return false;
  const gym = await Gym.findOne({
    _id: subscription.gymId,
    status:
      subscription.type === "PLATFORM"
        ? { $in: ["ACTIVE", "INACTIVE"] }
        : "ACTIVE",
    deletedAt: null,
  })
    .select("timezone")
    .lean();
  if (
    !gym ||
    !reminderWindow(new Date(), subscription.endsAt, gym.timezone || "UTC")
  )
    return false;
  if (subscription.type === "GYM_MEMBERSHIP")
    return Boolean(
      await MemberProfile.exists({
        _id: subscription.memberProfileId,
        currentSubscriptionId: subscription._id,
        status: "ACTIVE",
      }),
    );
  return !(await Subscription.exists({
    gymId: subscription.gymId,
    type: "PLATFORM",
    status: { $in: ["ACTIVE", "GRACE"] },
    endsAt: { $gt: subscription.endsAt },
  }));
}

export async function scheduleMembershipReminders(now = new Date()) {
  const candidates = Subscription.find({
    type: { $in: ["GYM_MEMBERSHIP", "PLATFORM"] },
    status: { $in: ["ACTIVE", "GRACE", "EXPIRED"] },
    endsAt: {
      $gte: new Date(now.getTime() - 9 * dayMs),
      $lte: new Date(now.getTime() + 9 * dayMs),
    },
  })
    .select(
      "publicId type userId gymId memberProfileId endsAt planSnapshot status",
    )
    .sort({ _id: 1 })
    .lean()
    .cursor({ batchSize: 100 });
  for await (const candidate of candidates) {
    if (!candidate.userId || !candidate.endsAt) continue;
    try {
      const gym = await Gym.findOne({
        _id: candidate.gymId,
        status:
          candidate.type === "PLATFORM"
            ? { $in: ["ACTIVE", "INACTIVE"] }
            : "ACTIVE",
        deletedAt: null,
      })
        .select("publicId slug name timezone")
        .lean();
      if (!gym) continue;
      const timeZone = gym.timezone || "UTC",
        window = reminderWindow(now, candidate.endsAt, timeZone);
      if (!window) continue;
      const event =
        candidate.type === "PLATFORM"
          ? "platform.expiring"
          : "membership.renewal_reminder";
      const cycle = candidate.endsAt.toISOString(),
        occurrenceId = `${cycle}:${window.date}`;
      const dedupeKey = notificationPayload(
        event,
        candidate.publicId,
        occurrenceId,
      ).dedupeKey;
      if (await Notification.exists({ userId: candidate.userId, dedupeKey }))
        continue;
      await mongoose.connection.transaction(async (session) => {
        const subscription = await Subscription.findOneAndUpdate(
          {
            _id: candidate._id,
            endsAt: candidate.endsAt,
            status: { $in: ["ACTIVE", "GRACE", "EXPIRED"] },
          },
          { $inc: { version: 1 } },
          { session, returnDocument: "after" },
        );
        if (!subscription) return;
        if (candidate.type === "GYM_MEMBERSHIP") {
          const member = await MemberProfile.findOneAndUpdate(
            {
              _id: candidate.memberProfileId,
              currentSubscriptionId: candidate._id,
              status: "ACTIVE",
            },
            { $inc: { version: 1 } },
            { session, returnDocument: "after" },
          );
          if (!member) return;
        } else {
          await Gym.updateOne(
            { _id: candidate.gymId },
            { $inc: { version: 1 } },
            { session },
          );
          if (
            await Subscription.exists({
              gymId: candidate.gymId,
              type: "PLATFORM",
              status: { $in: ["ACTIVE", "GRACE"] },
              endsAt: { $gt: candidate.endsAt },
            }).session(session)
          )
            return;
        }
        const plans =
          candidate.type === "GYM_MEMBERSHIP"
            ? await MembershipPlan.find({
                gymId: candidate.gymId,
                status: "ACTIVE",
              })
                .select("publicId name durationDays priceMinor benefits")
                .sort({ priceMinor: 1, _id: 1 })
                .limit(3)
                .session(session)
                .lean()
            : [];
        const planName = candidate.planSnapshot?.name || "Membership";
        const timing = window.expired
          ? `expired ${Math.abs(window.daysRemaining)} day(s) ago`
          : window.daysRemaining === 0
            ? "expires today"
            : `expires in ${window.daysRemaining} day(s)`;
        const result = await emitDomainEvent({
          event,
          userId: candidate.userId,
          gymId: candidate.gymId,
          entityId: candidate.publicId,
          occurrenceId,
          session,
          source: gym.name,
          actionLabel:
            candidate.type === "PLATFORM"
              ? "Renew platform subscription"
              : "View renewal plans",
          actionUrl:
            candidate.type === "PLATFORM"
              ? `/platform-renewal?gym=${encodeURIComponent(gym.publicId)}`
              : `/gyms/${encodeURIComponent(gym.slug)}#membership-plans`,
          details: {
            title: window.expired
              ? "Membership renewal reminder"
              : "Membership expiring soon",
            message: `${planName} at ${gym.name} ${timing}. Review the available plans to renew.`,
            metadata: {
              reminderCycle: true,
              subscriptionId: candidate.publicId,
              cycleEndsAt: cycle,
              expiresAt: cycle,
              gymName: gym.name,
              gymPublicId: gym.publicId,
              planName,
              timeZone,
              daysRemaining: window.daysRemaining,
              benefits: candidate.planSnapshot?.benefits || [],
              availablePlans: plans,
            },
          },
        });
        if (result?.upsertedCount) {
          await AuditLog.create(
            [
              {
                actorRole: "SYSTEM",
                gymId: candidate.gymId,
                action: "notification.reminder.scheduled",
                entityType: "Subscription",
                entityId: candidate.publicId,
                outcome: "SUCCESS",
                after: {
                  date: window.date,
                  cycleEndsAt: cycle,
                  daysRemaining: window.daysRemaining,
                },
                occurredAt: now,
              },
            ],
            { session },
          );
          logger.info(
            { event, subscriptionId: candidate.publicId, date: window.date },
            "Renewal reminder scheduled",
          );
        }
      });
    } catch (error) {
      if ((error as any)?.code !== 11000)
        logger.warn(
          {
            subscriptionId: candidate.publicId,
            code: (error as any)?.code || "REMINDER_FAILED",
          },
          "Renewal reminder deferred",
        );
    }
  }
}
