import { nanoid } from "nanoid";
import { AttendanceEvent, AttendanceProjection, StreakProjection } from "../models/Attendance.js";
import { MemberProfile } from "../models/Member.js";
import { Subscription } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { AppError } from "../utils/AppError.js";

function distanceMeters(a: [number, number], b: [number, number]) {
  const rad = (value: number) => value * Math.PI / 180;
  const [lon1, lat1] = a; const [lon2, lat2] = b;
  const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function localDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export async function checkIn(input: {
  gymId: string;
  memberIdentifier: string;
  actorId: string;
  source: "QR" | "MANUAL";
  scannerId?: string;
  idempotencyKey?: string;
  qrNonce?: string;
  location?: { coordinates: [number, number]; accuracyMeters: number; capturedAt?: Date };
}) {
  const gym = await Gym.findById(input.gymId);
  if (!gym || gym.status !== "ACTIVE") {
    throw new AppError(409, "GYM_NOT_ACTIVE", "Attendance is unavailable because this gym is not active.");
  }
  const member = await MemberProfile.findOne({
    gymId: input.gymId,
    status: "ACTIVE",
    $or: [{ publicId: input.memberIdentifier }, { memberCode: input.memberIdentifier }]
  });
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "No active member matches this code.");

  const now = new Date();
  let locationEvidence: Record<string, unknown> | undefined;
  const allowedRadiusMeters = Number((gym as any).attendanceRadiusMeters || 100);
  if ((gym as any).attendanceLocationRequired) {
    if (!input.location) throw new AppError(400, "LOCATION_REQUIRED", "Location permission is required for attendance.");
    if (input.location.accuracyMeters > Math.min(allowedRadiusMeters, 100)) throw new AppError(409, "LOCATION_INACCURATE", "Unable to determine an accurate location. Move outdoors and retry.");
    const gymCoordinates = (gym.location as any)?.coordinates as [number, number];
    const distance = distanceMeters(gymCoordinates, input.location.coordinates);
    if (distance > allowedRadiusMeters) throw new AppError(409, "OUTSIDE_GYM_RADIUS", `Move within ${allowedRadiusMeters} m of the gym to check in.`);
    locationEvidence = { point: { type: "Point", coordinates: input.location.coordinates }, accuracyMeters: input.location.accuracyMeters, distanceMeters: Math.round(distance), allowedRadiusMeters, capturedAt: input.location.capturedAt || now };
  }
  const subscription = await Subscription.findOne({
    gymId: input.gymId,
    memberProfileId: member._id,
    status: "ACTIVE",
    startsAt: { $lte: now },
    endsAt: { $gte: now }
  });
  if (!subscription) {
    throw new AppError(409, "MEMBERSHIP_NOT_ACTIVE", "This member does not have an active membership.");
  }

  if (input.idempotencyKey) {
    const replay = await AttendanceEvent.findOne({ gymId: input.gymId, idempotencyKey: input.idempotencyKey });
    if (replay) return { event: replay, duplicate: true };
  }

  const duplicate = await AttendanceEvent.findOne({
    gymId: input.gymId,
    memberProfileId: member._id,
    type: "CHECK_IN",
    occurredAt: { $gte: new Date(now.getTime() - 120_000) }
  }).sort({ occurredAt: -1 });
  if (duplicate) return { event: duplicate, duplicate: true };

  const date = localDate(now, gym.timezone || "Asia/Kolkata");
  const event = await AttendanceEvent.create({
    publicId: nanoid(24),
    gymId: gym._id,
    memberProfileId: member._id,
    userId: member.userId,
    type: "CHECK_IN",
    occurredAt: now,
    localDate: date,
    source: input.source,
    scannerId: input.scannerId && /^[a-f\d]{24}$/i.test(input.scannerId) ? input.scannerId : undefined,
    qrNonce: input.qrNonce,
    idempotencyKey: input.idempotencyKey,
    createdBy: input.actorId
    ,locationEvidence
  });

  await AttendanceProjection.findOneAndUpdate(
    { gymId: gym._id, memberProfileId: member._id, localDate: date },
    { $setOnInsert: { firstCheckInAt: now }, $inc: { visitCount: 1 } },
    { upsert: true, new: true }
  );

  const streak = await StreakProjection.findOne({ gymId: gym._id, memberProfileId: member._id });
  const previousDate = streak?.lastAttendanceDate;
  const nextCurrent = !previousDate ? 1 : previousDate === date ? streak.currentStreak : daysBetween(previousDate, date) === 1 ? streak.currentStreak + 1 : 1;
  await StreakProjection.findOneAndUpdate(
    { gymId: gym._id, memberProfileId: member._id },
    {
      $set: {
        currentStreak: nextCurrent,
        longestStreak: Math.max(streak?.longestStreak || 0, nextCurrent),
        lastAttendanceDate: date,
        calculatedAt: now
      },
      $inc: { totalVisits: 1 }
    },
    { upsert: true, new: true }
  );

  return { event, member, subscription, duplicate: false };
}
