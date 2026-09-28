// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
let callbacks: Map<string, Array<EventListenerOrEventListenerObject>>;
let service: typeof import("./pwa");
function fire(type: string, event = new Event(type)) {
  for (const listener of callbacks.get(type) || []) {
    if (typeof listener === "function") listener(event); else listener.handleEvent(event);
  }
  return event;
}
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-28T10:00:00Z"));
  sessionStorage.clear(); localStorage.clear(); callbacks = new Map();
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: {} });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla Android Chrome" });
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }) });
  for (const target of [window, document]) vi.spyOn(target, "addEventListener").mockImplementation(((type: string, listener: EventListenerOrEventListenerObject) => {
    callbacks.set(type, [...(callbacks.get(type) || []), listener]);
  }) as any);
  service = await import("./pwa");
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("starts one 120-second window on eligible display, not lifecycle startup or route remount", () => {
  service.startPwaLifecycle(false); expect(service.getPwaSnapshot().bannerStartedAt).toBeNull();
  service.beginInstallBanner(); const start = service.getPwaSnapshot().bannerStartedAt;
  vi.advanceTimersByTime(60_000); service.beginInstallBanner();
  expect(service.getPwaSnapshot().bannerStartedAt).toBe(start);
  expect(service.getPwaSnapshot().bannerExpired).toBe(false);
  vi.advanceTimersByTime(60_000); expect(service.getPwaSnapshot().bannerExpired).toBe(true);
  service.beginInstallBanner(); expect(service.getPwaSnapshot().bannerStartedAt).toBe(start);
});
it("restores remaining time after refresh instead of restarting", () => {
  const startedAt = Date.now() - 90_000;
  sessionStorage.setItem(service.installSessionKey, JSON.stringify({ startedAt, dismissed: false }));
  service.startPwaLifecycle(false); service.beginInstallBanner();
  expect(service.getPwaSnapshot().bannerStartedAt).toBe(startedAt);
  vi.advanceTimersByTime(30_000); expect(service.getPwaSnapshot().bannerExpired).toBe(true);
});
it("keeps an expired/dismissed session hidden after refresh", () => {
  sessionStorage.setItem(service.installSessionKey, JSON.stringify({ startedAt: Date.now() - 130_000, dismissed: true }));
  service.startPwaLifecycle(false); service.beginInstallBanner();
  expect(service.getPwaSnapshot()).toMatchObject({ bannerExpired: true, dismissed: true });
});
it("dismisses immediately for the session without a 30-day device preference", () => {
  service.startPwaLifecycle(false); service.beginInstallBanner(); service.dismissInstall();
  expect(JSON.parse(sessionStorage.getItem(service.installSessionKey)!)).toMatchObject({ dismissed: true });
  expect(localStorage.length).toBe(0); service.beginInstallBanner(); expect(service.getPwaSnapshot().dismissed).toBe(true);
});
it("does not start in hidden, desktop, installed or insecure contexts", () => {
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
  service.startPwaLifecycle(false); service.beginInstallBanner(); expect(service.getPwaSnapshot().bannerStartedAt).toBeNull();
  Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Windows Chrome" });
  fire("resize"); expect(service.getPwaSnapshot().mobileInstallEligible).toBe(false);
  Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Android" });
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
  fire("resize"); expect(service.getPwaSnapshot().mobileInstallEligible).toBe(false);
  Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
  vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn() } as any);
  fire("resize"); service.beginInstallBanner(); expect(service.getPwaSnapshot().bannerStartedAt).toBeNull();
});
it("only prompts on an explicit action and only appinstalled confirms completion", async () => {
  service.startPwaLifecycle(false); service.beginInstallBanner(); const prompt = vi.fn().mockResolvedValue(undefined);
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt, userChoice: Promise.resolve({ outcome: "accepted" }) });
  fire("beforeinstallprompt", event); expect(event.defaultPrevented).toBe(true); expect(prompt).not.toHaveBeenCalled();
  await service.installApp(); expect(prompt).toHaveBeenCalledOnce(); expect(service.getPwaSnapshot().installed).toBe(false);
  await service.installApp(); expect(prompt).toHaveBeenCalledOnce();
  fire("appinstalled"); expect(service.getPwaSnapshot()).toMatchObject({ installed: true, installAvailable: false, dismissed: true });
});
it("reports install prompt failure without resetting the timer or claiming success", async () => {
  service.startPwaLifecycle(false); service.beginInstallBanner(); const startedAt = service.getPwaSnapshot().bannerStartedAt;
  fire("beforeinstallprompt", Object.assign(new Event("beforeinstallprompt"), { prompt: vi.fn().mockRejectedValue(new Error("unavailable")) }));
  await service.installApp(); expect(service.getPwaSnapshot()).toMatchObject({ installed: false, bannerStartedAt: startedAt });
  expect(service.getPwaSnapshot().error).toContain("installation menu");
});
it("still expires while in background and allows install instructions on iPhone", () => {
  service.startPwaLifecycle(false); service.beginInstallBanner();
  vi.setSystemTime(Date.now() + 180_000); fire("visibilitychange");
  expect(service.getPwaSnapshot().bannerExpired).toBe(true);
  expect(service.installInstructions("iPhone", 1)).toContain("Open as Web App");
});
