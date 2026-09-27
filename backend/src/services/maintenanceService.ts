import { Gym } from "../models/Gym.js";
import { Subscription } from "../models/Commerce.js";
import { logger } from "../config/logger.js";
import { WorkoutAssignment } from "../models/Fitness.js";
import { transitionMembership } from "./membershipLifecycleService.js";
import { cleanupExpiredStories } from "./socialService.js";
import { cleanupOrphanedFollows } from "./socialRelationshipService.js";
import { deliverCampaignBatch } from "./campaignDeliveryService.js";
import { scheduleMembershipReminders } from "./membershipReminderService.js";
let running = false;
let followCleanupCursor: string | undefined;
export async function maintainRecords() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    await WorkoutAssignment.updateMany(
      { status: "SCHEDULED", startsAt: { $lte: now } },
      { $set: { status: "ACTIVE" } },
    );
    await WorkoutAssignment.updateMany(
      { status: "ACTIVE", endsAt: { $lt: now } },
      { $set: { status: "COMPLETED" } },
    );
    const frozen = await Subscription.find({
      type: "GYM_MEMBERSHIP",
      status: "FROZEN",
      freezePeriods: { $not: { $elemMatch: { endsAt: { $gt: now } } } },
    })
      .select("publicId endsAt")
      .limit(100)
      .lean();
    const elapsed = await Subscription.find({
      type: "GYM_MEMBERSHIP",
      status: { $in: ["ACTIVE", "GRACE"] },
      endsAt: { $lte: now },
    })
      .select("publicId")
      .limit(100)
      .lean();
    for (const [records, action] of [
      [frozen, "reactivate"],
      [elapsed, "expire"],
    ] as const) {
      for (const record of records) {
        try {
          await transitionMembership({
            publicId: record.publicId,
            action:
              action === "reactivate" && record.endsAt <= now
                ? "expire"
                : action,
          });
        } catch (error) {
          logger.warn(
            { err: error, subscriptionId: record.publicId },
            "Membership maintenance transition failed",
          );
        }
      }
    }
    await scheduleMembershipReminders(now);
    await Subscription.updateMany(
      {
        type: "PLATFORM",
        status: { $in: ["ACTIVE", "GRACE"] },
        endsAt: { $lt: now },
      },
      { $set: { status: "EXPIRED" } },
    );
    const expired = await Subscription.distinct("gymId", {
      type: "PLATFORM",
      status: "EXPIRED",
    });
    for (const gymId of expired)
      if (
        !(await Subscription.exists({
          gymId,
          type: "PLATFORM",
          status: "ACTIVE",
          endsAt: { $gte: now },
        }))
      )
        await Gym.updateOne(
          { _id: gymId, platformSubscriptionStatus: "ACTIVE" },
          { $set: { platformSubscriptionStatus: "EXPIRED" } },
        );
    await deliverCampaignBatch();
    await cleanupExpiredStories({ limit: 100, now });
    const followCleanup = await cleanupOrphanedFollows({
      after: followCleanupCursor,
      limit: 100,
    });
    followCleanupCursor = followCleanup.nextCursor;
  } catch (error) {
    logger.error({ err: error }, "Background record maintenance failed");
  } finally {
    running = false;
  }
}
export function startMaintenance() {
  void maintainRecords();
  const timer = setInterval(() => void maintainRecords(), 30000);
  timer.unref();
  return () => clearInterval(timer);
}
