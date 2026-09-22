import { Gym } from "../models/Gym.js";
import { Subscription } from "../models/Commerce.js";
import { Campaign, Notification } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { logger } from "../config/logger.js";
import { WorkoutAssignment } from "../models/Fitness.js";
let running = false;
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
    await Subscription.updateMany(
      {
        status: "FROZEN",
        freezePeriods: { $not: { $elemMatch: { endsAt: { $gt: now } } } },
      },
      { $set: { status: "ACTIVE" } },
    );
    await Subscription.updateMany(
      { status: { $in: ["ACTIVE", "GRACE"] }, endsAt: { $lt: now } },
      { $set: { status: "EXPIRED" } },
    );
    const expired = await Subscription.distinct("gymId", {
      type: "PLATFORM",
      status: "EXPIRED",
    });
    for (const gymId of expired) {
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
    }
    const campaigns = await Campaign.find({
      status: { $in: ["QUEUED", "PROCESSING"] },
      channel: "IN_APP",
    }).limit(5);
    for (const campaign of campaigns) {
      const filter: any = {
        gymId: campaign.gymId,
        status: campaign.audience?.status || "ACTIVE",
      };
      if (campaign.deliveryCursor)
        filter._id = { $gt: campaign.deliveryCursor };
      const members = await MemberProfile.find(filter)
        .sort({ _id: 1 })
        .limit(100)
        .select("_id userId")
        .lean();
      if (members.length) {
        await Notification.bulkWrite(
          members.map((member) => ({
            updateOne: {
              filter: {
                userId: member.userId,
                dedupeKey: `campaign:${campaign.publicId}`,
              },
              update: {
                $setOnInsert: {
                  userId: member.userId,
                  gymId: campaign.gymId,
                  category: "GYM",
                  title: campaign.name,
                  message: campaign.message,
                  channels: ["IN_APP", "PUSH"],
                  pushStatus: "QUEUED",
                  deliveredAt: now,
                },
              },
              upsert: true,
            },
          })),
        );
        await Campaign.updateOne(
          {
            _id: campaign._id,
            deliveryCursor: campaign.deliveryCursor || null,
          },
          {
            $set: {
              deliveryCursor: members[members.length - 1]._id,
              status: "PROCESSING",
            },
          },
        );
      } else {
        const sent = await Notification.countDocuments({
          gymId: campaign.gymId,
          dedupeKey: `campaign:${campaign.publicId}`,
        });
        await Campaign.updateOne(
          { _id: campaign._id },
          {
            $set: {
              status: "COMPLETED",
              "analytics.sent": sent,
              "analytics.delivered": sent,
            },
          },
        );
      }
    }
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
