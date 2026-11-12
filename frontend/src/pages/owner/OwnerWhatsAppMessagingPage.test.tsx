// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ request: vi.fn(), context: { role: "GYM_OWNER", permissions: ["member:read"], gymId: "gym-a", userId: "owner-a", sessionId: "session-a" } }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { context: mocks.context } } }) }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
import { OwnerWhatsAppMessagingPage } from "./OwnerWhatsAppMessagingPage";

const meta = { total: 53, totalPages: 3, timezone: "Asia/Kolkata", serverNow: "2026-11-11T09:00:00Z", gymName: "FitZone", ownerName: "Owner", group: { name: "", inviteLink: "" } };
const rows = [
  { publicId: "one", name: "Rahul", phone: "9876543210", chatUrl: "https://wa.me/919876543210", status: "ACTIVE", directAccess: false, renewalAmount: null, currentSubscriptionId: { status: "ACTIVE", startsAt: "2026-10-11", endsAt: "2026-11-17T18:30:00Z", planSnapshot: { name: "Gold" } } },
  { publicId: "two", name: "Ravi", phone: "9988776655", chatUrl: "https://wa.me/919988776655", status: "ACTIVE", directAccess: false, renewalAmount: null, currentSubscriptionId: { status: "ACTIVE", endsAt: "2026-12-11", planSnapshot: { name: "Silver" } } },
  { publicId: "three", name: "Missing Phone", phone: "", chatUrl: null, status: "INACTIVE", directAccess: false, renewalAmount: null, currentSubscriptionId: { status: "EXPIRED", endsAt: "2026-10-01" } },
];
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(mocks.context, { role: "GYM_OWNER", gymId: "gym-a" });
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.spyOn(window, "open").mockReturnValue(null);
  mocks.request.mockResolvedValue({ success: true, data: rows, meta });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.restoreAllMocks(); });
async function render() {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><OwnerWhatsAppMessagingPage /></QueryClientProvider></MemoryRouter>));
  await until(() => Boolean(host.querySelector('[aria-label="Select Rahul"]')) || mocks.context.role !== "GYM_OWNER");
}
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++) await act(async () => { await new Promise(resolve => { setTimeout(resolve, 10); }); });
  expect(check()).toBe(true);
}
const button = (name: string, container: ParentNode = document) => [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === name)!;
const click = async (element: HTMLElement) => { expect(element).toBeTruthy(); await act(async () => element.click()); };
const check = (name: string) => host.querySelector<HTMLInputElement>(`[aria-label="Select ${name}"]`)!;
async function input(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => { Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value); element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); });
}

