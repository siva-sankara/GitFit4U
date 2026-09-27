import { afterEach, expect, it, vi } from "vitest";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { AttendanceEvent, StreakProjection } from "../models/Attendance.js";
import { attendanceMonthRange, attendanceOverview } from "./attendanceHistoryService.js";
vi.mock("./socialService.js", async (original) => ({ ...await original<any>(), globalStreak: vi.fn(async () => ({ currentStreak: 3, longestStreak: 8, totalVisits: 21, lastAttendanceDate: "2026-09-03", lastCheckIn: new Date("2026-09-03T20:00:00Z") })) }));
const userId = "507f1f77bcf86cd799439011", now = new Date("2026-09-03T22:00:00Z");
function chain(value: unknown) {
  const result: any = { lean: vi.fn().mockResolvedValue(value) };
  for (const key of ["select", "populate", "sort", "skip", "limit"]) result[key] = vi.fn().mockReturnValue(result);
  return result;
}
afterEach(() => vi.restoreAllMocks());
it("uses real local-month UTC boundaries including daylight saving", () => {
  expect(attendanceMonthRange("2026-03", "America/New_York")).toEqual({ $gte: new Date("2026-03-01T05:00:00Z"), $lt: new Date("2026-04-01T04:00:00Z") });
  expect(() => attendanceMonthRange("2026-13", "UTC")).toThrow();
  expect(() => attendanceMonthRange("0000-01", "UTC")).toThrow();
});
it("keeps history paginated and owner-scoped while returning a distinct monthly summary", async () => {
  vi.spyOn(User, "findById").mockReturnValue(chain({ social: { timezone: "America/New_York" } }));
  const events = chain([{ _id: "event-id", publicId: "event", type: "CHECK_IN", occurredAt: new Date("2026-09-01T03:00:00Z"), gymId: { name: "Gym one" } }]);
  vi.spyOn(AttendanceEvent, "find").mockReturnValue(events);
  vi.spyOn(AttendanceEvent, "countDocuments").mockResolvedValue(47);
  vi.spyOn(AttendanceEvent, "aggregate").mockResolvedValue([{ _id: "2026-09-01" }, { _id: "2026-09-02" }, { _id: "2026-09-03" }]);
  vi.spyOn(AttendanceEvent, "distinct").mockResolvedValue(["event-id"]);
  vi.spyOn(MemberProfile, "distinct").mockResolvedValue([]);
  vi.spyOn(StreakProjection, "find").mockReturnValue(chain([]));
  const result = await attendanceOverview(userId, { month: "2026-09", page: "2", limit: "20" }, now);
  expect(AttendanceEvent.find).toHaveBeenCalledWith({ userId, occurredAt: { $lte: now } });
  expect(events.skip).toHaveBeenCalledWith(20); expect(events.limit).toHaveBeenCalledWith(20);
  expect(result.meta).toMatchObject({ page: 2, total: 47, pages: 3 });
  expect(result.data.summary).toMatchObject({ timezone: "America/New_York", today: "2026-09-03", month: "2026-09", monthlyAttendance: 3, currentStreak: 3, totalAttendance: 21 });
  expect(result.data.events[0]).toMatchObject({ date: "2026-08-31", status: "CORRECTED", gymId: { name: "Gym one" } });
  const stages = vi.mocked(AttendanceEvent.aggregate).mock.calls[0][0]!;
  expect(stages[0]).toMatchObject({ $match: { type: "CHECK_IN", occurredAt: { $gte: new Date("2026-09-01T04:00:00Z"), $lt: new Date("2026-10-01T04:00:00Z"), $lte: now } } });
  expect(stages).toContainEqual({ $match: { "invalidations.0": { $exists: false } } });
});
it("rejects an invalid timezone before attendance queries", async () => {
  vi.spyOn(User, "findById").mockReturnValue(chain({ social: { timezone: "UTC" } }));
  vi.spyOn(AttendanceEvent, "find");
  await expect(attendanceOverview(userId, { timezone: "not/a-timezone" }, now)).rejects.toMatchObject({ code: "TIMEZONE_INVALID" });
  expect(AttendanceEvent.find).not.toHaveBeenCalled();
});
