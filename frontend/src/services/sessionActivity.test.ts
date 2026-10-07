// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), persisted: vi.fn(), pendingLogout: vi.fn(), flushLogout: vi.fn() }));
vi.mock("./apiClient", () => ({
  refreshSession: mocks.refresh,
  hasPersistedSession: mocks.persisted,
  hasPendingLogout: mocks.pendingLogout,
  flushPendingLogout: mocks.flushLogout,
}));
import { trackSessionActivity } from "./sessionActivity";

let stop: (() => void) | undefined;
const reconcile = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-07T10:00:00Z"));
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  mocks.persisted.mockReturnValue(true);
  mocks.pendingLogout.mockReturnValue(false);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.flushLogout.mockResolvedValue(undefined);
  reconcile.mockResolvedValue(undefined);
});
afterEach(() => { stop?.(); stop = undefined; vi.useRealTimers(); });

it("recovers and renews the cookie session on a visit, even when a new tab has no access token", async () => {
  stop = trackSessionActivity(reconcile);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.refresh).toHaveBeenCalledExactlyOnceWith({ activity: true });
  expect(reconcile).toHaveBeenCalledOnce();
});

it("does not keep an unused tab logged in with periodic refreshes", async () => {
  stop = trackSessionActivity(reconcile);
  await vi.advanceTimersByTimeAsync(4 * 86_400_000);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("renews again on returning two days later", async () => {
  stop = trackSessionActivity(reconcile);
  await vi.advanceTimersByTimeAsync(2 * 86_400_000);
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  expect(mocks.refresh).toHaveBeenLastCalledWith({ activity: true });
  expect(reconcile).toHaveBeenCalledTimes(2);
});

it("coalesces pointer, keyboard, touch and scroll activity and records the final interaction", async () => {
  stop = trackSessionActivity(reconcile);
  await vi.advanceTimersByTimeAsync(20_000);
  for (const name of ["pointerdown", "keydown", "touchstart", "scroll"])
    window.dispatchEvent(new Event(name));
  await vi.advanceTimersByTimeAsync(39_999);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(3 * 86_400_000);
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
});

it("never extends a hidden tab and resumes when it becomes visible", async () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  stop = trackSessionActivity(reconcile);
  window.dispatchEvent(new Event("online"));
  window.dispatchEvent(new Event("scroll"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.refresh).not.toHaveBeenCalled();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.refresh).toHaveBeenCalledTimes(1);
});

it("does not probe anonymous visitors or resurrect an explicit offline logout", async () => {
  mocks.persisted.mockReturnValue(false);
  stop = trackSessionActivity(reconcile);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.pendingLogout.mockReturnValue(true);
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.flushLogout).toHaveBeenCalledOnce();
  expect(mocks.refresh).not.toHaveBeenCalled();
});

it("retries recovery on a subsequent visible return after a temporary network error", async () => {
  mocks.refresh.mockRejectedValueOnce(new Error("offline"));
  stop = trackSessionActivity(reconcile);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(reconcile).not.toHaveBeenCalled();
  window.dispatchEvent(new Event("online"));
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.refresh).toHaveBeenCalledTimes(2);
  expect(reconcile).toHaveBeenCalledOnce();
});

it("cleans up listeners and queued activity when the application unmounts", async () => {
  stop = trackSessionActivity(reconcile);
  stop();
  window.dispatchEvent(new Event("focus"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.refresh).not.toHaveBeenCalled();
});
