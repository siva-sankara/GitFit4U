// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn() }));
vi.mock("../services/apiClient", () => ({ apiRequest: mocks.request }));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
import { MemberQuickActions } from "./MemberQuickActions";
let host: HTMLDivElement, root: Root;
const member = { userId: { _id: "registered-user", name: "Jane", phone: "9876543210", status: "ACTIVE" }, contact: { phone: "9111111111" } };
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("calls the registered number rather than an editable tenant phone", async () => {
  await act(async () => { root.render(<MemberQuickActions member={member} />); });
  expect(host.querySelector("a")?.getAttribute("href")).toBe("tel:+919876543210");
});
it("disables unavailable calls and messages without generating invalid links", async () => {
  await act(async () => { root.render(<MemberQuickActions member={{ userId: { name: "No account", phone: "invalid", status: "DISABLED" } }} expanded />); });
  expect(host.querySelector("a")).toBeNull();
  expect([...host.querySelectorAll("button")].every(button => button.disabled)).toBe(true);
  expect(host.textContent).toContain("Call");
  expect(host.textContent).toContain("Message");
});
it("deduplicates fast clicks, stops row navigation, and opens the exact existing conversation", async () => {
  let resolve!: (value: any) => void;
  mocks.request.mockReturnValue(new Promise(value => { resolve = value; }));
  const rowClick = vi.fn(), rowDouble = vi.fn();
  await act(async () => { root.render(<div onClick={rowClick} onDoubleClick={rowDouble}><MemberQuickActions member={member} /></div>); });
  const button = host.querySelector('button[aria-label="Message Jane"]')!;
  await act(async () => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); button.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
  expect(mocks.request).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mocks.request.mock.calls[0][1].body)).toEqual({ type: "DIRECT", participantIds: ["registered-user"] });
  expect(rowClick).not.toHaveBeenCalled(); expect(rowDouble).not.toHaveBeenCalled();
  await act(async () => { resolve({ data: { publicId: "existing-thread" } }); });
  expect(mocks.navigate).toHaveBeenCalledWith("/messages/existing-thread");
});
it("shows a server authorization error without navigating", async () => {
  mocks.request.mockRejectedValue(new Error("This member no longer belongs to your gym."));
  await act(async () => { root.render(<MemberQuickActions member={member} />); });
  await act(async () => { (host.querySelector("button") as HTMLButtonElement).click(); });
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("no longer belongs");
  expect(mocks.navigate).not.toHaveBeenCalled();
});
