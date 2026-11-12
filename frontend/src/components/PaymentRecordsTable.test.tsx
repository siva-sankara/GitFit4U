// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../services/apiClient", () => ({ apiRequest: mock.request }));
import { ResourcePage } from "../pages/live/LiveData";
import { PaymentRecordsTable } from "./PaymentRecordsTable";

let host: HTMLDivElement, root: Root, client: QueryClient;
const payment = { publicId: "pay-long-reference", payerId: { name: "A member with a long full name" }, purpose: "MEMBERSHIP", gymId: { name: "Test gym", timezone: "Invalid/timezone" }, amountMinor: 123450, currency: "INR", status: "CAPTURED", methodCategory: "UPI", createdAt: "2026-11-12T18:45:00Z", pricingSnapshot: { subtotalMinor: 150000, discountMinor: 26550, taxMinor: 0, totalMinor: 123450 } };
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.request.mockResolvedValue({ data: [payment], meta: { total: 1 } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function flush() { await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30); }); }); }

it("preserves amounts, price breakdown, full reference and the action's payment record", async () => {
  const action = vi.fn();
  await act(async () => root.render(<PaymentRecordsTable rows={[payment]} resetKey="one" actions={row => <button onClick={() => action(row)}>View</button>} />));
  expect(host.textContent).toContain("₹1,234.50");
  expect(host.querySelector(".payment-reference")?.getAttribute("title")).toBe(payment.publicId);
  expect(host.querySelector(".payment-payer-name")?.getAttribute("title")).toBe(payment.payerId.name);
  expect(host.querySelector("details")?.open).toBe(false);
  expect(host.querySelector("details")?.textContent).toContain("₹265.50");
  expect(host.querySelector(".payment-date-cell")?.textContent).toContain("13 Nov 2026");
  expect(host.textContent).toContain("UPI");
  await act(async () => host.querySelector("button")!.click());
  expect(action).toHaveBeenCalledWith(payment);
});

it("retains notification links and server status filtering with the dedicated payments table", async () => {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={["/owner/payments?payment=pay-long-reference"]}>
    <ResourcePage title="Payments" resource="payments" className="payments-page" description="Payment history" statuses={["CAPTURED", "FAILED"]} columns={[{ key: "publicId", title: "Reference" }, { key: "createdAt", title: "Created", format: "date" }]} renderTable={(rows, key) => <PaymentRecordsTable rows={rows} resetKey={key} actions={() => null} />} />
  </MemoryRouter></QueryClientProvider>));
  await flush();
  expect(host.querySelector('[aria-label="Payments"]')).not.toBeNull();
  expect(new URL(mock.request.mock.calls[0][0], "http://localhost").searchParams.get("selected")).toBe(payment.publicId);
  await act(async () => {
    const select = host.querySelector<HTMLSelectElement>('[aria-label="Status"]')!;
    select.value = "FAILED"; select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flush();
  const filtered = new URL(mock.request.mock.calls.at(-1)![0], "http://localhost");
  expect(filtered.searchParams.get("status")).toBe("FAILED");
  expect(filtered.searchParams.get("selected")).toBe(payment.publicId);
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Show all")!.click());
  await flush();
  const all = new URL(mock.request.mock.calls.at(-1)![0], "http://localhost");
  expect(all.searchParams.has("selected")).toBe(false);
  expect(all.searchParams.get("status")).toBe("FAILED");
});
