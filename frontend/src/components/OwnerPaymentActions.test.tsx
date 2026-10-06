// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }));
vi.mock("../services/apiClient", () => ({
  apiRequest: mocks.request,
  apiDownload: mocks.download,
}));

import { OwnerPaymentActions } from "./OwnerPaymentActions";

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});

afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});

async function renderStatus(status: string) {
  await act(async () => root.render(
    <QueryClientProvider client={client}>
      <OwnerPaymentActions payment={{ publicId: "pay-one", status, amountMinor: 150000, createdAt: "2026-10-06T00:00:00.000Z" }} />
    </QueryClientProvider>,
  ));
}

const labels = () => [...host.querySelectorAll("button")].map((button) => button.textContent?.trim());

it("shows receipt actions for a paid invoice and hides collection", async () => {
  await renderStatus("CAPTURED");
  expect(labels()).toEqual(expect.arrayContaining(["View", "Download Invoice", "Send Receipt", "More"]));
  expect(labels()).not.toContain("Collect");
});

it("shows collection and reminder actions for a due invoice", async () => {
  await renderStatus("PENDING");
  expect(labels()).toEqual(expect.arrayContaining(["View", "Collect", "Send Reminder", "More"]));
  const collect = [...host.querySelectorAll("button")].find((button) => button.textContent === "Collect")!;
  expect(collect.title).toBe("Record payment for this invoice");
  collect.focus();
  expect(document.activeElement).toBe(collect);
});

it("offers a retry request and manual collection after a failed payment", async () => {
  await renderStatus("FAILED");
  expect(labels()).toEqual(expect.arrayContaining(["View", "Mark manually paid", "Retry", "More"]));
  expect(labels()).not.toContain("Send Reminder");
  const retry = [...host.querySelectorAll("button")].find((button) => button.textContent === "Retry")!;
  expect(retry.getAttribute("aria-label")).toBe("Ask the payer to retry this failed payment");
});
