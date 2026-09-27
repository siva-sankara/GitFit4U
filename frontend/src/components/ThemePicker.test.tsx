// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ThemePicker } from "./ThemePicker";
const setThemePreference = vi.hoisted(() => vi.fn());
vi.mock("../context/AppContext", () => ({
  useApp: () => ({ themePreference: "system", setThemePreference }),
}));
it("defaults to System and exposes three accessible icon choices", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ThemePicker />));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "System theme",
      "Light theme",
      "Dark theme",
    ]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    await act(async () => buttons[2].click());
    expect(setThemePreference).toHaveBeenCalledWith("dark");
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
