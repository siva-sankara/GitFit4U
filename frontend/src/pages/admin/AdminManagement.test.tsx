// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), gymPublicId: "gym-public-a" as string | undefined, status: "ACTIVE", failure: false }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
import { AdminMembers } from "./AdminManagement";

let host: HTMLDivElement, root: Root, client: QueryClient;
let originalGeolocation: PropertyDescriptor | undefined;
const getLocation = vi.fn(), watchLocation = vi.fn();
const member = () => ({ publicId: "member-public-a", memberCode: "MEM-1", status: mocks.status, userId: { name: "Asha" }, gymId: { name: "Local Fitness" } });
beforeEach(() => {
  vi.clearAllMocks(); mocks.gymPublicId = "gym-public-a"; mocks.status = "ACTIVE"; mocks.failure = false;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  originalGeolocation = Object.getOwnPropertyDescriptor(navigator, "geolocation");
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: getLocation, watchPosition: watchLocation } });
  mocks.request.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (options?.method === "POST") {
      if (mocks.failure) throw new Error("Membership is not eligible for attendance.");
      return { success: true, data: { attendance: { publicId: "attendance-a" } } };
    }
    if (path.startsWith("/api/v1/workspace/records/gyms")) return { data: [{ publicId: "gym-public-a", name: "Local Fitness" }] };
    if (path.startsWith("/api/v1/workspace/records/members")) return { data: [member()], meta: { total: 1, pages: 1 } };
    if (path === "/api/v1/admin/members/member-public-a") return { data: { gymPublicId: mocks.gymPublicId, member: member(), attendance: [], payments: [] } };
    throw new Error(`Unexpected test request: ${path}`);
  });
});
afterEach(async () => {
  await act(async () => root.unmount()); client.clear(); host.remove();
  if (originalGeolocation) Object.defineProperty(navigator, "geolocation", originalGeolocation);
  else Reflect.deleteProperty(navigator, "geolocation");
});
async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 60 && !check(); attempt++) await act(async () => { await new Promise(resolve => { setTimeout(resolve, 20); }); });
  expect(check()).toBe(true);
}
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find(node => node.textContent === text); }
async function openDetails() {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><AdminMembers /></QueryClientProvider></MemoryRouter>));
  await until(() => Boolean(button("View details")));
  await act(async () => button("View details")!.click());
  await until(() => document.querySelector('[role="dialog"]')?.textContent?.includes("Recent attendance") === true);
}
async function reason(value: string) {
  const input = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("records manual attendance against the member's returned gym identity with a validated reason and no location request", async () => {
  await openDetails();
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("Record manual attendance");
  expect(button("Record check-in")).toBeUndefined();
  await reason("  a  ");
  expect(button("Record check-in")).toBeUndefined();
  expect(mocks.request.mock.calls.some(([, options]) => options?.method === "POST")).toBe(false);
  await reason("  Correcting the attendance register  ");
  expect(button("Record check-in")).toBeDefined();
  await act(async () => button("Record check-in")!.click());
  await until(() => document.querySelector('[role="dialog"]')!.textContent!.includes("Attendance recorded or already present for today."));
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/admin/gyms/gym-public-a/attendance", {
    method: "POST", body: JSON.stringify({ memberIdentifier: "member-public-a", reason: "Correcting the attendance register" }), idempotencyKey: expect.any(String),
  });
  expect(getLocation).not.toHaveBeenCalled(); expect(watchLocation).not.toHaveBeenCalled();
});
it.each(["inactive", "missing gym"])("does not offer manual attendance when the member is %s", async scenario => {
  if (scenario === "inactive") mocks.status = "INACTIVE";
  else mocks.gymPublicId = undefined;
  await openDetails();
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Record manual attendance");
  expect(button("Record check-in")).toBeUndefined();
});
it("shows the server eligibility error without a false success message", async () => {
  mocks.failure = true;
  await openDetails(); await reason("Manual attendance correction");
  await act(async () => button("Record check-in")!.click());
  await until(() => document.querySelector('[role="dialog"] [role="alert"]')?.textContent?.includes("Membership is not eligible") === true);
  expect(document.querySelector('[role="dialog"]')!.textContent).not.toContain("Attendance recorded or already present");
});
