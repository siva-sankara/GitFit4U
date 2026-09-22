export interface NotificationAlert {
  id?: string;
  title: string;
  message?: string;
}

export interface InboxNotification {
  _id: string;
  category: string;
  title: string;
  message: string;
  createdAt: string;
  readAt?: string | null;
  actionUrl?: string;
}

const soundPreference = "gfu_notification_sound";
let sound: HTMLAudioElement | undefined;

export function notificationSoundEnabled() {
  try {
    return localStorage.getItem(soundPreference) !== "false";
  } catch {
    return true;
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
  try {
    sound ??= new Audio("/sounds/notification.mp3");
    sound.volume = 0.5;
    sound.currentTime = 0;
    await sound.play();
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
          receive({ id: row._id, title: row.title, message: row.message });
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
