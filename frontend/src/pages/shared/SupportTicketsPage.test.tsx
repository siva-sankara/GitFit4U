// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn(), role: "USER" }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mock.request }));
vi.mock("../../services/mediaUpload", () => ({ uploadMedia: vi.fn() }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { user: { _id: "requester" }, context: { role: mock.role } } } }) }));
import { SupportTicketsPage } from "./SupportTicketsPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
const ticket = { publicId: "TKT-TEST", subject: "Private payment question", category: "PAYMENT", status: "OPEN", priority: "NORMAL", activity: [], createdAt: "2026-10-01T00:00:00Z" };
beforeEach(() => {
  vi.clearAllMocks(); mock.role = "USER"; Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mock.request.mockImplementation(async (path: string) => {
    if (path.endsWith("/support-context")) return { data: { gyms: [], references: [] } };
    if (path.endsWith("/support-management")) return { data: { notes: [{ key: "note", body: "Private admin note" }], assignees: [{ _id: "admin", name: "Support admin" }] } };
    if (path.endsWith("/messages")) return { data: [{ publicId: "reply", text: "Public reply", senderId: { _id: "requester", name: "Requester" } }], meta: { hasMore: false } };
    if (path === "/api/v1/conversations/exact-ticket") return { data: { publicId: "exact-ticket", type: "SUPPORT", supportTicketId: ticket } };
    return { data: [{ publicId: "exact-ticket", supportTicketId: ticket, unreadCount: 2 }], meta: { total: 1, statusCounts: { OPEN: 7 } } };
  });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function flush() { await act(async () => { await new Promise(resolve => { setTimeout(resolve, 40); }); }); }
async function render(path = "/app/support") {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[path]}><SupportTicketsPage /></MemoryRouter></QueryClientProvider>));
  await flush(); await flush();
}
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(row => row.textContent === text)!; }
it.each(["USER", "GYM_OWNER", "TRAINER"])("shows the exact ticket without requesting internal notes for %s", async role => {
  mock.role = role; await render("/app/support?ticket=exact-ticket");
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Private payment question");
  expect(document.body.textContent).toContain("Public reply"); expect(document.body.textContent).not.toContain("Internal notes");
  expect(mock.request.mock.calls.some(([path]) => path.endsWith("/support-management"))).toBe(false);
});
it("loads admin assignment controls and separately authorized internal notes", async () => {
  mock.role = "ADMIN"; await render("/admin/support?ticket=exact-ticket");
  expect(document.body.textContent).toContain("Private admin note"); expect(document.body.textContent).toContain("Assigned support person");
});
it("uses server summary counts and sends the selected category to the API", async () => {
  await render(); expect(host.querySelector('.support-summary strong')?.textContent).toBe("7");
  const category = [...host.querySelectorAll("label")].find(row => row.textContent?.startsWith("Category"))!.querySelector("select")!;
  await act(async () => { category.value = "PAYMENT"; category.dispatchEvent(new Event("change", { bubbles: true })); }); await flush();
  expect(mock.request.mock.calls.some(([path]) => new URL(path, "http://localhost").searchParams.get("category") === "PAYMENT")).toBe(true);
});
it("preserves a failed creation draft and reuses its request key on retry", async () => {
  await render(); await act(async () => button("New ticket").click()); await flush();
  const dialog = document.querySelector('[role="dialog"]')!;
  async function fill(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
    await act(async () => { Object.getOwnPropertyDescriptor(input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  await fill(dialog.querySelector("input")!, "Need payment assistance"); await fill(dialog.querySelector("textarea")!, "This draft must survive a temporary failure.");
  const original = mock.request.getMockImplementation()!;
  mock.request.mockImplementation((path, options) => path.endsWith("/support-tickets") ? Promise.reject(new Error("Temporary network failure")) : original(path, options));
  const submit = async () => { await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))); await flush(); };
  await submit(); expect(dialog.textContent).toContain("Your draft is preserved"); expect(dialog.querySelector("textarea")!.value).toContain("survive");
  await submit(); const calls = mock.request.mock.calls.filter(([path]) => path.endsWith("/support-tickets"));
  expect(calls).toHaveLength(2); expect(calls[1][1].idempotencyKey).toBe(calls[0][1].idempotencyKey);
});
