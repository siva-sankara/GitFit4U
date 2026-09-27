import { beforeEach, describe, expect, it, vi } from "vitest";
const queries = vi.hoisted(() => ({
  projection: vi.fn(),
  save: vi.fn(),
  event: vi.fn(),
  aggregate: vi.fn(),
}));
vi.mock("../models/Attendance.js", () => ({
  AttendanceEvent: { findOne: queries.event, aggregate: queries.aggregate },
  StreakProjection: {
    findOne: queries.projection,
    findOneAndUpdate: queries.save,
  },
}));
vi.mock("../models/Social.js", () => ({ SocialStory: {} }));
import {
  globalStreak,
  localDay,
  storyExpiry,
  summarizeStreak,
  STORY_DURATION_MS,
  clearStreakCalculationCache,
} from "./socialService.js";
describe("stories and real attendance streak semantics", () => {
  it("expires exactly 25 hours after server creation across DST changes", () => {
    const created = new Date("2026-11-01T00:30:00-04:00");
    expect(storyExpiry(created).getTime() - created.getTime()).toBe(
      STORY_DURATION_MS,
    );
    expect(STORY_DURATION_MS).toBe(25 * 3600000);
  });
  it("deduplicates multiple gyms on the same day, sorts dates and excludes future events", () => {
    expect(
      summarizeStreak(
        ["2026-09-03", "2026-09-01", "2026-09-02", "2026-09-02", "2026-09-20"],
        "2026-09-03",
      ),
    ).toEqual({
      currentStreak: 3,
      longestStreak: 3,
      lastAttendanceDate: "2026-09-03",
      totalVisits: 3,
    });
  });
  it("keeps yesterday's streak alive, then resets current but retains the longest", () => {
    const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
    expect(summarizeStreak(days, "2026-09-04").currentStreak).toBe(3);
    expect(summarizeStreak(days, "2026-09-05")).toMatchObject({
      currentStreak: 0,
      longestStreak: 3,
    });
  });
  it("counts no activity for opening a profile without attendance", () =>
    expect(summarizeStreak([], "2026-09-01")).toMatchObject({
      currentStreak: 0,
      longestStreak: 0,
      totalVisits: 0,
    }));
  it("uses the user's timezone at midnight", () => {
    const date = new Date("2026-09-01T20:00:00Z");
    expect(localDay(date, "Asia/Kolkata")).toBe("2026-09-02");
    expect(localDay(date, "America/New_York")).toBe("2026-09-01");
  });
  it("does not bridge gaps or accept impossible calendar days", () => {
    expect(summarizeStreak(["2026-09-01", "2026-09-03", "2026-02-30", "invalid"], "2026-09-03")).toMatchObject({ currentStreak: 1, longestStreak: 1, totalVisits: 2 });
  });
});
describe("streak upsert races and migration failures", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clearStreakCalculationCache();
    queries.event.mockReturnValue({
      sort: () => ({ select: () => ({ lean: async () => null }) }),
    });
    queries.aggregate.mockReturnValue({
      cursor: () =>
        (async function* () {
          yield { _id: "2026-09-01" };
        })(),
    });
    queries.save.mockReturnValue({
      lean: async () => {
        throw Object.assign(new Error("Duplicate key"), { code: 11000 });
      },
    });
  });
  it("returns a winning concurrent projection only when it exists for this user", async () => {
    const winner = { userId: "507f1f77bcf86cd799439011", currentStreak: 1, calculationVersion: 2, timezone: "UTC" };
    queries.projection
      .mockReturnValueOnce({ lean: async () => null })
      .mockReturnValueOnce({ lean: async () => winner });
    expect(
      await globalStreak(
        winner.userId,
        "UTC",
        new Date("2026-09-01T12:00:00Z"),
      ),
    ).toEqual(winner);
  });
  it("serves calculated attendance without modifying the legacy index when its cache write is blocked", async () => {
    queries.projection.mockReturnValue({ lean: async () => null });
    await expect(
      globalStreak(
        "507f1f77bcf86cd799439011",
        "UTC",
        new Date("2026-09-01T12:00:00Z"),
      ),
    ).resolves.toMatchObject({
      currentStreak: 1,
      longestStreak: 1,
      totalVisits: 1,
      lastAttendanceDate: "2026-09-01",
    });
  });
  it("bounds repeated legacy fallback work with a short cache invalidated by a new attendance event", async () => {
    queries.projection.mockReturnValue({ lean: async () => null });
    const userId = "507f1f77bcf86cd799439018", now = new Date("2026-09-01T12:00:00Z");
    await globalStreak(userId, "UTC", now);
    await globalStreak(userId, "UTC", new Date(now.getTime() + 5000));
    expect(queries.aggregate).toHaveBeenCalledTimes(1);
    queries.event.mockReturnValue({ sort: () => ({ select: () => ({ lean: async () => ({ _id: "new-correction", createdAt: now, occurredAt: now }) }) }) });
    await globalStreak(userId, "UTC", new Date(now.getTime() + 6000));
    expect(queries.aggregate).toHaveBeenCalledTimes(2);
  });
});
