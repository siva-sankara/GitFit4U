import { z } from "zod";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { AttendanceEvent, StreakProjection } from "../models/Attendance.js";
import { globalStreak, localDay, validAttendanceStages } from "./socialService.js";
import { zonedDayStart } from "../utils/gymCalendar.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import { AppError } from "../utils/AppError.js";

export function attendanceMonthRange(month: string, timezone: string) {
  z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Choose a month in YYYY-MM format").parse(month);
  const [year, number] = month.split("-").map(Number);
  if (year < 1900 || year > 2100) throw new AppError(422, "MONTH_INVALID", "Choose a supported calendar year.");
  const next = number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
  return { $gte: zonedDayStart(`${month}-01`, timezone), $lt: zonedDayStart(`${next}-01`, timezone) };
}
export async function attendanceOverview(userId: string, query: Record<string, unknown>, now = new Date()) {
  const input = z.object({ month: z.string().optional(), timezone: z.string().max(100).optional() }).parse(query);
  const user = await User.findById(userId).select("social.timezone").lean();
  if (!user) throw new AppError(404, "USER_NOT_FOUND", "Account not found.");
  const timezone = input.timezone || user.social?.timezone || "Asia/Kolkata";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }).format(now); }
  catch { throw new AppError(422, "TIMEZONE_INVALID", "Choose a valid IANA timezone."); }
  const today = localDay(now, timezone), month = input.month || today.slice(0, 7);
  const range = attendanceMonthRange(month, timezone);
  const { page, limit, skip } = paginationFromQuery(query);
  const historyFilter = { userId, occurredAt: { $lte: now } };
  const [events, total, monthRows, streak, memberIds] = await Promise.all([
    AttendanceEvent.find(historyFilter)
      .select("publicId gymId type source occurredAt localDate supersedesEventId reason")
      .populate("gymId", "publicId name slug timezone")
      .sort({ occurredAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    AttendanceEvent.countDocuments(historyFilter),
    AttendanceEvent.aggregate([
      ...validAttendanceStages(userId, now, range),
      { $group: { _id: { $dateToString: { date: "$occurredAt", format: "%Y-%m-%d", timezone } } } },
      { $sort: { _id: 1 } },
    ]),
    globalStreak(userId, timezone, now),
    MemberProfile.distinct("_id", { userId }),
  ]);
  const [invalidated, streaks] = await Promise.all([
    events.length ? AttendanceEvent.distinct("supersedesEventId", { userId, type: "CORRECTION", occurredAt: { $lte: now }, supersedesEventId: { $in: events.map((event) => event._id) } }) : [],
    StreakProjection.find({ memberProfileId: { $in: memberIds } }).lean(),
  ]);
  const invalidIds = new Set(invalidated.map(String));
  return {
    data: {
      events: events.map((event) => ({ ...event,
        status: event.type === "CHECK_IN" ? invalidIds.has(String(event._id)) ? "CORRECTED" : "CHECKED_IN" : event.type === "CHECK_OUT" ? "CHECKED_OUT" : "CORRECTION",
        date: localDay(event.occurredAt, timezone),
      })),
      streaks,
      summary: { month, timezone, today, currentStreak: streak.currentStreak, longestStreak: streak.longestStreak,
        totalAttendance: streak.totalVisits, lastAttendanceDate: streak.lastAttendanceDate || null,
        lastCheckIn: streak.lastCheckIn || null, monthlyAttendance: monthRows.length,
        attendedDays: monthRows.map((row) => String(row._id)),
      },
    },
    meta: pageMeta(page, limit, total),
  };
}
