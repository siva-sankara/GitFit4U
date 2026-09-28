// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), user: vi.fn() }));
vi.mock("../../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: mocks.user }));
import { ActivateAccountPage } from "./ActivateAccountPage";
let host: HTMLDivElement, root: Root, client: QueryClient;
const token = "a".repeat(24) + "." + "b".repeat(43);
beforeEach(() => {
  vi.clearAllMocks(); sessionStorage.clear(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.user.mockReturnValue({ data: null }); mocks.request.mockResolvedValue({ data: { linked: true } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); sessionStorage.clear(); });
async function mount(kind = "ACTIVATE") {
  await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/activate-account#token=${token}&kind=${kind}`]}><ActivateAccountPage /></MemoryRouter></QueryClientProvider>));
}
async function until(check: () => boolean) { for (let index = 0; index < 40 && !check(); index++) await act(async () => new Promise(resolve => { setTimeout(resolve, 10); })); expect(check()).toBe(true); }
it("opening an activation link does not consume it; only an explicit password submission posts", async () => {
  await mount();
  expect(mocks.request).not.toHaveBeenCalled();
  host.querySelector<HTMLInputElement>('[name="password"]')!.value = "PersonalPassword123";
  host.querySelector<HTMLInputElement>('[name="confirmPassword"]')!.value = "PersonalPassword123";
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await until(() => host.textContent!.includes("Your account is active"));
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/activate-account", expect.objectContaining({ method: "POST", body: JSON.stringify({ token, password: "PersonalPassword123" }) }));
  expect(sessionStorage.getItem("gfu_pending_invitation")).toBeNull();
});
it("keeps the secret out of the login return URL for an existing-account invitation", async () => {
  await mount("LINK");
  expect(host.querySelector('a[href="/login?returnTo=%2Factivate-account"]')).not.toBeNull();
  expect(host.querySelector('input[type="password"]')).toBeNull();
  expect(mocks.request).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("gfu_pending_invitation")).toContain(token);
});
it("submits existing-account acceptance without a password only after user action", async () => {
  mocks.user.mockReturnValue({ data: { data: { user: { _id: "member" } } } });
  await mount("LINK");
  expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  await until(() => mocks.request.mock.calls.length === 1);
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/accept-invitation", expect.objectContaining({ body: JSON.stringify({ token }) }));
});
it("does not post mismatched passwords", async () => {
  await mount();
  host.querySelector<HTMLInputElement>('[name="password"]')!.value = "PersonalPassword123";
  host.querySelector<HTMLInputElement>('[name="confirmPassword"]')!.value = "DifferentPassword123";
  await act(async () => host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
  expect(host.textContent).toContain("Passwords must match"); expect(mocks.request).not.toHaveBeenCalled();
});
