export interface NotificationAlert {
  id?: string;
  title: string;
  message?: string;
  actionUrl?: string;
  readAt?: string | null;
}

export interface InboxNotification {
  _id: string;
  category: string;
  title: string;
  message: string;
  createdAt: string;
  readAt?: string | null;
  actionUrl?: string;
  actionLabel?: string;
  source?: string;
  entityType?: string;
  entityId?: string;
  channels?: string[];
  pushStatus?: string;
  metadata?: {
    gymName?: string;
    planName?: string;
    expiresAt?: string;
    timeZone?: string;
    daysRemaining?: number;
    benefits?: string[];
    availablePlans?: Array<{
      publicId: string;
      name: string;
      durationDays: number;
      priceMinor: number;
      benefits?: string[];
    }>;
  };
}

const soundPreference = "gfu_notification_sound";
let sound: HTMLAudioElement | undefined;
let lastSoundAt = 0;

export function notificationSoundEnabled() {
  try {
    return localStorage.getItem(soundPreference) === "true";
  } catch {
    return false;
  }
}

export function setNotificationSoundEnabled(enabled: boolean) {
  try {
    localStorage.setItem(soundPreference, String(enabled));
  } catch {
    // Browser storage may be disabled; the inbox still works.
  }
  window.dispatchEvent(new Event("gfu-notification-sound"));
}

export async function playNotificationSound(preview = false): Promise<boolean> {
  if (!preview && !notificationSoundEnabled()) return false;
  if (!preview && Date.now() - lastSoundAt < 1200) return false;
  try {
    sound ??= new Audio("/sounds/notification.mp3");
    sound.volume = 0.5;
    sound.currentTime = 0;
    await sound.play();
    lastSoundAt = Date.now();
    return true;
  } catch {
    // Autoplay restrictions or unavailable audio must never break delivery.
    return false;
  }
}

/** Shares a bounded ID cache between FCM delivery and inbox polling. */
export function createNotificationTracker(
  onAlert: (alert: NotificationAlert) => void,
) {
  const seen = new Set<string>();
  let initialized = false;
  let newest = 0;
  const remember = (id: string) => {
    seen.add(id);
    if (seen.size > 300) seen.delete(seen.values().next().value!);
  };
  const receive = (alert: NotificationAlert) => {
    if (alert.readAt) {
      if (alert.id) remember(alert.id);
      return;
    }
    if (alert.id && seen.has(alert.id)) return;
    if (alert.id) remember(alert.id);
    onAlert(alert);
  };
  return {
    receive,
    observe(rows: readonly InboxNotification[]) {
      for (const row of [...rows].reverse()) {
        const createdAt = Date.parse(row.createdAt);
        // An initial load or an old unread page is not a new alert.
        if (initialized && createdAt >= newest && !row.readAt) {
          receive({
            id: row._id,
            title: row.title,
            message: row.message,
            ...(row.actionUrl ? { actionUrl: row.actionUrl } : {}),
          });
        } else remember(row._id);
      }
      newest = Math.max(
        newest,
        ...rows.map((row) => Date.parse(row.createdAt)).filter(Number.isFinite),
      );
      initialized = true;
    },
  };
}
