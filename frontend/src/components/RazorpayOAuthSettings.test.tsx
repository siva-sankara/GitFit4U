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
      oauthFlowVersion: 2,
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

it("blocks rapid double clicks and creates a new request key after an initiation failure", async () => {
  await render();
  let rejectStart: (error: Error) => void = () => undefined;
  mocks.request.mockImplementation((path: string) => path.endsWith("/connect")
    ? new Promise((_resolve, reject) => { rejectStart = reject; }) : Promise.resolve({ data: { oauthFlowVersion: 2 } }));
  const button = [...host.querySelectorAll("button")].find(value => value.textContent === "Reconnect Razorpay")!;
  await act(async () => { button.click(); button.click(); });
  let calls = mocks.request.mock.calls.filter(([path]) => path.endsWith("/connect"));
  expect(calls).toHaveLength(1);
  expect(calls[0][1].method).toBe("POST");
  expect(JSON.parse(calls[0][1].body)).toEqual({ browserApiOrigin: window.location.origin });
  const firstKey = calls[0][1].idempotencyKey;
  expect(firstKey).toBeTruthy();
  expect(button.disabled).toBe(true);
  await act(async () => { rejectStart(new Error("Please retry")); });
  for (let i = 0; i < 30 && button.disabled; i++) await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10); }); });
  expect(host.textContent).toContain("Please retry");
  await act(async () => button.click());
  calls = mocks.request.mock.calls.filter(([path]) => path.endsWith("/connect"));
  expect(calls).toHaveLength(2);
  expect(calls[1][1].idempotencyKey).not.toBe(firstKey);
  expect(mocks.request.mock.calls.some(([path]) => path.includes("/oauth/callback"))).toBe(false);
});

it("does not start OAuth against the old deployed backend", async () => {
  await render();
  mocks.request.mockResolvedValue({ data: { connection: { authorizationStatus: "CONNECTED" } } });
  const button = [...host.querySelectorAll("button")].find(value => value.textContent === "Reconnect Razorpay")!;
  await act(async () => button.click());
  for (let i = 0; i < 40 && !host.textContent?.includes("not available on this backend"); i++)
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10); }); });
  expect(host.textContent).toContain("Deploy the updated backend");
  expect(mocks.request.mock.calls.filter(([path]) => path.endsWith("/connect"))).toHaveLength(0);
  expect(button.disabled).toBe(false);
});

it("does not open Razorpay when initiation reaches an older server instance", async () => {
  await render();
  mocks.request.mockImplementation((path: string) => Promise.resolve({ data: path.endsWith("/status")
    ? { oauthFlowVersion: 2 } : { authorizationUrl: "https://auth.razorpay.com/authorize?state=fixture" } }));
  const button = [...host.querySelectorAll("button")].find(value => value.textContent === "Reconnect Razorpay")!;
  await act(async () => button.click());
  for (let i = 0; i < 40 && !host.textContent?.includes("backend changed"); i++)
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10); }); });
  expect(host.textContent).toContain("Finish deploying the payment update");
  expect(button.disabled).toBe(false);
});
