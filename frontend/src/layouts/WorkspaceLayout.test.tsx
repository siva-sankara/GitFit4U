// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  request: vi.fn(),
  setToken: vi.fn(),
  toast: null as string | null,
  toastActionUrl: undefined as string | undefined,
  dismissToast: vi.fn(),
}));
vi.mock("../api/hooks", () => ({
  useCurrentUser: mocks.me,
  useNotifications: () => ({
    data: { data: [{ _id: "unread" }, { _id: "read", readAt: "2026-01-01" }] },
  }),
}));
vi.mock("../context/AppContext", () => ({
  useApp: () => ({
    theme: "light",
    themePreference: "light",
    setThemePreference: vi.fn(),
    toggleTheme: vi.fn(),
    toast: mocks.toast,
    toastActionUrl: mocks.toastActionUrl,
    dismissToast: mocks.dismissToast,
  }),
}));
vi.mock("../services/apiClient", () => ({
  apiRequest: mocks.request,
  setAccessToken: mocks.setToken,
}));
import { WorkspaceLayout } from "./WorkspaceLayout";
let host: HTMLDivElement, root: Root, client: QueryClient;
function session(
  role = "GYM_OWNER",
  permissions = [
    "gym:read",
    "gym:update",
    "member:read",
    "finance:read",
    "campaign:write",
  ],
) {
  mocks.me.mockReturnValue({
    data: {
      data: {
        user: {
          name: "Asha Kumar",
          roles: ["USER", "GYM_OWNER"],
          activeRole: "USER",
        },
        context: { role, permissions, gymId: "gym" },
        assignments: [{ role, gymId: { _id: "gym", name: "Asha Fitness" } }],
      },
    },
  });
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  mocks.toast = null;
  mocks.toastActionUrl = undefined;
  session();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render() {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/owner/members"]}>
          <Routes>
            <Route element={<WorkspaceLayout />}>
              <Route path="/owner/members" element={<p>Member list</p>} />
              <Route path="/profile" element={<p>Profile details</p>} />
              <Route path="/messages/conversation_123" element={<p>Exact message thread</p>} />
            </Route>
            <Route path="/login" element={<p>Login screen</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
}
it("uses the session role, removes role switching and duplicate/hidden owner items", async () => {
  await render();
  const nav = host.querySelector('[aria-label="Workspace navigation"]')!;
  expect(nav.textContent).toContain("Members");
  expect(nav.textContent).toContain("Gym Profile Settings");
  expect(nav.querySelectorAll('[href="/owner/gym-profile"]')).toHaveLength(1);
  expect(nav.querySelector('[href="/owner/settings"]')).toBeNull();
  expect(nav.querySelector('[href="/owner/profile"]')).toBeNull();
  expect(nav.textContent).not.toContain("Campaigns");
  expect(nav.textContent).not.toContain("Invoices");
  expect(host.querySelectorAll('.theme-icon-picker')).toHaveLength(1);
  expect(host.querySelector('button[aria-label="Switch to dark mode"]')).not.toBeNull();
  expect(host.querySelector('button[aria-label="System theme"]')).toBeNull();
  expect(host.querySelector('select[aria-label="Active role"]')).toBeNull();
  expect(host.textContent).toContain("Gym owner");
});
it("offers an accessible foreground notification link to the exact conversation and dismiss action", async () => {
  mocks.toast = "New message";
  mocks.toastActionUrl = "/messages/conversation_123";
  await render();
  const toast = host.querySelector('[role="status"].toast')!;
  expect(toast.textContent).toContain("New message");
  expect(toast.querySelector('[aria-label="Dismiss notification"]')).not.toBeNull();
  const link = toast.querySelector<HTMLAnchorElement>("a")!;
  expect(link.textContent).toBe("Open notification");
  expect(link.getAttribute("href")).toBe("/messages/conversation_123");
  await act(async () => link.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 })));
  expect(host.textContent).toContain("Exact message thread");
  expect(mocks.dismissToast).toHaveBeenCalledTimes(1);
});
it("opens the canonical profile when the user's name is clicked", async () => {
  await render();
  const link = host.querySelector<HTMLAnchorElement>("a.topbar-profile")!;
  expect(link.textContent).toContain("Asha Kumar");
  expect(link.getAttribute("href")).toBe("/profile");
  await act(async () =>
    link.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    ),
  );
  expect(host.textContent).toContain("Profile details");
  expect(host.querySelector(".topbar-title")?.textContent).toContain(
    "Asha Fitness",
  );
});
it("shows only permitted navigation for staff and an unread notification badge", async () => {
  session("GYM_STAFF", ["gym:read", "member:read"]);
  await render();
  const nav = host.querySelector('[aria-label="Workspace navigation"]')!;
  expect(nav.textContent).toContain("Dashboard");
  expect(nav.textContent).not.toContain("Payments");
  expect(nav.textContent).not.toContain("Revenue");
  expect(host.querySelector(".workspace-unread-count")?.textContent).toBe("1");
});
it("closes mobile navigation using Escape", async () => {
  await render();
  await act(async () =>
    host.querySelector<HTMLButtonElement>('[aria-label="Open menu"]')!.click(),
  );
  expect(host.querySelector(".drawer-open")).not.toBeNull();
  await act(async () =>
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
  );
  expect(host.querySelector(".drawer-open")).toBeNull();
});
it("keeps User mobile tabs in the exact required order and account features inside Profile", async () => {
  session("USER", []);
  await render();
  const tabs = [...host.querySelectorAll('.mobile-bottom-nav a')];
  expect(tabs.map(tab => tab.textContent)).toEqual(["Home", "Book", "Scan", "Profile", "Messages"]);
  expect(tabs.map(tab => tab.getAttribute("href"))).toEqual(["/app/home", "/app/classes", "/app/attendance/qr", "/app/profile", "/app/messages"]);
  const nav = host.querySelector('[aria-label="Workspace navigation"]')!;
  for (const removed of ["Favorites", "Payments", "Invoices", "Workouts", "Subscriptions", "Referrals"]) expect(nav.textContent).not.toContain(removed);
});
it("removes the registration sidebar entry even when the account has owner capabilities", async () => {
  session("USER", []);
  const member = mocks.me();
  member.data.data.user.roles = ["USER"];
  mocks.me.mockReturnValue(member);
  await render();
  expect(host.querySelector('a[href="/register-gym"]')).toBeNull();
  member.data.data.user.roles.push("GYM_OWNER");
  await render();
  expect(host.querySelector('a[href="/register-gym"]')).toBeNull();
});
it("clears the authenticated token only after successful logout and replaces with login", async () => {
  mocks.request.mockResolvedValue(undefined);
  await render();
  await act(async () => {
    host.querySelector<HTMLButtonElement>('[aria-label="Log out"]')!.click();
      await new Promise((resolve) => { setTimeout(resolve, 25); });
  });
  expect(mocks.request).toHaveBeenCalledWith("/api/v1/auth/logout", {
    method: "POST",
  });
  expect(mocks.setToken).toHaveBeenCalledWith(null);
  expect(host.textContent).toContain("Login screen");
});
