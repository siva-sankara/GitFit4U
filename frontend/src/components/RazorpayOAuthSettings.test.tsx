// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../services/apiClient", () => ({ apiRequest: mocks.request }));
import { RazorpayOAuthSettings } from "./RazorpayOAuthSettings";

let root: Root;
let host: HTMLDivElement;
let client: QueryClient;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.request.mockReset();
  mocks.request.mockResolvedValue({
    data: {
      provider: "RAZORPAY",
      environment: "TEST",
      onlineMembershipPaymentsAvailable: false,
      blockers: ["Merchant settlement readiness has not yet been verified."],
      connection: {
        authorizationStatus: "CONNECTED",
        onboardingStatus: "PENDING",
        merchantAccountId: "acc_GymMerchant123",
        settlementReadinessStatus: "UNKNOWN",
      },
    },
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});

async function render() {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <RazorpayOAuthSettings gym={{ publicId: "gym-public" }} />
    </QueryClientProvider>,
  ));
  for (let i = 0; i < 50 && !host.textContent?.includes("Reconnect Razorpay"); i++)
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10); }); });
}

it("shows independent OAuth and settlement state without requesting bank credentials", async () => {
  await render();
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/gyms/gym-public/payments/razorpay/status");
  expect(host.textContent).toContain("Reconnect Razorpay");
  expect(host.textContent).toContain("Settlement readiness");
  expect(host.textContent).toContain("GETFIT4U membership commission:");
  expect(host.querySelector('input[name="accountNumber"]')).toBeNull();
  expect(host.querySelector('input[name="keySecret"]')).toBeNull();
});
