// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ role: "USER" }));
vi.mock("../../api/hooks", () => ({ useCurrentUser: () => ({ data: { data: { user: { name: "Test member" }, context: { role: mocks.role, permissions: ["finance:read"] } } } }) }));
vi.mock("./LiveData", async importOriginal => {
  const actual = await importOriginal<typeof import("./LiveData")>();
  return { ...actual, useData: (url: string) => ({ isPending: false, isError: false, data: { data: url.includes("summary") ? { activeSubscriptions: 2, unreadNotifications: 3, totalPaidMinor: 990000, payments: 9, revenue: [], visits: [] } : { capturedPaymentsMinor: 120000 } } }) };
});
vi.mock("../user/AttendancePage", () => ({ AttendancePage: () => null, StreakKpi: () => <p>Attendance streak</p> }));
vi.mock("../../components/PromotionPlacement", () => ({ PromotionPlacement: () => null }));
vi.mock("../../services/apiClient", () => ({
  getAccessToken: () => "test", setAccessToken: vi.fn(),
  apiRequest: async (url: string) => ({ success: true, data: url.includes("summary") ? { activeSubscriptions: 2, unreadNotifications: 3, totalPaidMinor: 990000, payments: 9, revenue: [], visits: [] } : url.includes("dashboard") ? { capturedPaymentsMinor: 120000 } : url.includes("attendance") ? { summary: { currentStreak: 1, longestStreak: 3, monthlyAttendance: 4, totalAttendance: 5 }, records: [] } : [] }),
}));
import { LiveWorkspace } from "./LiveWorkspace";
it.each(["USER", "ADMIN"])("keeps attendance while scoping payment metrics to authorized management: %s", async role => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.role = role;
  const host = document.createElement("div"), root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[role === "USER" ? "/app/home" : "/admin/dashboard"]}><LiveWorkspace /></MemoryRouter></QueryClientProvider>));
    expect(host.textContent).toContain("Daily check-ins");
    if (role === "USER") {
      expect(host.textContent).toContain("Active Subscriptions");
      expect(host.textContent).not.toMatch(/total paid/i);
      expect([...host.querySelectorAll(".metric-tile span")].map(node => node.textContent)).not.toContain("Payments");
      expect(host.textContent).not.toContain("Gross captured payments");
      expect([...host.querySelectorAll("h2")].map(node => node.textContent)).not.toContain("Payments");
      expect(host.querySelectorAll(".dashboard-chart-grid .chart-card")).toHaveLength(1);
    } else {
      expect(host.textContent).toContain("Gross captured payments");
      expect(host.textContent).toContain("Captured Payments");
      expect(host.querySelectorAll(".dashboard-chart-grid .chart-card")).toHaveLength(2);
    }
  } finally { await act(async () => root.unmount()); client.clear(); }
});
