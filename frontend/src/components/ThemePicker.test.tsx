// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { ThemePicker } from "./ThemePicker";
const state = vi.hoisted(() => ({ themePreference: "light", setThemePreference: vi.fn() }));
vi.mock("../context/AppContext", () => ({
  useApp: () => state,
}));
beforeEach(() => { state.themePreference = "light"; state.setThemePreference.mockClear(); });
it.each([
  ["light", "dark", "lucide-moon"],
  ["dark", "light", "lucide-sun"],
])("renders one action labelled toggle in %s mode", async (current, next, icon) => {
  state.themePreference = current;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  try {
    await act(async () => root.render(<ThemePicker />));
    const buttons = [...host.querySelectorAll("button")];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].type).toBe("button");
    expect(buttons[0].getAttribute("aria-label")).toBe(`Switch to ${next} mode`);
    expect(buttons[0].title).toBe(`Switch to ${next} mode`);
    expect(buttons[0].querySelector(`.${icon}`)?.getAttribute("aria-hidden")).toBe("true");
    buttons[0].focus();
    expect(document.activeElement).toBe(buttons[0]);
    await act(async () => buttons[0].click());
    expect(state.setThemePreference).toHaveBeenCalledWith(next);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
