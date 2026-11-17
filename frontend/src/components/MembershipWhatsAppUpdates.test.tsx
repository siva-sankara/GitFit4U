// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn(), user: "member-a" }));
vi.mock("../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { user: { _id: mock.user }, context: { userId: mock.user, sessionId: mock.user + "-session" } } } }) }));
vi.mock("../services/apiClient", () => ({ apiRequest: mock.request }));
import { MembershipWhatsAppUpdates } from "./MembershipWhatsAppUpdates";
import { validWhatsAppInvite } from "../services/whatsappInvite";
let host: HTMLDivElement, root: Root, client: QueryClient;
const group = { gymName: "Gym A", displayName: "Member updates", type: "group", inviteUrl: "https://chat.whatsapp.com/AbCd012345", version: 1 };
beforeEach(() => {
  vi.clearAllMocks(); mock.user = "member-a";
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.request.mockResolvedValue({ data: group });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(id = "membership-a") {
  await act(async () => root.render(<QueryClientProvider client={client}><MembershipWhatsAppUpdates membershipId={id} /></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 40); }); });
}
it("shows an explicit group action with privacy notice; never claims or posts joined state", async () => {
  await render();
  const link = host.querySelector("a")!;
  expect(link.textContent).toBe("Join WhatsApp Group"); expect(link.href).toBe(group.inviteUrl);
  expect(link.target).toBe("_blank"); expect(link.rel).toBe("noopener noreferrer");
  expect(host.textContent).toContain("phone number is visible");
  expect(mock.request).toHaveBeenCalledTimes(1);
  expect(mock.request).toHaveBeenCalledWith("/api/v1/users/me/subscriptions/membership-a/whatsapp-updates", expect.objectContaining({ signal: expect.any(AbortSignal) }));
});
it("labels channels accurately and omits the group privacy notice", async () => {
  mock.request.mockResolvedValue({ data: { ...group, type: "channel", inviteUrl: "https://whatsapp.com/channel/0029AbCd" } });
  await render(); expect(host.textContent).toContain("Follow WhatsApp Channel"); expect(host.textContent).not.toContain("phone number is visible");
});
it("hides missing and invalid invitations", async () => {
  mock.request.mockResolvedValue({ data: null }); await render(); expect(host.textContent).toBe("");
  mock.request.mockResolvedValue({ data: { ...group, inviteUrl: "https://evil.test" } }); await render("membership-b"); expect(host.querySelector("a")).toBeNull();
});
it("provides an invitation-only retry without blocking membership or offering payment", async () => {
  mock.request.mockRejectedValue(new Error("Unavailable")); await render();
  expect(host.textContent).toContain("Your membership is unchanged");
  mock.request.mockResolvedValue({ data: group });
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 40); }); });
  expect(host.querySelector("a")?.textContent).toBe("Join WhatsApp Group");
});
it("never displays another account's cached invitation while the next account loads", async () => {
  await render(); expect(host.querySelector("a")).not.toBeNull();
  mock.user = "member-b"; mock.request.mockReturnValue(new Promise(() => {}));
  await render(); expect(host.querySelector("a")).toBeNull();
});
it.each(["javascript:alert(1)", "https://chat.whatsapp.com.evil.test/token", "https://user@chat.whatsapp.com/token", "https://chat.whatsapp.com:443/token", "https://chat.whatsapp.com/one/../token"])("client validation rejects %s", url => {
  expect(validWhatsAppInvite(url, "group")).toBe(false);
});
