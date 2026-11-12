import { Gym } from "../models/Gym.js";

interface NotificationLink {
  _id?: unknown;
  event?: string | null;
  gymId?: unknown;
  actionUrl?: string | null;
  metadata?: Record<string, any> | null;
}
function legacyPlatformReminder(notification: NotificationLink) {
  return notification.actionUrl === "/owner/platform-subscription" &&
    (notification.event === "platform.expiring" || notification.metadata?.reminderCycle === true);
}
/** Upgrade legacy destinations on read without mutating immutable event/dedupe data.
 * Call only after the notification query has enforced recipient ownership.
 */
async function legacyLinks<T extends NotificationLink>(notifications: readonly T[]): Promise<T[]> {
  const legacy = notifications.filter(legacyPlatformReminder);
  if (!legacy.length) return [...notifications];
  const ids = [...new Set(legacy.map((notification) => String(notification.gymId || "")))]
    .filter((id) => /^[a-f\d]{24}$/i.test(id));
  const gyms = ids.length ? await Gym.find({ _id: { $in: ids }, deletedAt: null }).select("_id publicId").lean() : [];
  const publicIds = new Map(gyms.map((gym) => [String(gym._id), gym.publicId]));
  return notifications.map((notification) => {
    if (!legacyPlatformReminder(notification)) return notification;
    const publicId = publicIds.get(String(notification.gymId));
    return { ...notification, actionUrl: publicId
      ? `/platform-renewal?gym=${encodeURIComponent(publicId)}`
      : "/notifications" };
  });
}

export async function withNotificationLinks<T extends NotificationLink>(notifications: readonly T[]): Promise<T[]> {
  const linked = await legacyLinks(notifications);
  return linked.map(row => row._id ? { ...row, actionUrl: `/notification-open/${String(row._id)}` } : row);
}
