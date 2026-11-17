// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { user: { _id: "member" }, context: { userId: "member", role: "USER", sessionId: "session" } } } }) }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mock.request, apiDownload: vi.fn() }));
import { PaymentReturnPage } from "./PaymentReturnPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(payment: Record<string, unknown>, failInvitation = false) {
  mock.request.mockImplementation((path: string) => {
    if (path.includes("checkout/payments")) return Promise.resolve({ data: payment });
    if (path.endsWith("whatsapp-updates")) return failInvitation ? Promise.reject(new Error("Temporary")) : Promise.resolve({ data: { gymName: "Gym A", displayName: "Updates", type: "group", inviteUrl: "https://chat.whatsapp.com/AbCd012345" } });
    return Promise.resolve({ data: { publicId: "membership-a", planSnapshot: { name: "Monthly" }, gymId: { name: "Gym A" }, startsAt: "2026-11-01", endsAt: "2026-12-01" } });
  });
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/payment-return?paymentId=payment-a&success=true"]}><PaymentReturnPage /></MemoryRouter></QueryClientProvider>));
  for (let i = 0; i < 5; i++) await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30); }); });
}
it("shows the correct gym, invoice and persistent membership destination after authoritative fulfillment", async () => {
  await render({ purpose: "MEMBERSHIP", status: "CAPTURED", fulfillmentStatus: "APPLIED", membershipPublicId: "membership-a" });
  expect(host.textContent).toContain("Monthly membership at Gym A is confirmed");
  expect(host.textContent).toContain("Join WhatsApp Group"); expect(host.textContent).toContain("Download Invoice");
  expect([...host.querySelectorAll("a")].find(a => a.textContent === "Continue to Membership")?.getAttribute("href")).toBe("/app/profile?section=membership&membership=membership-a");
});
it.each([
  { status: "PENDING" }, { status: "AUTHORIZED" }, { status: "FAILED" },
  { status: "CAPTURED", fulfillmentStatus: "PENDING" },
  { status: "CAPTURED", fulfillmentStatus: "APPLIED", purpose: "PLATFORM_PLAN", membershipPublicId: null },
])("never unlocks invitations from client success flags or ineligible payment %j", async payment => {
  await render(payment); expect(host.textContent).not.toContain("Join WhatsApp Group");
  expect(mock.request.mock.calls.every(([path]) => !path.includes("whatsapp-updates"))).toBe(true);
});
it("keeps confirmed payment and navigation intact when the invitation fails", async () => {
  await render({ status: "CAPTURED", fulfillmentStatus: "APPLIED", membershipPublicId: "membership-a" }, true);
  expect(host.textContent).toContain("Payment confirmed"); expect(host.textContent).toContain("Retry invitation"); expect(host.textContent).toContain("Continue to Membership");
});
