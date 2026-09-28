// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ download: vi.fn(), request: vi.fn() }));
vi.mock("../services/apiClient", () => ({ apiDownload: mocks.download, apiRequest: mocks.request }));
import { InvoiceDownload, invoiceEmailLabel } from "./InvoiceDownload";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:invoice"), revokeObjectURL: vi.fn() });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });
async function render(status = "CAPTURED") {
  await act(async () => root.render(<QueryClientProvider client={client}><InvoiceDownload payment={{ publicId: "payment-public", status }} /></QueryClientProvider>));
}
async function until(check: () => boolean) { for (let index = 0; index < 40 && !check(); index++) await act(async () => new Promise(resolve => { setTimeout(resolve, 10); })); expect(check()).toBe(true); }
it("offers a backend PDF only for invoice-eligible payments", async () => {
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  mocks.download.mockResolvedValue(new Blob(["%PDF-1.7"], { type: "application/pdf" }));
  await render();
  await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });
  expect(mocks.download).toHaveBeenCalledWith("/api/v1/workspace/payments/payment-public/invoice");
  expect(click).toHaveBeenCalledOnce();
  click.mockRestore();
});
it("does not expose a download action for an incomplete payment", async () => {
  await render("PENDING");
  expect(host.querySelector("button")).toBeNull(); expect(mocks.download).not.toHaveBeenCalled();
});
it("shows a safe server error and does not navigate", async () => {
  mocks.download.mockRejectedValue(new Error("This invoice is not available for your account."));
  await render();
  await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });
  await until(() => !!host.querySelector('[role="alert"]'));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("not available");
});
it("queues an explicit invoice copy with an idempotency key and reports unavailable delivery honestly", async () => {
  mocks.request.mockResolvedValue({ data: { status: "QUEUED", configured: false, emailAvailable: true } });
  await render();
  await act(async () => { Array.from(host.querySelectorAll("button")).find(button => button.textContent === "Email invoice")!.click(); });
  await until(() => !!host.querySelector('[role="status"]'));
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/workspace/payments/payment-public/invoice/email", expect.objectContaining({ method: "POST", idempotencyKey: expect.any(String), body: "{}" }));
  expect(host.textContent).toContain("temporarily unavailable");
  expect(host.textContent).not.toContain("email delivered");
});
it("distinguishes provider acceptance from confirmed delivery", () => {
  expect(invoiceEmailLabel({ status: "SENT", configured: true, emailAvailable: true })).toContain("confirmation pending");
  expect(invoiceEmailLabel({ status: "DELIVERED", configured: true, emailAvailable: true })).toBe("Invoice email delivered.");
});
