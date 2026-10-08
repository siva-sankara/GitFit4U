// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mock.request }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { user: { _id: "recipient" } } } }) }));
import { NotificationOpenPage } from "./NotificationOpenPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
const id = "507f1f77bcf86cd799439011";
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(identifier = id) {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/notification-open/${identifier}`]}><Routes>
    <Route path="/notification-open/:id" element={<NotificationOpenPage />} />
    <Route path="/app/support" element={<p>Exact support ticket destination</p>} />
  </Routes></MemoryRouter></QueryClientProvider>));
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30); }); });
}
it("opens only the destination returned by the recipient-scoped API", async () => {
  mock.request.mockResolvedValue({ data: { available: true, path: "/app/support?ticket=exact-ticket" } });
  await render(); expect(host.textContent).toContain("Exact support ticket destination");
  expect(mock.request).toHaveBeenCalledWith(`/api/v1/users/me/notifications/${id}/open`, { method: "POST" });
});
it("keeps inaccessible and deleted targets in an explained fallback", async () => {
  mock.request.mockResolvedValue({ data: { available: false, path: "/notifications", explanation: "This ticket is no longer accessible." } });
  await render(); expect(host.textContent).toContain("no longer accessible"); expect(host.querySelector("a")?.getAttribute("href")).toBe("/notifications");
});
it.each(["https://evil.example", `/notification-open/${id}`])("rejects external and recursive destinations %s", async path => {
  mock.request.mockResolvedValue({ data: { available: true, path } }); await render(); expect(host.textContent).toContain("Notification unavailable");
});
it("does not call the API for malformed identifiers", async () => {
  await render("bad-id"); expect(mock.request).not.toHaveBeenCalled(); expect(host.textContent).toContain("Notification unavailable");
});
