// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn() }));
vi.mock("../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: "/owner/members", search: "?page=2", hash: "" }),
}));
import { MemberQuickActions } from "./MemberQuickActions";
let host: HTMLDivElement, root: Root;
const member = { publicId: "member-public-id", userId: { _id: "registered-user", name: "Jane", phone: "9876543210", status: "ACTIVE" }, contact: { phone: "9111111111" } };
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("calls the registered number rather than an editable tenant phone", async () => {
  await act(async () => { root.render(<MemberQuickActions member={member} />); });
  expect(host.querySelector("a")?.getAttribute("href")).toBe("tel:+919876543210");
});
it("renders only the actions requested by compact directory layouts", async () => {
  await act(async () => { root.render(<MemberQuickActions member={member} actions={["call", "message"]} />); });
  expect(host.querySelector('a[aria-label="Call member Jane"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="Open in-app chat with Jane"]')).not.toBeNull();
  expect(host.querySelector('[aria-label="Send WhatsApp to Jane"]')).toBeNull();
  expect(host.querySelector('[aria-label="Open WhatsApp app for Jane"]')).toBeNull();
});
it("disables unavailable calls and messages without generating invalid links", async () => {
  await act(async () => { root.render(<MemberQuickActions member={{ userId: { name: "No account", phone: "invalid", status: "DISABLED" } }} expanded />); });
  expect(host.querySelector("a")).toBeNull();
  expect([...host.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  expect(host.textContent).toContain("Call");
  expect(host.textContent).toContain("Message");
});
it("opens only the WhatsApp composer using the authorized normalized phone", async () => {
  const rowClick = vi.fn();
  await act(async () => { root.render(<div onClick={rowClick}><MemberQuickActions member={member} expanded /></div>); });
  const link = host.querySelector<HTMLAnchorElement>('a[aria-label="Open WhatsApp app for Jane"]')!;
  expect(link.href).toBe("https://wa.me/919876543210");
  expect(link.rel).toContain("noopener");
  await act(async () => { link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });
  expect(rowClick).not.toHaveBeenCalled();
  expect(mocks.request).not.toHaveBeenCalled();
});
it("opens a tenant-authorized business API conversation separately from the external app", async () => {
  mocks.request.mockResolvedValue({ data: { publicId: "wa-thread" } });
  await act(async () => { root.render(<MemberQuickActions member={member} expanded />); });
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Send WhatsApp to Jane"]')!;
  await act(async () => { button.click(); });
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/whatsapp/gym/members/member-public-id/conversation",
    { method: "POST", body: "{}" },
  );
  expect(mocks.navigate).toHaveBeenCalledWith("/messages?channel=whatsapp&conversation=wa-thread");
});
it("deduplicates fast clicks, stops row navigation, and opens the exact existing conversation", async () => {
  let resolve!: (value: any) => void;
  mocks.request.mockReturnValue(new Promise(value => { resolve = value; }));
  const rowClick = vi.fn(), rowDouble = vi.fn();
  await act(async () => { root.render(<div onClick={rowClick} onDoubleClick={rowDouble}><MemberQuickActions member={member} /></div>); });
  const button = host.querySelector('button[aria-label="Open in-app chat with Jane"]')!;
  await act(async () => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({ type: "DIRECT", participantIds: ["registered-user"] });
  expect(rowClick).not.toHaveBeenCalled(); expect(rowDouble).not.toHaveBeenCalled();
  await act(async () => { resolve({ data: { publicId: "existing-thread" } }); });
  expect(mocks.navigate).toHaveBeenCalledWith("/messages/existing-thread", {
    state: {
      returnTo: "/owner/members?page=2",
      returnLabel: "Back",
    },
  });
});
it("opens a protected activation conversation for a pending owner member", async () => {
  mocks.request.mockResolvedValue({ data: { publicId: "activation-thread", pendingActivation: true } });
  const pending = {
    publicId: "pending-member",
    status: "INACTIVE",
    invitation: { status: "PENDING" },
    contact: { name: "Invited member", phone: "+919999999999" },
  };
  await act(async () => {
    root.render(<MemberQuickActions member={pending} actions={["message"]} ownerMember />);
  });
  const button = host.querySelector<HTMLButtonElement>('button[title="Open in-app chat"]')!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(mocks.request).toHaveBeenCalledWith(
    "/api/v1/owner/members/pending-member/communication/in-app",
    { method: "POST", body: "{}" },
  );
  expect(mocks.navigate).toHaveBeenCalledWith("/messages/activation-thread", {
    state: {
      returnTo: "/owner/members?page=2",
      returnLabel: "Back to members",
    },
  });
});
it("shows a server authorization error without navigating", async () => {
  mocks.request.mockRejectedValue(new Error("This member no longer belongs to your gym."));
  await act(async () => { root.render(<MemberQuickActions member={member} />); });
  await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("no longer belongs");
  expect(mocks.navigate).not.toHaveBeenCalled();
});
