// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { gymCalendarDate } from "../../services/gymCalendar";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../components/MediaImageEditor", () => ({ MediaImageEditor: ({ purpose, gymId, onChange }: any) => <button type="button" data-upload-gym={gymId} onClick={() => onChange("507f1f77bcf86cd799439011", "https://media.test/photo.webp")}>Upload {purpose}</button> }));
import { MemberEditor } from "./OwnerMembersPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.request.mockImplementation(async () => ({ data: [{ publicId: "gold", status: "ACTIVE", name: "Gold", durationDays: 30, priceMinor: 10000 }] }));
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function until(check: () => boolean) { for (let i = 0; i < 60 && !check(); i++) await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 20); }); }); expect(check()).toBe(true); }
it("sends gym-local calendar inputs and an uploaded member photo reference, never an arbitrary URL", async () => {
  const timezone = "America/New_York", today = gymCalendarDate(new Date(), timezone);
  await act(async () => root.render(<QueryClientProvider client={client}><MemberEditor timezone={timezone} onClose={() => {}} onSaved={() => {}} /></QueryClientProvider>));
  await until(() => !!document.querySelector('option[value="gold"]'));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.querySelector('[name="avatarUrl"]')).toBeNull();
  expect(dialog.querySelector<HTMLInputElement>('[name="paidAt"]')!.value).toBe(today);
  expect(dialog.querySelector<HTMLInputElement>('[name="paidAt"]')!.max).toBe(today);
  (dialog.querySelector('[name="name"]') as HTMLInputElement).value = "Member One";
  (dialog.querySelector('[name="phone"]') as HTMLInputElement).value = "+919876543210";
  await act(async () => {
    const select = dialog.querySelector("select")!; select.value = "gold"; select.dispatchEvent(new Event("change", { bubbles: true }));
    Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent === "Upload MEMBER_AVATAR")!.click();
  });
  await act(async () => dialog.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await until(() => mocks.request.mock.calls.some(([path]) => path === "/api/v1/owner/members"));
  const body = JSON.parse(mocks.request.mock.calls.find(([path]) => path === "/api/v1/owner/members")![1].body);
  expect(body).toMatchObject({ startsAt: today, payment: { paidAt: today }, avatarAttachmentId: "507f1f77bcf86cd799439011" });
  expect(body).not.toHaveProperty("avatarUrl");
});
it("uses the explicitly selected admin gym for member photos and calendar dates", async () => {
  const timezone = "Pacific/Auckland", gymId = "507f1f77bcf86cd799439017";
  await act(async () => root.render(<QueryClientProvider client={client}><MemberEditor
    endpoint="/api/v1/admin/gyms/gym-public/members" plansEndpoint="/api/v1/admin/gyms/gym-public/plans"
    timezone={timezone} uploadGymId={gymId} onClose={() => {}} onSaved={() => {}} /></QueryClientProvider>));
  await until(() => !!document.querySelector('option[value="gold"]'));
  expect(document.querySelector('[data-upload-gym]')?.getAttribute("data-upload-gym")).toBe(gymId);
  expect(document.querySelector<HTMLInputElement>('[name="paidAt"]')!.value).toBe(gymCalendarDate(new Date(), timezone));
});
