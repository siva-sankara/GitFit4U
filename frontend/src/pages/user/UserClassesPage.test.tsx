// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), userId:"user-a" }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data:{ data:{ user:{ _id:mocks.userId } } } }) }));
import { UserClassesPage } from "./UserClassesPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.userId = "user-a";
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
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><UserClassesPage /></QueryClientProvider></MemoryRouter>));
  await until(() => host.textContent!.includes("Booking page 1") && host.textContent!.includes("Class page 1"));
  expect(host.querySelector(".class-card")!.textContent).toContain("Cancel booking");
  const click = async (text: string) => act(async () => Array.from(host.querySelectorAll("button")).find((button) => button.textContent === text)!.click());
  await click("Next classes"); await until(() => host.textContent!.includes("Class page 2"));
  await click("Next bookings"); await until(() => host.textContent!.includes("Booking page 2"));
  await act(async () => host.querySelector<HTMLButtonElement>("tbody button")!.click());
  await until(() => mocks.request.mock.calls.some(([path, options]) => path === "/api/v1/users/classes/history-class/bookings/history-booking" && options?.method === "DELETE"));
});
it("loads the exact authorized booking from a notification even outside the current history page", async () => {
  const id = "507f1f77bcf86cd799439011";
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, options?: { method?: string }) => path === `/api/v1/users/classes/bookings/${id}`
    ? { data: { _id: id, status: "CANCELLED", sessionId: { publicId: "selected", name: "Notification booking", status: "CANCELLED", capacity: 12, bookedCount: 0, startsAt: "2099-01-01T10:00:00Z", endsAt: "2099-01-01T11:00:00Z", imageUrl: "https://media.test/class.webp" } } }
    : original(path, options));
  await act(async () => root.render(<MemoryRouter initialEntries={[`/app/classes?booking=${id}`]}><QueryClientProvider client={client}><UserClassesPage /></QueryClientProvider></MemoryRouter>));
  await until(() => host.textContent!.includes("Notification booking"));
  const details = host.querySelector('[aria-label="Selected booking"]')!;
  expect(details.querySelector("img")?.getAttribute("src")).toBe("https://media.test/class.webp");
  expect(details.textContent).not.toContain("Cancel booking");
});
it("rejects malformed booking links without querying the private endpoint", async () => {
  await act(async () => root.render(<MemoryRouter initialEntries={["/app/classes?booking=invalid"]}><QueryClientProvider client={client}><UserClassesPage /></QueryClientProvider></MemoryRouter>));
  expect(host.textContent).toContain("This booking link is invalid.");
  expect(mocks.request.mock.calls.some(([path]) => path.includes("/classes/bookings/"))).toBe(false);
});

it("shows an eligible-subscription empty state while preserving historical bookings", async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, options?: RequestInit) => path.startsWith("/api/v1/users/classes?")
    ? { data:[], meta:{ eligibleGymCount:0, pages:1 } } : original(path, options));
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><UserClassesPage /></QueryClientProvider></MemoryRouter>));
  await until(() => host.textContent!.includes("No eligible gym subscriptions") && host.textContent!.includes("Booking page 1"));
  expect(host.querySelector('a[href="/app/discover"]')?.textContent).toBe("Explore gyms");
  expect(host.querySelectorAll(".class-card")).toHaveLength(0);
});

it("keeps class request failures distinct from an empty membership and never loads public classes", async () => {
  const original = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.startsWith("/api/v1/users/classes?")) throw new Error("Membership lookup unavailable");
    return original(path, options);
  });
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><UserClassesPage /></QueryClientProvider></MemoryRouter>));
  await until(() => host.textContent!.includes("Membership lookup unavailable"));
  expect(host.textContent).not.toContain("No eligible gym subscriptions");
  expect(host.querySelectorAll(".class-card")).toHaveLength(0);
  expect(mocks.request.mock.calls.every(([path]) => path.startsWith("/api/v1/users/classes") || path.startsWith("/api/v1/workspace/records/bookings"))).toBe(true);
});

it("does not reuse another account's class or booking cache while the new account loads", async () => {
  const render = () => root.render(<MemoryRouter><QueryClientProvider client={client}><UserClassesPage /></QueryClientProvider></MemoryRouter>);
  await act(async () => render());
  await until(() => host.textContent!.includes("Class page 1") && host.textContent!.includes("Booking page 1"));
  mocks.userId = "user-b";
  mocks.request.mockReturnValue(new Promise(() => {}));
  await act(async () => render());
  expect(host.textContent).not.toContain("Class page 1");
  expect(host.textContent).not.toContain("Booking page 1");
  expect(client.getQueryCache().getAll().some(query => query.queryKey[2] === "user-b")).toBe(true);
});

it("searches only the subscribed class endpoint and resets pagination", async () => {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><UserClassesPage /></QueryClientProvider></MemoryRouter>));
  await until(() => host.textContent!.includes("Class page 1"));
  await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Next classes")!.click());
  await until(() => host.textContent!.includes("Class page 2"));
  const input = host.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"  Yoga  ");
    input.dispatchEvent(new Event("input",{ bubbles:true }));
  });
  await act(async () => input.closest("form")!.dispatchEvent(new Event("submit",{ bubbles:true, cancelable:true })));
  await until(() => mocks.request.mock.calls.some(([path]) => String(path).includes("q=Yoga") && String(path).includes("page=1")));
});
