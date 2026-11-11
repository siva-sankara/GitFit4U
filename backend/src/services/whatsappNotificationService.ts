import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { Notification } from "../models/Engagement.js";
import { User } from "../models/User.js";
import { enqueueWhatsAppDomainEvent } from "./whatsappDeliveryService.js";

/** Reuse committed notifications as durable intents; never enter a payment session. */
export async function processWhatsAppNotificationIntents(limit = 25) {
  if (env.WHATSAPP_MODE === "disabled") return 0;
  let processed = 0;
  while (processed < limit) {
    const now = new Date();
    const leaseId = randomUUID();
    const notification = await Notification.findOneAndUpdate({
      whatsappStatus: "QUEUED", whatsappAvailableAt: { $lte: now },
      $or: [{ whatsappLeaseUntil: null }, { whatsappLeaseUntil: { $lte: now } }],
    }, {
      $set: { whatsappLeaseId: leaseId, whatsappLeaseUntil: new Date(now.getTime() + 120_000) },
      $inc: { whatsappAttempts: 1 },
    }, { returnDocument: "after", sort: { whatsappAvailableAt: 1 } }).lean();
    if (!notification) break;
    processed++;
    const claim = { _id: notification._id, whatsappLeaseId: leaseId };
    try {
      // Do not deliver stale intents after a long outage or re-enable.
      const user = notification.createdAt >= new Date(now.getTime() - 48 * 60 * 60_000)
        ? await User.findOne({ _id: notification.userId, status: { $in: ["ACTIVE", "PENDING_VERIFICATION"] } }).select("name phone status").lean()
        : null;
      const outbox = user && await enqueueWhatsAppDomainEvent({
        event: notification.event, entityId: notification.entityId,
        userId: notification.userId, gymId: notification.gymId,
        occurrenceId: notification.whatsappOccurrenceId || "once",
        actionUrl: notification.actionUrl, propagateQueueErrors: true,
      }, user);
      await Notification.updateOne(claim, {
        $set: { whatsappStatus: outbox ? "ENQUEUED" : "SKIPPED" },
        $unset: { whatsappLeaseId: 1, whatsappLeaseUntil: 1 },
      });
    } catch {
      const retry = notification.whatsappAttempts < 6;
      await Notification.updateOne(claim, {
        $set: { whatsappStatus: retry ? "QUEUED" : "FAILED", whatsappAvailableAt: new Date(now.getTime() + Math.min(3_600_000, 15_000 * 2 ** notification.whatsappAttempts)) },
        $unset: { whatsappLeaseId: 1, whatsappLeaseUntil: 1 },
      });
      logger.warn({ notificationId: String(notification._id), retry, code: "WHATSAPP_INTENT_FAILED" }, "WhatsApp intent could not be queued; other channels are unaffected");
    }
  }
  return processed;
}
