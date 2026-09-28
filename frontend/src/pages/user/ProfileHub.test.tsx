// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
vi.mock("../live/LiveData", () => ({
  useData: (path: string) => ({ data: { data: path.includes("subscriptions") ? [{ status: "ACTIVE", gymId: { name: "Local Fitness" }, planSnapshot: { name: "Monthly" } }] : path.includes("attendance") ? { summary: { currentStreak: 3, longestStreak: 7, monthlyAttendance: 9, totalAttendance: 30 } } : { name: "Sam", social: { bio: "Getting stronger" } } } }),
  QueryState: ({ children }: any) => children,
  ResourcePage: ({ title }: any) => <p>{title}</p>, Action: () => null,
}));
vi.mock("./UserClassesPage", () => ({ UserClassesPage: () => <p>Existing classes and booking actions</p> }));
vi.mock("./ProfileEditor", () => ({ ProfileEditor: () => <p>Profile editor</p> }));
vi.mock("../../components/ThemePicker", () => ({ ThemePicker: () => <p>Light Dark</p> }));
vi.mock("../../components/PushNotificationSettings", () => ({ PushNotificationSettings: () => null }));
vi.mock("../../components/PwaSettings", () => ({ PwaSettings: () => <p>Install GETFIT4U</p> }));
import { ProfileHub } from "./ProfileHub";
it.each(["", "?section=bookings", "?section=settings", "?section=personal"])("preserves all account sections with focused section rendering: %s", async search => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<MemoryRouter initialEntries={[`/app/profile${search}`]}><ProfileHub /></MemoryRouter>));
    expect([...host.querySelectorAll('.account-section-nav a')].map(link => link.textContent)).toEqual(["Overview", "Membership", "Bookings", "Payments", "Attendance", "Workouts", "Favorites", "Referrals", "Social", "Settings"]);
    expect(host.textContent).toContain("Local Fitness");
    expect(host.textContent).toContain("3 day streak");
    if (search.includes("bookings")) expect(host.textContent).toContain("Existing classes and booking actions");
    if (search.includes("settings")) expect(host.textContent).toContain("Install GETFIT4U");
    if (search.includes("personal")) expect(host.textContent).toContain("Profile editor");
    else expect(host.textContent).not.toContain("Profile editor");
  } finally { await act(async () => root.unmount()); }
});
