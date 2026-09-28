// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RoutineIllustration } from "./RoutineIllustration";
it("leaves a labelled static illustration available and pauses motion outside the viewport", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let visibility: (entries: Array<{ isIntersecting: boolean }>) => void;
  const disconnect = vi.fn();
  vi.stubGlobal("IntersectionObserver", class { constructor(callback: typeof visibility) { visibility = callback; } observe() {} disconnect = disconnect; });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<RoutineIllustration />));
    expect(host.querySelector('svg[role="img"]')?.getAttribute("aria-label")).toContain("workout calendar");
    expect(host.querySelector(".is-visible")).toBeNull();
    await act(async () => visibility([{ isIntersecting: true }])); expect(host.querySelector(".is-visible")).not.toBeNull();
    await act(async () => visibility([{ isIntersecting: false }])); expect(host.querySelector(".is-visible")).toBeNull();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); }
  expect(disconnect).toHaveBeenCalledOnce();
});
