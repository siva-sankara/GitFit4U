// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../services/apiClient", () => ({ apiRequest: mocks.request }));
import { MemberCreationSuccess, type MemberCreationResult } from "./MemberCreationSuccess";
let host: HTMLDivElement, root: Root, client: QueryClient;
const saved: MemberCreationResult = { member: { publicId: "member-a", memberCode: "MEM-1", status: "ACTIVE", contact: { name: "Fixture member", email: "member@example.test", phone: "+919999999999" } }, subscription: { publicId: "sub", status: "ACTIVE", startsAt: "2026-11-14", endsAt: "2026-12-14", planSnapshot: { name: "Gold" } }, payment: { amountMinor: 100000, currency: "INR", methodCategory: "CASH", status: "CAPTURED" }, account: { state: "NEW", status: "ACTIVE", firstAccessPending: true }, gym: { name: "Fixture gym", timezone: "Asia/Kolkata" }, temporaryCredential: { password: "unique-fixture-bootstrap", expiresAt: "2026-11-15" } };
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); localStorage.clear(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host); client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.request.mockResolvedValue({ data: { recipient: "member@example.test", phone: "+919999999999", message: "Welcome to Fixture gym", chatUrl: "https://wa.me/919999999999?text=Welcome", invitation: null, delivery: "NOT_REQUESTED" } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); });
async function render(value = saved) {
  await act(async () => root.render(<MemoryRouter><QueryClientProvider client={client}><MemberCreationSuccess saved={value} scope="owner-gym" onClose={() => {}} /></QueryClientProvider></MemoryRouter>));
  await act(async () => { await new Promise(resolve => { setTimeout(resolve, 30); }); });
}
const button = (text: string) => [...document.querySelectorAll("button")].find(item => item.textContent === text)!;
it("masks the one-time credential and keeps it out of storage and welcome payloads", async () => {
  await render();
  expect(document.querySelector<HTMLInputElement>('[aria-label="Temporary password"]')?.type).toBe("password");
  await act(async () => button("Reveal").click());
  expect(document.querySelector<HTMLInputElement>('[aria-label="Temporary password"]')?.type).toBe("text");
  expect(JSON.stringify(localStorage) + JSON.stringify(sessionStorage)).not.toContain(saved.temporaryCredential!.password);
  await act(async () => button("Send Welcome Email").click());
  const sent = mocks.request.mock.calls.find(([, options]) => options?.method === "POST");
  expect(JSON.parse(sent![1].body)).toEqual({ recipient: "member@example.test" });
  expect(document.body.textContent).toContain("Welcome email queued");
  expect(document.body.textContent).not.toContain("Email delivered");
});
it("previews WhatsApp separately and never claims that opening its composer sent a message", async () => {
  await render();
  await act(async () => button("Open Welcome in WhatsApp").click());
  expect(document.body.textContent).toContain("WhatsApp recipient: +919999999999");
  expect(document.querySelector("pre")?.textContent).toBe("Welcome to Fixture gym");
  expect(document.querySelector('a[href^="https://wa.me"]')?.getAttribute("href")).not.toContain(saved.temporaryCredential!.password);
  expect(mocks.request.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
});
it("existing/replayed accounts show no password controls and scheduled access is explicit", async () => {
  await render({ ...saved, account: { state: "EXISTING", status: "ACTIVE", firstAccessPending: false }, temporaryCredential: undefined, replayed: true, subscription: { ...saved.subscription, status: "SCHEDULED" } });
  expect(document.querySelector('[aria-label="Temporary password"]')).toBeNull();
  expect(document.body.textContent).toContain("existing credentials preserved");
  expect(document.body.textContent).toContain("Scheduled");
  expect(document.body.textContent).toContain("Temporary passwords cannot be recovered");
});
it("distinguishes email provider acceptance from inbox delivery", async () => {
  mocks.request.mockResolvedValue({ data: { recipient: "member@example.test", message: "Welcome", chatUrl: null, invitation: null, delivery: "SENT" } });
  await render();
  expect(document.body.textContent).toContain("Accepted by the email provider. Inbox delivery is not confirmed.");
  expect(document.body.textContent).not.toContain("Email delivery confirmed by the provider.");
});
