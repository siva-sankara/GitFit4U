// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  createNotificationTracker,
  notificationSoundEnabled,
  setNotificationSoundEnabled,
  playNotificationSound,
  type InboxNotification,
} from "./notificationAlerts";

const row = (
  id: string,
  createdAt: string,
  readAt?: string,
): InboxNotification => ({
  _id: id,
  title: `Update ${id}`,
  message: "Membership update",
  category: "MEMBERSHIP",
  createdAt,
  readAt,
});
const old = row("old", "2026-09-09T00:00:00Z");
const fresh = row("new", "2026-09-09T00:01:00Z");
beforeEach(() => {
  localStorage.clear();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it("does not alert for existing inbox records or repeat refetches", () => {
  const alert = vi.fn();
  const tracker = createNotificationTracker(alert);
  tracker.observe([old]);
  tracker.observe([old]);
  expect(alert).not.toHaveBeenCalled();
  tracker.observe([fresh, old]);
  tracker.observe([fresh, old]);
  expect(alert).toHaveBeenCalledOnce();
  expect(alert).toHaveBeenCalledWith({
    id: "new",
    title: "Update new",
    message: "Membership update",
  });
});
it("deduplicates Firebase callbacks and inbox polling using database notification IDs", () => {
  const alert = vi.fn();
  const tracker = createNotificationTracker(alert);
  tracker.observe([old]);
  tracker.receive({ id: "new", title: "Update new" });
  tracker.receive({ id: "new", title: "Update new" });
  tracker.observe([fresh, old]);
  expect(alert).toHaveBeenCalledOnce();
});
it("does not replay old notifications entering the first page or already-read updates", () => {
  const alert = vi.fn();
  const tracker = createNotificationTracker(alert);
  tracker.observe([old]);
  tracker.observe([
    row("read", "2026-09-09T00:02:00Z", "2026-09-09T00:02:00Z"),
    old,
    row("older", "2026-09-08T00:00:00Z"),
  ]);
  expect(alert).not.toHaveBeenCalled();
});
it("delivers distinct notifications with the same creation timestamp", () => {
  const alert = vi.fn();
  const tracker = createNotificationTracker(alert);
  tracker.observe([old]);
  tracker.observe([row("same-time", old.createdAt), old]);
  expect(alert).toHaveBeenCalledOnce();
});
it("plays the local MP3 and respects the saved mute preference", async () => {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  expect(notificationSoundEnabled()).toBe(false);
  expect(await playNotificationSound()).toBe(false);
  setNotificationSoundEnabled(true);
  expect(await playNotificationSound()).toBe(true);
  expect((play.mock.instances[0] as HTMLAudioElement).src).toContain(
    "/sounds/notification.mp3",
  );
  setNotificationSoundEnabled(false);
  expect(notificationSoundEnabled()).toBe(false);
  expect(await playNotificationSound()).toBe(false);
  expect(play).toHaveBeenCalledOnce();
  expect(await playNotificationSound(true)).toBe(true);
});
it("handles autoplay rejection without failing delivery or creating an unhandled promise", async () => {
  setNotificationSoundEnabled(true);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(
    new DOMException("Blocked", "NotAllowedError"),
  );
  expect(await playNotificationSound()).toBe(false);
});
it("never sounds for a read notification arriving through a delayed push channel", () => {
  const alert = vi.fn();
  const tracker = createNotificationTracker(alert);
  tracker.receive({ id: "read", title: "Already read", readAt: new Date().toISOString() });
  tracker.receive({ id: "read", title: "Late duplicate" });
  expect(alert).not.toHaveBeenCalled();
});
