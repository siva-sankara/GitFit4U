// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AttendanceCalendar, shiftMonth, type AttendanceSummary } from "./AttendancePage";
let host: HTMLDivElement, root: Root;
const summary: AttendanceSummary = { month: "2026-09", timezone: "Asia/Kolkata", today: "2026-09-03", currentStreak: 3, longestStreak: 8, totalAttendance: 21, monthlyAttendance: 3, attendedDays: ["2026-09-01", "2026-09-02", "2026-09-03"], lastAttendanceDate: "2026-09-03", lastCheckIn: "2026-09-03T10:00:00Z" };
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); host = document.createElement("div"); document.body.append(host); root = createRoot(host); });
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });
it("navigates across year boundaries with canonical months", () => {
  expect(shiftMonth("2026-01", -1)).toBe("2025-12"); expect(shiftMonth("2026-12", 1)).toBe("2027-01");
});
it("marks unique attended dates, today, and future dates accessibly", async () => {
  const onMonth = vi.fn();
  await act(async () => root.render(<MemoryRouter><AttendanceCalendar summary={summary} onMonth={onMonth} /></MemoryRouter>));
  expect(host.querySelectorAll(".calendar-day.attended")).toHaveLength(3);
  expect(host.querySelector('.calendar-day[aria-current="date"]')?.getAttribute("datetime")).toBe("2026-09-03");
  expect(host.querySelectorAll(".calendar-day.future").length).toBeGreaterThan(0);
  expect((host.querySelector('button[aria-label="Next month"]') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => { (host.querySelector('button[aria-label="Previous month"]') as HTMLButtonElement).click(); });
  expect(onMonth).toHaveBeenCalledWith("2026-08");
});
