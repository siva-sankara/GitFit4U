import mongoose from "mongoose";
import { AttendanceEvent, StreakProjection } from "../models/Attendance.js";
import { SocialStory } from "../models/Social.js";
import { AppError } from "../utils/AppError.js";
export const STORY_DURATION_MS = 25 * 60 * 60 * 1000;
export function storyExpiry(createdAt: Date) {
  return new Date(createdAt.getTime() + STORY_DURATION_MS);
}
export function localDay(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}
export function summarizeStreak(days: string[], today: string) {
  let currentStreak = 0,
    longestStreak = 0,
    lastAttendanceDate: string | undefined;
  const validDays = [...new Set(days.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day))].sort();
  for (const day of validDays) {
    if (day > today) continue;
    currentStreak =
      lastAttendanceDate &&
      Date.parse(day) - Date.parse(lastAttendanceDate) === 86400000
        ? currentStreak + 1
        : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    lastAttendanceDate = day;
  }
  if (
    !lastAttendanceDate ||
    Date.parse(today) - Date.parse(lastAttendanceDate) > 86400000
  )
    currentStreak = 0;
  return {
    currentStreak,
    longestStreak,
    lastAttendanceDate,
    totalVisits: validDays.filter((day) => day <= today).length,
  };
}
/** A correction invalidates its original check-in; it never invents a new visit. */
export function validAttendanceStages(userId: string, now: Date, range: Record<string, Date> = {}): mongoose.PipelineStage[] {
  return [
    { $match: { userId: new mongoose.Types.ObjectId(userId), type: "CHECK_IN", occurredAt: { ...range, $lte: now } } },
    { $lookup: { from: AttendanceEvent.collection?.name || "attendanceevents", let: { original: "$_id", user: "$userId" }, pipeline: [
      { $match: { type: "CORRECTION", occurredAt: { $lte: now }, $expr: { $and: [{ $eq: ["$supersedesEventId", "$$original"] }, { $eq: ["$userId", "$$user"] }] } } },
      { $limit: 1 }, { $project: { _id: 1 } },
    ], as: "invalidations" } },
    { $match: { "invalidations.0": { $exists: false } } },
  ];
}
const streakCache = new Map<string, { at: number; value: any }>();
export function clearStreakCalculationCache() { streakCache.clear(); }
export async function globalStreak(
  userId: string,
  timezone = "Asia/Kolkata",
  now = new Date(),
) {
  const today = localDay(now, timezone);
  const [projection, latest] = await Promise.all([
    StreakProjection.findOne({ scope: "USER", userId }).lean(),
    AttendanceEvent.findOne({
      userId,
      type: { $in: ["CHECK_IN", "CORRECTION"] },
      occurredAt: { $lte: now },
    })
      .sort({ createdAt: -1, _id: -1 })
      .select("_id createdAt occurredAt")
      .lean(),
  ]);
  const source = String(latest?._id || ""), key = `${userId}:${timezone}:${today}:${source}`;
  const cached = streakCache.get(key);
  if (cached && cached.at <= now.getTime() && now.getTime() - cached.at < 60_000) return cached.value;
  if (
    projection?.calculationVersion === 2 &&
    String(projection.sourceEventId || "") === source &&
    projection?.timezone === timezone &&
    projection.calculatedAt &&
    new Date(projection.calculatedAt).getTime() <= now.getTime() &&
    now.getTime() - new Date(projection.calculatedAt).getTime() < 60_000 &&
    localDay(projection.calculatedAt, timezone) === today &&
    (!latest ||
      projection.calculatedAt >= (latest.createdAt || latest.occurredAt))
  )
    return projection;
  // Group in MongoDB, then stream one row per qualifying local day, not every event.
  const cursor = AttendanceEvent.aggregate([
    ...validAttendanceStages(userId, now),
    {
      $group: {
        _id: {
          $dateToString: { date: "$occurredAt", format: "%Y-%m-%d", timezone },
        },
        lastCheckIn: { $max: "$occurredAt" },
      },
    },
    { $sort: { _id: 1 } },
  ]).cursor({ batchSize: 365 });
  let currentStreak = 0,
    longestStreak = 0,
    totalVisits = 0,
    lastAttendanceDate: string | undefined,
    lastCheckIn: Date | undefined;
  for await (const row of cursor) {
    const day = String(row._id);
    currentStreak =
      lastAttendanceDate &&
      Date.parse(day) - Date.parse(lastAttendanceDate) === 86400000
        ? currentStreak + 1
        : 1;
    longestStreak = Math.max(longestStreak, currentStreak);
    lastAttendanceDate = day;
    lastCheckIn = row.lastCheckIn;
    totalVisits++;
  }
  if (
    !lastAttendanceDate ||
    Date.parse(today) - Date.parse(lastAttendanceDate) > 86400000
  )
    currentStreak = 0;
  const values = {
    currentStreak,
    longestStreak,
    totalVisits,
    lastAttendanceDate,
    lastCheckIn,
    calculatedAt: now,
    timezone,
    calculationVersion: 2,
    sourceEventId: latest?._id,
  };
  const remember = (value: any) => {
    if (streakCache.size >= 500) streakCache.delete(streakCache.keys().next().value!);
    streakCache.set(key, { at: now.getTime(), value });
    return value;
  };
  try {
    return remember(await StreakProjection.findOneAndUpdate(
      { scope: "USER", userId },
      { $set: values },
      { upsert: true, returnDocument: "after", runValidators: true },
    ).lean());
  } catch (error: any) {
    if (error.code !== 11000) throw error;
    const winner = await StreakProjection.findOne({
      scope: "USER",
      userId,
    }).lean();
    if (winner?.calculationVersion === 2 && winner.timezone === timezone && String(winner.sourceEventId || "") === source) return remember(winner);
    // A legacy projection index may reject a second USER cache row. The real
    // attendance calculation remains authoritative; never mutate that index or
    // return an invented zero. A bounded short-lived cache avoids repeated work.
    return remember({ scope: "USER", userId, ...values });
  }
}
export async function cleanupExpiredStories({
  limit = 100,
  now = new Date(),
}: { limit?: number; now?: Date } = {}) {
  const rows = await SocialStory.find({
    expiresAt: { $lte: now },
    archivedAt: null,
  })
    .sort({ expiresAt: 1 })
    .limit(Math.max(1, Math.min(limit, 500)))
    .select("_id")
    .lean();
  if (!rows.length) return 0;
  const result = await SocialStory.updateMany(
    {
      _id: { $in: rows.map((row) => row._id) },
      archivedAt: null,
      expiresAt: { $lte: now },
    },
    { $set: { archivedAt: now } },
  );
  return result.modifiedCount;
}
