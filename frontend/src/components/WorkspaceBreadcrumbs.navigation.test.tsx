// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Link, MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceBreadcrumbs } from "./WorkspaceBreadcrumbs";
import { navigationSessionKey, navigationSessionScope, useMemberListState } from "../services/navigationSession";

let host: HTMLDivElement, root: Root;
const scope = navigationSessionScope({ userId: "user-a", gymId: "gym-a", sessionId: "session-a" })!;
function List({ sessionScope = scope }: { sessionScope?: string }) {
  const [state, update] = useMemberListState(sessionScope);
  return <><h1>Members</h1><output aria-label="List state">{JSON.stringify(state)}</output>
    <button onClick={() => update({ search: "member search", status: "FROZEN", planId: "plan-a", trainerId: "trainer-a", page: 3 })}>Apply filters</button>
    <Link to="/owner/members/member-a">View member</Link></>;
}
function Editor({ fail = false }: { fail?: boolean }) {
  const [open, setOpen] = useState(true);
  return <><h1>Member details</h1>{open && <form aria-label="Member editor" onSubmit={event => { event.preventDefault(); if (!fail) setOpen(false); }}>
    <input aria-label="Member name" defaultValue="Member" /><button type="submit">Save</button><button type="reset">Reset</button>
  </form>}</>;
}
function Location() { const location = useLocation(); return <output aria-label="Current location">{location.pathname + location.search}</output>; }
async function render(path: string, role = "GYM_OWNER", sessionScope = scope, fail = false) {
  await act(async () => root.render(<MemoryRouter initialEntries={[path]}>
    <WorkspaceBreadcrumbs role={role} permissions={["member:read"]} navigationScope={sessionScope} />
    <Location /><Routes>
      <Route path="/owner/members" element={<List sessionScope={sessionScope} />} />
      <Route path="/owner/members/:id" element={<Editor fail={fail} />} />
      <Route path="/owner/dashboard" element={<h1>Dashboard</h1>} />
      <Route path="/app/profile" element={<h1>Profile</h1>} />
    </Routes>
  </MemoryRouter>));
}
const current = () => host.querySelector('[aria-label="Current location"]')!.textContent;
async function click(selector: string) {
  const node = host.querySelector<HTMLElement>(selector)!;
  await act(async () => node.click());
}
async function dirty() { await act(async () => host.querySelector("input")!.dispatchEvent(new Event("input", { bubbles: true }))); }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  vi.spyOn(window, "confirm").mockReturnValue(true);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); sessionStorage.clear(); vi.restoreAllMocks(); });

it("uses a safe parent for a member detail opened directly, without relying on browser history", async () => {
  await render("/owner/members/member-a");
  await click(".workspace-breadcrumb-header>button");
  expect(current()).toBe("/owner/members");
  expect(window.confirm).not.toHaveBeenCalled();
});
it("restores the actual list filters and pagination after details and Back", async () => {
  await render("/owner/members");
  await click('button:not(.btn)');
  const saved = host.querySelector('[aria-label="List state"]')!.textContent;
  expect(saved).toContain('"page":3');
  await click('a[href="/owner/members/member-a"]');
  await click(".workspace-breadcrumb-header>button");
  expect(host.querySelector('[aria-label="List state"]')!.textContent).toBe(saved);
  expect(current()).toBe("/owner/members");
  expect(current()).not.toContain("member search");
});
it("remembers an authorized list URL with filters and rejects a stored off-site destination", async () => {
  await render("/owner/members?status=ACTIVE&page=3");
  await click('a[href="/owner/members/member-a"]');
  expect(host.querySelector('nav[aria-label="Breadcrumb"] a[href="/owner/members?status=ACTIVE&page=3"]')).not.toBeNull();
  await click(".workspace-breadcrumb-header>button");
  expect(current()).toBe("/owner/members?status=ACTIVE&page=3");
  await click('a[href="/owner/members/member-a"]');
  sessionStorage.setItem(navigationSessionKey(scope, "list:/owner/members"), "https://outside.example/steal");
  await click(".workspace-breadcrumb-header>button");
  expect(current()).toBe("/owner/members");
});
it("cancels breadcrumb navigation for unsaved edits and retains protection after failed submission", async () => {
  await render("/owner/members/member-a", "GYM_OWNER", scope, true);
  await dirty();
  await click('button[type="submit"]');
  vi.mocked(window.confirm).mockReturnValue(false);
  await click(".workspace-breadcrumb-header>button");
  expect(current()).toBe("/owner/members/member-a");
  expect(window.confirm).toHaveBeenCalledOnce();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  vi.mocked(window.confirm).mockReturnValue(true);
  await click(".workspace-breadcrumb-header>button");
  expect(current()).toBe("/owner/members");
});
it("does not leave a stale unsaved prompt after a successful form save and close", async () => {
  await render("/owner/members/member-a");
  await dirty();
  await click('button[type="submit"]');
  expect(host.querySelector("form")).toBeNull();
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(false);
  await click(".workspace-breadcrumb-header>button");
  expect(window.confirm).not.toHaveBeenCalled();
  expect(current()).toBe("/owner/members");
});
it("clears dirty state when the form is intentionally reset", async () => {
  await render("/owner/members/member-a"); await dirty();
  await click('button[type="reset"]');
  await click(".workspace-breadcrumb-header>button");
  expect(window.confirm).not.toHaveBeenCalled();
});
it("labels Profile sections and returns to Overview without a remembered-section loop", async () => {
  sessionStorage.setItem(navigationSessionKey(scope, "list:/app/profile"), "/app/profile?section=payments");
  await render("/app/profile?section=payments", "USER");
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe("Payments");
  await click(".workspace-breadcrumb-header>button");
  expect(current()).toBe("/app/profile");
  expect(host.querySelector('[aria-current="page"]')?.textContent).toBe("Profile");
});
it("isolates remembered member search by gym and clears session navigation data on logout", async () => {
  sessionStorage.setItem(navigationSessionKey(scope, "member-list"), JSON.stringify({ search: "private search", page: 2 }));
  const otherScope = navigationSessionScope({ userId: "user-a", gymId: "gym-b", sessionId: "session-a" })!;
  await render("/owner/members", "GYM_OWNER", otherScope);
  expect(host.querySelector('[aria-label="List state"]')!.textContent).not.toContain("private search");
  sessionStorage.setItem("unrelated-preference", "keep");
  window.dispatchEvent(new CustomEvent("gfu-auth", { detail: { changedSession: true, token: null } }));
  expect(sessionStorage.getItem(navigationSessionKey(scope, "member-list"))).toBeNull();
  expect(sessionStorage.getItem("unrelated-preference")).toBe("keep");
});
