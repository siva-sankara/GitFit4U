// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { context: { role: "GYM_OWNER", userId: "owner", gymId: "gym", sessionId: "session" } } } }) }));
vi.mock("../services/apiClient", () => ({ apiRequest: mock.request }));
import { WhatsAppUpdatesSettings } from "./WhatsAppUpdatesSettings";
let root: Root, host: HTMLDivElement, client: QueryClient;
const initial = { enabled: true, type: "channel", displayName: "Gym updates", inviteUrl: "https://www.whatsapp.com/channel/AbCd", description: "News", version: 1, updatedBy: "owner" };
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient(); host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  mock.request.mockImplementation((_path, options) => Promise.resolve({ data: options?.method === "PATCH" ? JSON.parse(options.body) : initial }));
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(disabled = false) {
  await act(async () => root.render(<QueryClientProvider client={client}><WhatsAppUpdatesSettings disabled={disabled} /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 40); }); });
}
it("shows the saved type and a safe, explicit manual link check", async () => {
  await render(); expect(host.querySelector("select")?.value).toBe("channel");
  expect(host.querySelector("a")?.href).toBe("https://whatsapp.com/channel/AbCd"); expect(host.querySelector("a")?.rel).toBe("noopener noreferrer");
});
it.each(["Disable", "Remove"])("%s only sends editable invitation fields, keeping server audit fields authoritative", async label => {
  await render(); await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === label)!.click());
  const sent = mock.request.mock.calls.find(([, options]) => options?.method === "PATCH");
  expect(sent?.[0]).toBe("/api/v1/owner/communication/whatsapp-updates");
  const body = JSON.parse(sent![1].body); expect(body.enabled).toBe(false); expect(body.updatedBy).toBeUndefined(); expect(body.version).toBeUndefined();
  if (label === "Remove") expect(body.inviteUrl).toBe("");
});
it("respects the profile edit permission", async () => { await render(true); expect(host.querySelector("fieldset")?.disabled).toBe(true); });
