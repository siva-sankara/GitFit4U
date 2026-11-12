// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ state: {} as any, install: vi.fn(), begin: vi.fn() }));
vi.mock("../services/pwa", () => ({ usePwa: () => mocks.state, installApp: mocks.install, beginInstallBanner: mocks.begin, dismissInstall: vi.fn(), installInstructions: () => "Use Add to Home Screen in Safari", applyAppUpdate: vi.fn() }));
import { AppInstallBanner } from "./AppInstallBanner";
import { PwaSettings } from "./PwaSettings";
let host: HTMLDivElement, root: Root;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); mocks.install.mockReset(); mocks.state = { mobileInstallEligible: true, bannerStartedAt: 1, installAvailable: false, installState: "manual" }; host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("labels guidance honestly and switches to a real prompt action when available", async () => {
  await act(async () => root.render(<AppInstallBanner />));
  expect(host.querySelector(".install-banner-action")!.textContent).toBe("How to install");
  await act(async () => (host.querySelector(".install-banner-action") as HTMLElement).click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Add to Home Screen");
  expect(mocks.install).not.toHaveBeenCalled();
  await act(async () => (document.querySelector('[aria-label="Close dialog"]') as HTMLElement).click());
  mocks.state = { ...mocks.state, installAvailable: true, installState: "ready" };
  await act(async () => root.render(<AppInstallBanner />));
  expect(host.querySelector(".install-banner-action")!.textContent).toBe("Install");
  await act(async () => (host.querySelector(".install-banner-action") as HTMLElement).click());
  expect(mocks.install).toHaveBeenCalledOnce(); expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("keeps Settings installation available after banner expiry, but hides it when installed", async () => {
  mocks.state = { ...mocks.state, bannerExpired: true, installAvailable: true, installState: "ready" };
  await act(async () => root.render(<><AppInstallBanner /><PwaSettings /></>));
  expect(host.querySelector(".app-install-banner")).toBeNull();
  const button = host.querySelector<HTMLButtonElement>(".pwa-settings button")!;
  await act(async () => button.click()); expect(mocks.install).toHaveBeenCalledOnce();
  mocks.state = { ...mocks.state, installed: true, installAvailable: false, installState: "installed" };
  await act(async () => root.render(<><AppInstallBanner /><PwaSettings /></>));
  expect(host.querySelector(".pwa-settings button")).toBeNull(); expect(host.textContent).toContain("installed on this device");
});