it("previews and opens a single recipient, preserving plain Normal Chat", async () => {
  await render(); await click(check("Rahul"));
  expect(host.querySelector(".wa-preview")!.textContent).toContain("Hi Rahul,");
  expect(host.querySelector(".wa-preview")!.textContent).toContain("18 Nov 2026");
  await click(button("Open in WhatsApp"));
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(vi.mocked(window.open).mock.calls[0][0]).toMatch(/^https:\/\/wa.me\/919876543210\?text=Hi%20Rahul/);
  await click(button("Normal Chat"));
  expect(window.open).toHaveBeenLastCalledWith("https://wa.me/919876543210", "_blank", "noopener,noreferrer");
  expect(host.textContent).toContain("WhatsApp opened for Rahul");
  expect(mocks.request.mock.calls.every(([path]) => path.startsWith("/api/v1/owner/members?view=messaging"))).toBe(true);
});
it("selects only visible members and clears selection on filters, search and pagination", async () => {
  await render();
  await click(host.querySelector<HTMLInputElement>('.wa-selection-tools input[type="checkbox"]')!);
  expect(host.textContent).toContain("Selected Recipients · 3");
  await click(button("Clear Selection"));
  expect(check("Rahul").checked).toBe(false);
  await click(button("Select Active"));
  expect(check("Rahul").checked).toBe(true); expect(check("Ravi").checked).toBe(true); expect(check("Missing Phone").checked).toBe(false);
  await click(button("Select Expiring Soon")); expect(check("Ravi").checked).toBe(false);
  const memberList = host.querySelector<HTMLDivElement>('[role="region"][aria-label="Member list"]')!;
  expect(memberList.tabIndex).toBe(0);
  memberList.scrollTop = 360;
  await input(host.querySelector(".wa-filters select")!, "EXPIRED");
  expect(memberList.scrollTop).toBe(0);
  await until(() => mocks.request.mock.calls.some(([path]) => path.includes("membershipStatus=EXPIRED")));
  expect(host.textContent).toContain("Selected Recipients · 0");
  await until(() => Boolean(check("Rahul")) && !check("Rahul").disabled);
  await click(check("Rahul"));
  await input(host.querySelector('input[type="search"]')!, "Gold");
  await until(() => mocks.request.mock.calls.some(([path]) => path.includes("q=Gold")));
  expect(host.textContent).toContain("Selected Recipients · 0");
  await until(() => Boolean(check("Rahul")) && !check("Rahul").disabled);
  await click(check("Rahul"));
  memberList.scrollTop = 240;
  await click(host.querySelector<HTMLButtonElement>('[aria-label="Next page"]')!);
  expect(memberList.scrollTop).toBe(0);
  await until(() => mocks.request.mock.calls.some(([path]) => path.includes("page=2")));
  expect(host.textContent).toContain("Selected Recipients · 0");
});
it("processes one recipient per explicit action and skips invalid numbers without opening tabs", async () => {
  await render(); await click(host.querySelector<HTMLInputElement>('.wa-selection-tools input[type="checkbox"]')!);
  await click(button("Send Individually"));
  expect(document.querySelector('[role="dialog"]')!.textContent).toContain("3 members selected");
  expect(window.open).not.toHaveBeenCalled();
  await click(button("Start"));
  expect(button("Mark Complete & Next").disabled).toBe(true);
  expect(window.open).not.toHaveBeenCalled();
  await click(button("Open Rahul in WhatsApp"));
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(button("Open Ravi in WhatsApp")).toBeUndefined();
  await click(button("Mark Complete & Next"));
  expect(window.open).toHaveBeenCalledTimes(1);
  await click(button("Open Ravi in WhatsApp"));
  expect(window.open).toHaveBeenCalledTimes(2);
  await click(button("Mark Complete & Next"));
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("2 of 3 processed · 1 skipped");
  expect(dialog.textContent).toContain("Missing Phone does not have a valid mobile number");
  expect(dialog.textContent).not.toMatch(/Message sent successfully|Delivered|READ/);
});
it("supports custom text and blocks missing group links and generic personalization", async () => {
  await render(); await click(check("Rahul")); await click(button("Custom Message"));
  await input(host.querySelector(".wa-composer textarea")!, "Hello {{memberName}} 💪 & ₹100\nTraining?");
  await click(button("Normal Chat"));
  expect(window.open).toHaveBeenLastCalledWith(`https://wa.me/919876543210?text=${encodeURIComponent("Hello Rahul 💪 & ₹100\nTraining?")}`, "_blank", "noopener,noreferrer");
  await click(button("Group Invite"));
  expect(button("Open in WhatsApp").disabled).toBe(true);
  expect(host.querySelector(".wa-preview")!.textContent).toContain("Group Invite Link is unavailable");
  await input(host.querySelector(".wa-share textarea")!, "Hi {{memberName}}");
  expect(button("Share via WhatsApp").disabled).toBe(true);
  await input(host.querySelector(".wa-share textarea")!, "Update from {{gymName}}");
  await click(button("Share via WhatsApp"));
  expect(window.open).toHaveBeenLastCalledWith("https://wa.me/?text=Update%20from%20FitZone", "_blank", "noopener,noreferrer");
});
it("discards selection and progress on a gym switch and blocks staff access", async () => {
  await render(); await click(check("Rahul")); await click(check("Ravi")); await click(button("Send Individually"));
  mocks.context.gymId = "gym-b";
  await render();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(host.textContent).toContain("Selected Recipients · 0");
  mocks.context.role = "GYM_STAFF";
  await render();
  expect(host.textContent).toContain("Gym owner access is required");
});
