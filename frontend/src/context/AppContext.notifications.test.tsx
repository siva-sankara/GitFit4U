// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ receive: undefined as undefined | ((alert: { title: string; actionUrl?: string }) => void) }));
vi.mock("../services/apiClient", () => ({ getAccessToken: () => "authenticated", apiRequest: vi.fn(async () => ({ data: [] })) }));
vi.mock("../services/session", () => ({
  useSession: () => ({ data: { data: { user: { _id: "user", notificationPreferences: { sound: false } } } } }),
  useSessionLifecycle: vi.fn(),
}));
vi.mock("../services/notificationAlerts", () => ({
  createNotificationTracker: (receive: typeof mocks.receive) => { mocks.receive = receive; return { receive, observe: vi.fn() }; },
  playNotificationSound: vi.fn(), setNotificationSoundEnabled: vi.fn(),
}));
vi.mock("../services/firebasePush", () => ({ listenForPush: async () => () => {}, syncPushToken: vi.fn() }));
vi.mock("socket.io-client", () => ({ io: () => ({ on: vi.fn(), disconnect: vi.fn(), connect: vi.fn() }) }));
import { AppProvider, useApp } from "./AppContext";
let state: ReturnType<typeof useApp>;
function Probe() { state = useApp(); return <span>{state.toast}</span>; }
afterEach(() => { vi.restoreAllMocks(); mocks.receive = undefined; });
it("preserves only safe action URLs and clears stale actions on ordinary notices and logout", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><AppProvider><Probe /></AppProvider></QueryClientProvider>));
    await act(async () => mocks.receive!({ title: "New message", actionUrl: "/messages/exact_thread" }));
    expect(state.toast).toBe("New message");
    expect(state.toastActionUrl).toBe("/messages/exact_thread");
    await act(async () => state.notify("Preferences saved"));
    expect(state.toastActionUrl).toBeUndefined();
    await act(async () => mocks.receive!({ title: "Unsafe destination", actionUrl: "https://untrusted.example/redirect" }));
    expect(state.toastActionUrl).toBeUndefined();
    await act(async () => mocks.receive!({ title: "Renew gym", actionUrl: "/platform-renewal?gym=owned-gym" }));
    expect(state.toastActionUrl).toBe("/platform-renewal?gym=owned-gym");
    await act(async () => window.dispatchEvent(new CustomEvent("gfu-auth", { detail: { token: null, changedSession: true } })));
    expect(state.toast).toBeNull();
    expect(state.toastActionUrl).toBeUndefined();
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});
