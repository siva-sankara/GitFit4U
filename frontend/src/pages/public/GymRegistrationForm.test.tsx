// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../components/LocationPicker", () => ({ LocationPicker: () => <p>Existing confirmed coordinates</p> }));
import { GymRegistrationForm } from "./GymRegistrationForm";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  await act(async () => root.render(<QueryClientProvider client={client}><GymRegistrationForm endpoint="/api/v1/owner/registrations" initial={{ name: "Fitness Club", contact: { phone: "9876543210", email: "owner@example.com" }, address: { line1: "Main Road", city: "Hyderabad", state: "Telangana", postalCode: "500001", country: "IN" }, location: { coordinates: [78, 17] } }} /></QueryClientProvider>));
  await act(async () => host.querySelector<HTMLInputElement>('.registration-confirm input')!.click());
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function submit() {
  await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await new Promise(resolve => { setTimeout(resolve, 20); }); });
}
it("reuses a failed creation's idempotency key and creates a new key only after changing the payload", async () => {
  mocks.request.mockRejectedValue(new Error("Response could not be received. Retry."));
  await submit(); await submit();
  const [first, retry] = mocks.request.mock.calls;
  expect(first[1].method).toBe("POST");
  expect(retry[1].idempotencyKey).toBe(first[1].idempotencyKey);
  await act(async () => {
    const input = host.querySelector<HTMLInputElement>('input[autocomplete="organization"]')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Fitness Club Central");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await submit();
  expect(mocks.request.mock.calls[2][1].idempotencyKey).not.toBe(first[1].idempotencyKey);
});
it("prevents two synchronous submissions while the original request is pending", async () => {
  mocks.request.mockReturnValue(new Promise(() => {}));
  await act(async () => {
    for (let index = 0; index < 2; index++) host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(mocks.request).toHaveBeenCalledOnce();
});
