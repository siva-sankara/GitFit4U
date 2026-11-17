// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
import { RazorpayConnectionResult } from "./RazorpayConnectionResult";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.request.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(status = "FAILED", connected = false, path = "/razorpay-connection-result?reference=abcdefghijklmnopqrstuvwx&status=connected") {
  mocks.request.mockImplementation((url: string) => Promise.resolve({ data: url === "/api/v1/owner/gym"
    ? { publicId: "gym-public", name: "My gym" } : { status, connected, gymId: "gym-public", gymName: "My gym", requestId: "req-result" } }));
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><RazorpayConnectionResult /></MemoryRouter></QueryClientProvider>));
  for (let i = 0; i < 40 && host.textContent?.includes("Checking your connection"); i++)
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10); }); });
}
it("does not trust a success query parameter and retries through authenticated initiation", async () => {
  await render();
  expect(host.textContent).toContain("Razorpay connection not completed");
  expect(host.textContent).toContain("req-result");
  mocks.request.mockImplementation((url: string) => url.endsWith("/status") ? Promise.resolve({ data: { oauthFlowVersion: 2 } }) : new Promise(() => {}));
  const button = [...host.querySelectorAll("button")].find(value => value.textContent === "Connect again")!;
  await act(async () => { button.click(); button.click(); });
  const calls = mocks.request.mock.calls.filter(([url]) => url.endsWith("/connect"));
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe("/api/v1/gyms/gym-public/payments/razorpay/connect");
  expect(calls[0][1].method).toBe("POST");
  expect(host.querySelector('a[href*="/oauth/callback"]')).toBeNull();
});
it("shows success only after the server verifies this attempt and connection", async () => {
  await render("COMPLETED", true);
  expect(host.textContent).toContain("Razorpay connected");
  expect(host.textContent).not.toContain("Connect again");
});
it("does not call a changed or disconnected connection successful", async () => {
  await render("COMPLETED", false);
  expect(host.textContent).toContain("Razorpay connection not completed");
});
it("shows provider denial with a fresh connection option", async () => {
  await render("DENIED");
  expect(host.textContent).toContain("Authorization was cancelled");
  expect(host.textContent).toContain("Connect again");
});
it("does not allow another attempt while the server is verifying an uncertain commit", async () => {
  await render("PROCESSING");
  expect(host.textContent).toContain("Connection verification in progress");
  expect(host.querySelector("button")?.disabled).toBe(true);
});
it("handles missing state references without requesting an untrusted attempt URL", async () => {
  await render("FAILED", false, "/razorpay-connection-result?status=failed&requestId=req-missing-state");
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/owner/gym");
  expect(host.textContent).toContain("req-missing-state");
  expect(host.querySelector("button")?.disabled).toBe(false);
});
it("releases the processing screen when the stored attempt expires or becomes unavailable", async () => {
  await render("PROCESSING");
  mocks.request.mockRejectedValue(new Error("Attempt not found"));
  await act(async () => { await client.refetchQueries({ queryKey: ["razorpay-connection-attempt"] }); });
  for (let i = 0; i < 40 && host.textContent?.includes("Connection verification in progress"); i++)
    await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10); }); });
  expect(host.textContent).toContain("This attempt could not be verified");
  expect(host.querySelector("button")?.disabled).toBe(false);
});
