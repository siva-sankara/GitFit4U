import { randomUUID } from "node:crypto";
import { Notification } from "../models/Engagement.js";
import { DeviceToken } from "../models/Collaboration.js";
import { Session } from "../models/Auth.js";
import { User } from "../models/User.js";
import {
  FirebaseProvider,
  PushDeliveryError,
  pushConfigured,
} from "../integrations/notifications/firebaseProvider.js";
import { logger } from "../config/logger.js";
import type { Server } from "socket.io";
import { notificationEvents } from "./domainEventService.js";
import { reminderStillCurrent } from "./membershipReminderService.js";
import { withNotificationLinks } from "./notificationLinkService.js";
const firebase = new FirebaseProvider();
export function allowsPush(user: any, category: string) {
  return Boolean(
    user?.status === "ACTIVE" &&
    user.notificationPreferences?.push !== false &&
    (!user.notificationPreferences?.categories ||
      user.notificationPreferences.categories.includes(category)),
  );
}
// A database lease makes queued notifications safe to process on multiple API instances.
export async function deliverPush(notificationId?: string) {
  if (!pushConfigured()) return false;
  const now = new Date(),
    lease = randomUUID();
  const notification = await Notification.findOneAndUpdate(
    {
      ...(notificationId ? { _id: notificationId } : {}),
      pushStatus: "QUEUED",
      channels: "PUSH",
      archivedAt: null,
      readAt: null,
      $and: [
        {
          $or: [
            { pushNextAttemptAt: null },
            { pushNextAttemptAt: { $lte: now } },
          ],
        },
        { $or: [{ pushLeaseUntil: null }, { pushLeaseUntil: { $lte: now } }] },
      ],
    },
    {
      $set: {
        pushLeaseId: lease,
        pushLeaseUntil: new Date(Date.now() + 300000),
      },
      $inc: { pushAttempts: 1 },
    },
    { returnDocument: "after", sort: { createdAt: 1 } },
  ).select("+pushDeliveredTokens");
  if (!notification) return false;
  const filter = { _id: notification._id, pushLeaseId: lease };
  try {
    if (!(await reminderStillCurrent(notification))) {
      await Notification.updateOne(filter, {
        $set: { pushStatus: "SKIPPED" },
        $unset: { pushLeaseId: 1, pushLeaseUntil: 1 },
      });
      return true;
    }
    const [destination] = await withNotificationLinks([{
      event: notification.event, gymId: notification.gymId,
      metadata: notification.metadata, actionUrl: notification.actionUrl,
    }]);
    const user = await User.findById(notification.userId)
      .select("status notificationPreferences")
      .lean();
    const sessions = await Session.find({
      userId: notification.userId,
      revokedAt: null,
      expiresAt: { $gt: now },
    })
      .select("publicId")
      .lean();
    const devices = allowsPush(user, notification.category)
      ? await DeviceToken.find({
          userId: notification.userId,
          sessionId: { $in: sessions.map((s) => s.publicId) },
          revokedAt: null,
          permission: "GRANTED",
        }).select("+token")
      : [];
    let retry = false,
      failed = false;
    const delivered = new Set<string>(notification.pushDeliveredTokens || []);
    if (notification.createdAt < new Date(Date.now() - 86400000))
      devices.splice(0);
    for (let index = 0; index < devices.length; index += 10) {
      const currentUser = await User.findById(notification.userId)
        .select("status notificationPreferences")
        .lean();
      if (
        !allowsPush(currentUser, notification.category) ||
        !(await Notification.exists({ ...filter, archivedAt: null, readAt: null }))
      )
        break;
      await Notification.updateOne(filter, {
        $set: { pushLeaseUntil: new Date(Date.now() + 300000) },
      });
      await Promise.all(
        devices.slice(index, index + 10).map(async (device) => {
          if (delivered.has(device.tokenHash)) return;
          // Re-check ownership and consent immediately before sending.
          if (
            !(await DeviceToken.exists({
              _id: device._id,
              userId: notification.userId,
              sessionId: device.sessionId,
              revokedAt: null,
              permission: "GRANTED",
            }))
          )
            return;
          if (
            !(await Session.exists({
              publicId: device.sessionId,
              userId: notification.userId,
              revokedAt: null,
              expiresAt: { $gt: new Date() },
            }))
          )
            return;
          try {
            await firebase.send({
              token: device.token,
              title:
                notificationEvents[
                  notification.event as keyof typeof notificationEvents
                ]?.[1] ||
                (notification.dedupeKey?.startsWith("campaign:")
                  ? "New announcement"
                  : notification.title),
              body:
                notificationEvents[
                  notification.event as keyof typeof notificationEvents
                ]?.[2] ||
                (notification.dedupeKey?.startsWith("campaign:")
                  ? "Open GETFIT4U to read your announcement."
                  : notification.message),
              data: {
                notificationId: String(notification._id),
                navigationPath: destination.actionUrl || "/notifications",
                soundEnabled: currentUser.notificationPreferences?.sound === true ? "true" : "false",
              },
            });
            delivered.add(device.tokenHash);
            await Notification.updateOne(filter, {
              $addToSet: { pushDeliveredTokens: device.tokenHash },
            });
          } catch (error) {
            if (
              error instanceof PushDeliveryError &&
              error.code === "UNREGISTERED"
            ) {
              await DeviceToken.updateOne(
                { _id: device._id, tokenHash: device.tokenHash },
                { $set: { revokedAt: new Date() } },
              );
            } else {
              failed = true;
              retry ||=
                !(error instanceof PushDeliveryError) || error.retryable;
            }
          }
        }),
      );
    }
    const again = retry && notification.pushAttempts < 5;
    await Notification.updateOne(filter, {
      $set: {
        pushStatus: again
          ? "QUEUED"
          : failed
            ? "FAILED"
            : delivered.size
              ? "SENT"
              : "SKIPPED",
        pushNextAttemptAt: again
          ? new Date(Date.now() + 60000 * 2 ** (notification.pushAttempts - 1))
          : null,
        ...(delivered.size ? { deliveredAt: new Date() } : {}),
      },
      $unset: { pushLeaseId: 1, pushLeaseUntil: 1 },
    });
  } catch {
    await Notification.updateOne(filter, {
      $set: {
        pushStatus: notification.pushAttempts < 5 ? "QUEUED" : "FAILED",
        pushNextAttemptAt: new Date(Date.now() + 60000),
      },
      $unset: { pushLeaseId: 1, pushLeaseUntil: 1 },
    });
    logger.warn("Push delivery deferred after an internal error.");
  }
  return true;
}
export function startPushDelivery(io?: Server) {
  let running = false,
    stopped = false;
  let stream: ReturnType<typeof Notification.watch> | undefined;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let resumeAfter: any;
  const connectRealtime = () => {
    if (!io || stopped) return;
    // Mongo change streams publish committed notifications on every API node;
    // the stored inbox remains the source of truth and polling recovers gaps.
    stream = Notification.watch([{ $match: { operationType: "insert" } }], {
      ...(resumeAfter ? { resumeAfter } : {}),
      fullDocument: "updateLookup",
    });
    stream.on("change", (change: any) => {
      resumeAfter = change._id;
      const row = change.fullDocument;
      if (row && !row.archivedAt && !row.readAt)
        io.to(`user:${row.userId}`).emit("notification.created", {
          id: String(row._id),
        });
    });
    stream.on("error", () => {
      void stream?.close().catch(() => undefined);
      resumeAfter = undefined;
      if (!stopped) reconnect = setTimeout(connectRealtime, 30000);
      logger.warn(
        "Live notification stream paused; inbox polling remains available.",
      );
    });
  };
  connectRealtime();
  const tick = async () => {
    if (running || stopped) return;
    running = true;
    try {
      for (let n = 0; n < 10 && !stopped && (await deliverPush()); n++);
    } catch {
      logger.warn("Push queue is temporarily unavailable.");
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 10000);
  timer.unref();
  return () => {
    stopped = true;
    clearInterval(timer);
    if (reconnect) clearTimeout(reconnect);
    void stream?.close().catch(() => undefined);
  };
}
