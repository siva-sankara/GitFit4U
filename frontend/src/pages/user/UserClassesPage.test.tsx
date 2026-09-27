// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
import { UserClassesPage } from "./UserClassesPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.request.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === "DELETE") return { success: true };
    const page = Number(new URL(path, "https://app.test").searchParams.get("page") || 1);
    if (path.startsWith("/api/v1/users/classes")) return { data: [{ _id: "session", publicId: `class-${page}`, name: `Class page ${page}`, status: "SCHEDULED", capacity: 12, bookedCount: 1, startsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", myBooking: { _id: "card-booking", status: "BOOKED" } }], meta: { pages: 3, page, total: 30 } };
    return { data: [{ _id: "history-booking", status: "BOOKED", sessionId: { publicId: "history-class", name: `Booking page ${page}`, startsAt: "2099-01-01T10:00:00Z" } }], meta: { pages: 2, page, total: 21 } };
  });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function until(check: () => boolean) { for (let i = 0; i < 60 && !check(); i++) await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); }); expect(check()).toBe(true); }
it("pages through both classes and booking history, and cancels a booking outside the discovery page", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(true);
  await act(async () => root.render(<QueryClientProvider client={client}><UserClassesPage /></QueryClientProvider>));
  await until(() => host.textContent!.includes("Booking page 1") && host.textContent!.includes("Class page 1"));
  expect(host.querySelector(".class-card")!.textContent).toContain("Cancel booking");
  const click = async (text: string) => act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === text)!.click());
  await click("Next classes"); await until(() => host.textContent!.includes("Class page 2"));
  await click("Next bookings"); await until(() => host.textContent!.includes("Booking page 2"));
  await act(async () => host.querySelector<HTMLButtonElement>("tbody button")!.click());
  await until(() => mocks.request.mock.calls.some(([path, options]) => path === "/api/v1/users/classes/history-class/bookings/history-booking" && options?.method === "DELETE"));
});
