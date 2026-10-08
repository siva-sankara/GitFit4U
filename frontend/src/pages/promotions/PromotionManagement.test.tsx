// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("../../services/apiClient", async original => ({ ...await original<typeof import("../../services/apiClient")>(), apiRequest: mocks.api }));
import { PromotionManagement } from "./PromotionManagement";
import { PlatformCheckoutOffers } from "../../components/PlatformCheckoutOffers";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); mocks.api.mockReset(); });
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(element: React.ReactNode) { await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter>{element}</MemoryRouter></QueryClientProvider>)); await settle(); }
async function settle() { await act(async () => { await new Promise(resolve => { setTimeout(resolve, 15); }); }); }
it("previews and saves a platform offer through the dedicated API with server-owned fields omitted", async () => {
  mocks.api.mockImplementation(async (url: string, options?: { method?: string }) => ({ success: true, data: options?.method ? { publicId: "created" } : url.includes("platform-plans") ? [{ _id: "111111111111111111111111", name: "Configured plan" }] : [], meta: { pages: 1 } }));
  await render(<PromotionManagement kind="platform-offers" admin />);
  expect([...host.querySelectorAll('.promotion-tabs a')].map(a => a.textContent)).toEqual(["Gym Offers", "Gym Advertisements", "Platform Offers"]);
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Create offer")!.click()); await settle();
  const form = document.querySelector<HTMLFormElement>(".promotion-form")!;
  for (const [name, value] of Object.entries({ name: "Platform discount", startsAt: "2099-01-01T00:00", endsAt: "2099-02-01T00:00", discount: "10", code: "SAVEPLATFORM" })) (form.elements.namedItem(name) as HTMLInputElement).value = value;
  (form.querySelector('input[name="planIds"]') as HTMLInputElement).checked = true;
  await act(async () => (form.querySelector('[value="preview"]') as HTMLButtonElement).click());
  expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
  expect(mocks.api.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[aria-label="Close dialog"]')].at(-1)!.click());
  await act(async () => [...form.querySelectorAll("button")].find(button => button.textContent === "Save promotion")!.click()); await settle();
  const saved = mocks.api.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(saved[0]).toBe("/api/v1/admin/promotions/platform-offers");
  const body = JSON.parse(saved[1].body);
  expect(body).toMatchObject({ name: "Platform discount", discount: { kind: "FIXED", amountMinor: 1000 }, platformPlanIds: ["111111111111111111111111"], purchaseKinds: ["NEW", "RENEWAL"], billingPeriods: ["MONTHLY", "YEARLY"] });
  for (const key of ["scope", "createdBy", "gymId", "redemptionCount", "application", "applicablePlanIds"]) expect(body).not.toHaveProperty(key);
});
it("shows eligible checkout offers for the selected registration and applies the exact returned code", async () => {
  mocks.api.mockResolvedValue({ success: true, data: [{ publicId: "offer", name: "Selected owner offer", code: "MixedCasePublicCode", discount: { kind: "PERCENT", percentageBasisPoints: 1000 }, endsAt: "2099-01-01", terms: "First purchase only" }], meta: { hasMore: false } });
  const apply = vi.fn();
  await render(<PlatformCheckoutOffers purchase={{ planId: "plan", registrationId: "registration" }} disabled={false} onApply={apply} />);
  expect(mocks.api.mock.calls[0][0]).toContain("registrationId=registration"); expect(mocks.api.mock.calls[0][0]).toContain("planId=plan");
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent?.startsWith("Apply "))!.click());
  expect(apply).toHaveBeenCalledWith("MixedCasePublicCode"); expect(host.textContent).toContain("Future renewals use the configured plan price");
});
