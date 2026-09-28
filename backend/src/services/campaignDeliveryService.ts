import { randomUUID } from "node:crypto";
import { Campaign, Notification } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";
import { logger } from "../config/logger.js";

/** Bounded, leased campaign cursor with per-recipient unique notification keys. */
export async function deliverCampaignBatch() {
  const now = new Date(),
    leaseId = randomUUID();
  const campaign = await Campaign.findOneAndUpdate(
    {
      status: { $in: ["QUEUED", "PROCESSING", "SCHEDULED"] },
      channel: "IN_APP",
      $and: [
        { $or: [{ leaseUntil: null }, { leaseUntil: { $lte: now } }] },
        { $or: [{ scheduledAt: null }, { scheduledAt: { $lte: now } }] },
      ],
    },
    {
      $set: {
        leaseId,
        leaseUntil: new Date(now.getTime() + 300000),
        status: "PROCESSING",
      },
    },
    { returnDocument: "after", sort: { createdAt: 1 } },
  );
  if (!campaign) return false;
  const owned = { _id: campaign._id, leaseId };
  try {
    const platform = campaign.scope === "PLATFORM";
    const filter: any = platform
      ? {
          status: "ACTIVE",
          roles: { $in: campaign.audience.roles },
          createdAt: {
            $lte:
              campaign.audienceSnapshot?.createdBefore || campaign.createdAt,
          },
        }
      : {
          gymId: campaign.gymId,
          status: campaign.audience?.status || "ACTIVE",
        };
    if (campaign.deliveryCursor) filter._id = { $gt: campaign.deliveryCursor };
    const recipients = platform
      ? await User.find(filter)
          .sort({ _id: 1 })
          .limit(100)
          .select("_id notificationPreferences")
          .lean()
      : await MemberProfile.find(filter)
          .sort({ _id: 1 })
          .limit(100)
          .select("_id userId")
          .lean();
    if (recipients.length) {
      const users = platform
        ? recipients
        : await User.find({
            _id: { $in: recipients.map((row) => row.userId) },
            status: "ACTIVE",
          })
            .select("_id notificationPreferences")
            .lean();
      if (users.length)
        await Notification.bulkWrite(
          users.map((user) => {
            // Announcements remain visible in the inbox; push observes account preferences.
            const category = platform ? "SYSTEM" : "GYM";
            const prefs = user.notificationPreferences;
            const push =
              prefs?.push !== false &&
              (!prefs?.categories || prefs.categories.includes(category));
            return {
              updateOne: {
                filter: {
                  userId: user._id,
                  dedupeKey: `campaign:${campaign.publicId}`,
                },
                update: {
                  $setOnInsert: {
                    userId: user._id,
                    gymId: campaign.gymId,
                    dedupeKey: `campaign:${campaign.publicId}`,
                    category,
                    entityType: "SYSTEM",
                    entityId: campaign.publicId,
                    title: campaign.name,
                    message: campaign.message,
                    actionUrl: "/notifications",
                    channels: push ? ["IN_APP", "PUSH"] : ["IN_APP"],
                    pushStatus: push ? "QUEUED" : "NOT_REQUESTED",
                    deliveredAt: now,
                  },
                },
                upsert: true,
              },
            };
          }),
        );
      const delivered = await Notification.countDocuments({
        dedupeKey: `campaign:${campaign.publicId}`,
      });
      await Campaign.updateOne(owned, {
        $set: {
          deliveryCursor: recipients[recipients.length - 1]._id,
          status: "QUEUED",
          "analytics.sent": delivered,
          "analytics.delivered": delivered,
        },
        $unset: { leaseId: 1, leaseUntil: 1 },
      });
    } else {
      const sent = await Notification.countDocuments({
        dedupeKey: `campaign:${campaign.publicId}`,
      });
      await Campaign.updateOne(owned, {
        $set: {
          status: "COMPLETED",
          "analytics.recipients": sent,
          "analytics.sent": sent,
          "analytics.delivered": sent,
        },
        $unset: { leaseId: 1, leaseUntil: 1 },
      });
    }
  } catch (error) {
    await Campaign.updateOne(owned, {
      $set: { status: "QUEUED", leaseUntil: new Date(Date.now() + 60000) },
      $unset: { leaseId: 1 },
    });
    logger.error(
      { err: error, campaignId: campaign.publicId },
      "Campaign delivery deferred; cursor will retry safely",
    );
  }
  return true;
}
