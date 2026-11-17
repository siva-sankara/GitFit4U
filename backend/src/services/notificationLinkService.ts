import { Gym } from "../models/Gym.js";

interface NotificationLink {
  _id?: unknown;
  event?: string | null;
  entityType?: string | null;
  dedupeKey?: string | null;
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
  // Enrich the existing, transactionally committed purchase notification on read.
  // Invitation lookup never participates in payment/invoice fulfillment, and no
  // extra event or WhatsApp API delivery is created by this link-only feature.
  const purchases = linked.filter(row => ["membership.activated", "membership.renewed"].includes(row.event || "") && row.metadata?.membershipPurchaseConfirmed === true);
  let gyms: any[] = [];
  if (purchases.length) {
    try {
      gyms = await Gym.find({ _id: { $in: [...new Set(purchases.map(row => row.gymId).filter(Boolean))] }, deletedAt: null })
        .select("name +whatsappUpdates").lean();
    } catch { /* Keep the original confirmed-purchase notification available. */ }
  }
  return linked.map(row => {
    if (!row._id) return row;
    const gym = purchases.includes(row) && gyms.find(gym => String(gym._id) === String(row.gymId));
    const announcement = (["gym.announcement", "admin.announcement"].includes(row.event || "") || row.entityType === "CAMPAIGN" || row.dedupeKey?.startsWith("campaign:")) && (!row.actionUrl || row.actionUrl === "/notifications");
    return { ...row, ...(gym?.whatsappUpdates?.enabled ? {
      message: `Your membership at ${gym.name} is confirmed. Open your membership to join the gym’s WhatsApp updates.`,
      actionLabel: "Open membership",
    } : {}), actionUrl: announcement ? undefined : `/notification-open/${String(row._id)}` };
  });
}
