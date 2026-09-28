// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
vi.mock("../services/apiClient", () => ({
  getAccessToken: () => null,
  apiRequest: vi.fn(),
}));
vi.mock("../services/session", () => ({
  useSession: () => ({ data: undefined }),
}));
import { AppProvider, useApp } from "./AppContext";
function Appearance() {
  const app = useApp();
  return (
    <>
      <output>
        {app.themePreference}:{app.theme}
      </output>
      <button onClick={() => app.setThemePreference("light")}>Light</button>
      <button onClick={() => app.setThemePreference("dark")}>Dark</button>
    </>
  );
}
it("migrates System to Dark, preserves explicit modes and never subscribes to the OS theme", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  localStorage.clear();
  localStorage.setItem("gfu_theme_preference", "system");
  const listeners = new Set<() => void>();
  const media = {
    matches: false,
    addEventListener: (_name: string, listener: () => void) =>
      listeners.add(listener),
    removeEventListener: (_name: string, listener: () => void) =>
      listeners.delete(listener),
  };
  const original = window.matchMedia;
  window.matchMedia = vi.fn(() => media as unknown as MediaQueryList);
  const host = document.createElement("div"),
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <AppProvider>
            <Appearance />
          </AppProvider>
        </QueryClientProvider>,
      ),
    );
    expect(host.textContent).toContain("dark:dark");
    await act(async () => {
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement.dataset.theme).toBe("dark");
    await act(async () => host.querySelector("button")!.click());
    expect(host.textContent).toContain("light:light");
    expect(localStorage.getItem("gfu_theme_preference")).toBe("light");
    await act(async () => {
      media.matches = false;
      listeners.forEach((listener) => listener());
      media.matches = true;
      listeners.forEach((listener) => listener());
    });
    expect(document.documentElement.dataset.theme).toBe("light");
    await act(async () => host.querySelectorAll("button")[1].click());
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem("gfu_theme_preference")).toBe("dark");
    expect(window.matchMedia).not.toHaveBeenCalled();
    // Logging out and reopening the application do not reset device appearance.
    await act(async () => window.dispatchEvent(new CustomEvent("gfu-auth", {
      detail: { token: null, changedSession: true },
    })));
    expect(document.documentElement.dataset.theme).toBe("dark");
    await act(async () => root.unmount());
    root = createRoot(host);
    await act(async () => root.render(
      <QueryClientProvider client={client}>
        <AppProvider><Appearance /></AppProvider>
      </QueryClientProvider>,
    ));
    expect(host.textContent).toContain("dark:dark");
    expect(localStorage.getItem("gfu_theme_preference")).toBe("dark");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    window.matchMedia = original;
    localStorage.clear();
  }
  expect(listeners.size).toBe(0);
});
