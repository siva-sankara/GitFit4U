// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
import { EditForm, ResourcePage, Table } from "./LiveData";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(element: React.ReactNode) {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter>{element}</MemoryRouter>
      </QueryClientProvider>,
    );
  });
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}
it("renders accessible status labels with distinct success, pending and expired colors", async () => {
  await render(
    <Table
      rows={[
        { _id: "active", status: "ACTIVE" },
        { _id: "pending", status: "PENDING_PAYMENT" },
        { _id: "expired", status: "EXPIRED" },
      ]}
      columns={[{ key: "status", title: "Status", format: "status" }]}
    />,
  );
  expect(host.querySelector(".status-badge--success")?.textContent).toBe(
    "Active",
  );
  expect(host.querySelector(".status-badge--warning")?.textContent).toBe(
    "Pending payment",
  );
  expect(host.querySelector(".status-badge--danger")?.textContent).toBe(
    "Expired",
  );
});
it("submits nested fields and converts displayed rupees to integer minor units", async () => {
  mocks.request.mockResolvedValue({ success: true, data: {} });
  await render(
    <EditForm
      endpoint="/plans"
      fields={[
        { key: "priceMinor", label: "Price", type: "money" },
        { key: "contactInfo.email", label: "Email", type: "email" },
      ]}
      initial={{ priceMinor: 12345, contactInfo: { email: "gym@example.com" } }}
    />,
  );
  expect(
    host.querySelector<HTMLInputElement>('input[type="number"]')?.value,
  ).toBe("123.45");
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({
    priceMinor: 12345,
    contactInfo: { email: "gym@example.com" },
  });
});
it("fetches the next database page and renders returned records", async () => {
  mocks.request.mockImplementation((path: string) =>
    Promise.resolve({
      success: true,
      data: [
        {
          _id: path.includes("page=2") ? "b" : "a",
          name: path.includes("page=2") ? "Second gym" : "First gym",
        },
      ],
      meta: { page: path.includes("page=2") ? 2 : 1, pages: 2, total: 2 },
    }),
  );
  await render(
    <ResourcePage
      title="Gyms"
      resource="gyms"
      columns={[{ key: "name", title: "Name" }]}
    />,
  );
  await flush();
  expect(host.textContent).toContain("First gym");
  await act(async () => {
    Array.from(host.querySelectorAll("button"))
      .find((button) => button.textContent === "Next")!
      .click();
  });
  await flush();
  expect(mocks.request.mock.lastCall?.[0]).toContain("page=2");
  expect(host.textContent).toContain("Second gym");
  expect(host.textContent).not.toContain("First gym");
});
it("keeps provider errors visible instead of showing a successful save", async () => {
  mocks.request.mockRejectedValue(
    new Error("Payment provider is not configured"),
  );
  await render(<EditForm endpoint="/orders" fields={[]} />);
  await act(async () => {
    host
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await flush();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(
    "Payment provider is not configured",
  );
  expect(host.textContent).not.toContain("Saved successfully");
});
