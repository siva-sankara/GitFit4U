// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  role: "GYM_OWNER",
  permissions: ["member:read", "finance:read"],
}));
vi.mock("../../services/apiClient", () => ({
  apiRequest: mocks.request,
  setAccessToken: vi.fn(),
  getAccessToken: () => "token",
}));
vi.mock("../../api/hooks", () => ({
  useCurrentUser: () => ({
    data: {
      data: {
        user: { name: "Gym team" },
        context: { role: mocks.role, permissions: mocks.permissions },
      },
    },
  }),
}));
import { LiveWorkspace } from "./LiveWorkspace";
let host: HTMLDivElement, root: Root, client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = "GYM_OWNER";
  mocks.permissions = ["member:read", "finance:read"];
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mocks.request.mockImplementation((path: string) =>
    Promise.resolve({
      success: true,
      data:
        path === "/api/v1/owner/dashboard"
          ? { gymStatus: "ACTIVE", totalMembers: 1 }
          : path.startsWith("/api/v1/owner/members?")
            ? [
                {
                  _id: "member-id",
                  publicId: "member-public",
                  memberCode: "MEM-001",
                  userId: { name: "Member One", phone: "9876501234" },
                  currentSubscriptionId: {
                    status: "ACTIVE",
                    planSnapshot: { name: "Monthly" },
                    latestPaymentId: { status: "CAPTURED" },
                  },
                  attendanceVisits30Days: 8,
                  status: "ACTIVE",
                },
              ]
            : path === "/api/v1/owner/plans" ||
                path === "/api/v1/owner/trainers"
              ? []
              : {},
    }),
  );
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  host.remove();
});
async function render(path: string) {
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <LiveWorkspace />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  for (let i = 0; i < 10; i++)
    await act(async () => {
      await new Promise((resolve) => { setTimeout(resolve, 15); });
    });
}
it("restores owner member membership, visits, payment and join columns from API records", async () => {
  await render("/owner/members");
  expect(
    [...host.querySelectorAll("th")].map((cell) => cell.textContent),
  ).toEqual([
    "Member",
    "Member code",
    "Phone",
    "Membership",
    "Expires",
    "Visits (30 days)",
    "Payment",
    "Joined",
    "Actions",
  ]);
  expect(host.textContent).toContain("Member One");
  expect(host.textContent).toContain("Captured");
  expect(host.textContent).toContain("Trainer: Not assigned");
  expect(
    host.querySelector(
      'button[aria-label="Membership status: Active. Monthly"]',
    ),
  ).not.toBeNull();
  expect(
    host.querySelector('select[aria-label="Membership plan"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('select[aria-label="Assigned trainer"]'),
  ).not.toBeNull();
  expect(
    host.querySelector('a[href="/owner/members/member-public"]'),
  ).not.toBeNull();
  expect(host.querySelector('a[aria-label^="Call "]')).not.toBeNull();
  expect(host.querySelector('button[aria-label^="Message "]')).not.toBeNull();
});
it("omits the finance column for restricted staff", async () => {
  mocks.role = "GYM_STAFF";
  mocks.permissions = ["member:read"];
  await render("/owner/members");
  expect(
    [...host.querySelectorAll("th")].some(
      (cell) => cell.textContent === "Payment",
    ),
  ).toBe(false);
});
it("uses a compact gym status label and badge instead of an oversized heading", async () => {
  await render("/owner/dashboard");
  expect(host.querySelector(".owner-status-card h2")?.textContent).toBe(
    "Gym status",
  );
  expect(
    host.querySelector(".owner-status-card .status-badge")?.textContent,
  ).toBe("Active");
});
it("loads the nonfinancial staff dashboard without forbidden summary or scanner requests", async () => {
  mocks.role = "GYM_STAFF";
  mocks.permissions = ["member:read"];
  await render("/owner/dashboard");
  expect(
    mocks.request.mock.calls.some(
      ([path]) => path === "/api/v1/workspace/summary",
    ),
  ).toBe(false);
  expect(
    mocks.request.mock.calls.some(
      ([path]) => path === "/api/v1/owner/dashboard",
    ),
  ).toBe(true);
  expect(host.querySelector('a[href="/owner/scanner"]')).toBeNull();
  expect(host.querySelector('a[href="/owner/members"]')).not.toBeNull();
});
it("shows the scanner shortcut only when the active role has attendance:scan", async () => {
  mocks.role = "GYM_STAFF";
  mocks.permissions = ["gym:read", "attendance:scan"];
  await render("/owner/dashboard");
  expect(host.querySelector('a[href="/owner/scanner"]')).not.toBeNull();
  expect(host.querySelector('a[href="/owner/members"]')).toBeNull();
});
