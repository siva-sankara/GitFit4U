// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), me: vi.fn(), refetch: vi.fn(), setToken: vi.fn(), checkout: vi.fn() }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: mocks.me }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request, setAccessToken: mocks.setToken }));
vi.mock("../../components/Modal", () => ({ Modal: ({ open, title, children }: any) => open ? <section role="dialog" aria-label={title}>{children}</section> : null }));
vi.mock("../live/LivePublic", () => ({ PaymentCheckout: (props: any) => { mocks.checkout(props); return <p>Verified checkout</p>; } }));
import { PlatformSubscriptionPage } from "./PlatformSubscriptionPage";
const gymA = { _id: "gym-a-id", publicId: "gym-a", name: "Target Gym A", status: "ACTIVE" };
const gymB = { _id: "gym-b-id", publicId: "gym-b", name: "Current Gym B", status: "ACTIVE" };
let session: any, host: HTMLDivElement, root: Root, client: QueryClient;
async function flush() { await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); }); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.clearAllMocks();
  session = { user: { _id: "owner" }, context: { role: "GYM_OWNER", gymId: gymB._id }, assignments: [{ role: "GYM_OWNER", gymId: gymA }, { role: "GYM_OWNER", gymId: gymB }] };
  mocks.me.mockImplementation(() => ({ data: { data: session }, refetch: mocks.refetch, isPending: false, isError: false }));
  mocks.refetch.mockImplementation(async () => ({ data: { data: session } }));
  mocks.request.mockImplementation(async (path: string, options?: { body?: string }) => {
    if (path === "/api/v1/auth/switch-role") { session = { ...session, context: JSON.parse(options!.body!) }; return { data: { accessToken: "new-owner-token" } }; }
    if (path === "/api/v1/owner/dashboard") return { data: { platformSubscription: { plan: { name: "Current platform plan" }, status: "ACTIVE", canRenew: true, usage: { members: 4, memberLimit: 20 } } } };
    if (path === "/api/v1/workspace/platform-plans") return { data: [{ _id: "plan", name: "Renewal Plan", priceMinor: 20000, memberLimit: 20, billingPeriod: "MONTHLY" }] };
    throw new Error("Unexpected request " + path);
  });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(path = "/platform-renewal?gym=gym-a") {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><PlatformSubscriptionPage /></MemoryRouter></QueryClientProvider>));
  await flush();
}
it.each(["GYM_OWNER", "USER", "TRAINER"])("requires explicit confirmation before switching a %s session and binds the quote to the reminder gym", async (role) => {
  session.context.role = role;
  await render();
  expect(host.textContent).toContain("Confirm renewal gym");
  expect(host.textContent).toContain("Target Gym A");
  expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await flush();
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/switch-role", expect.objectContaining({ body: JSON.stringify({ role: "GYM_OWNER", gymId: gymA._id }) }));
  expect(mocks.setToken).toHaveBeenCalledWith("new-owner-token");
  expect(host.textContent).toContain("Target Gym A");
  expect(host.textContent).not.toContain("Current Gym B");
  await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Review renewal")!.click());
  expect(mocks.checkout).toHaveBeenCalledWith(expect.objectContaining({ quoteBody: { renewal: true, planId: "plan", expectedGymId: gymA._id } }));
});
it("does not load or switch an unassigned reminder gym", async () => {
  await render("/platform-renewal?gym=someone-elses-gym");
  expect(host.textContent).toContain("not match a gym you are authorized");
  expect(mocks.request).not.toHaveBeenCalled();
  expect(mocks.checkout).not.toHaveBeenCalled();
});
it("confirms even a reminder for the current gym, without unnecessary role mutation", async () => {
  session.context.gymId = gymA._id;
  await render();
  expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await flush();
  expect(mocks.request.mock.calls.some(([path]) => path.includes("switch-role"))).toBe(false);
  expect(host.textContent).toContain("Current platform plan");
});
it("does not show a checkout after the server denies switching into the target gym", async () => {
  mocks.request.mockRejectedValue(new Error("Gym access was revoked"));
  await render();
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Gym access was revoked");
  expect(mocks.checkout).not.toHaveBeenCalled();
});
