// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import { dismissInstall, installApp, installInstructions, installSessionKey, isInstalled, startPwaLifecycle } from "./pwa";
beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  Object.defineProperty(window, "matchMedia", { configurable: true, writable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn() }) });
});
it("provides appropriate installation instructions for iPhone, iPad desktop mode, Android and desktop", () => {
  expect(installInstructions("iPhone", 1)).toContain("In Safari");
  expect(installInstructions("Macintosh", 5)).toContain("In Safari");
  expect(installInstructions("Android", 1)).toContain("browser menu");
  expect(installInstructions("Windows", 0)).toContain("Chrome or Edge");
});
it("captures a browser install prompt without automatically prompting and respects dismissal", async () => {
  startPwaLifecycle(false);
  const prompt = vi.fn().mockResolvedValue(undefined);
  const event = new Event("beforeinstallprompt", { cancelable: true });
  Object.assign(event, { prompt, userChoice: Promise.resolve({ outcome: "dismissed" }) });
  window.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(prompt).not.toHaveBeenCalled();
  await installApp();
  expect(prompt).toHaveBeenCalledOnce();
  expect(JSON.parse(sessionStorage.getItem(installSessionKey)!)).toMatchObject({ dismissed: true });
  await installApp();
  expect(prompt).toHaveBeenCalledOnce();
  expect(localStorage.getItem("gfu_install_dismissed_until")).toBeNull();
});
it("can dismiss instructions and detects standalone installation without claiming native publication", () => {
  dismissInstall();
  expect(JSON.parse(sessionStorage.getItem(installSessionKey)!)).toMatchObject({ dismissed: true });
  const media = vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
  expect(isInstalled()).toBe(true);
  media.mockRestore();
});
