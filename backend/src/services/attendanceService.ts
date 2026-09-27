import mongoose from "mongoose";
import { nanoid } from "nanoid";
import {
  AttendanceEvent,
  AttendanceProjection,
  StreakProjection,
} from "../models/Attendance.js";
import { MemberProfile } from "../models/Member.js";
import { Subscription } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { AppError } from "../utils/AppError.js";
import { emitDomainEvent } from "./domainEventService.js";

function distanceMeters(a: [number, number], b: [number, number]) {
  const rad = (value: number) => (value * Math.PI) / 180;
  const dLat = rad(b[1] - a[1]),
    dLon = rad(b[0] - a[0]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLon / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}
export function attendanceLocalDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return map.year + "-" + map.month + "-" + map.day;
}
export async function checkIn(input: {
  gymId: string;
  memberIdentifier: string;
  actorId: string;
  memberUserId?: string;
  source: "QR" | "MANUAL";
  scannerId?: string;
  idempotencyKey?: string;
  qrNonce?: string;
  location?: {
    coordinates: [number, number];
    accuracyMeters: number;
    capturedAt?: Date;
  };
}) {
  let dailyKey: string | undefined;
  try {
    return await mongoose.connection.transaction(async (session) => {
      const gym = await Gym.findById(input.gymId).session(session);
      if (!gym || gym.status !== "ACTIVE")
        throw new AppError(
          409,
          "GYM_NOT_ACTIVE",
          "Attendance is unavailable because this gym is not active.",
        );
      const member = await MemberProfile.findOne({
        gymId: input.gymId,
        status: "ACTIVE",
        ...(input.memberUserId ? { userId: input.memberUserId } : {}),
        $or: [
          { publicId: input.memberIdentifier },
          { memberCode: input.memberIdentifier },
        ],
      }).session(session);
      if (!member)
        throw new AppError(
          404,
          "MEMBER_NOT_FOUND",
          "No active member matches this account or member code.",
        );
      const now = new Date();
      let locationEvidence;
      if (gym.attendanceLocationRequired) {
        const point = input.location;
        if (!point)
          throw new AppError(
            400,
            "LOCATION_REQUIRED",
            "Location permission is required by this gym. Enable location and scan again.",
          );
        const capturedAt = point.capturedAt && new Date(point.capturedAt);
        if (
          !capturedAt ||
          !Number.isFinite(capturedAt.getTime()) ||
          Math.abs(now.getTime() - capturedAt.getTime()) > 120_000
        )
          throw new AppError(
            409,
            "LOCATION_STALE",
            "Refresh your location and scan again.",
          );
        const radius = Number(gym.attendanceRadiusMeters || 100);
        if (
          !Number.isFinite(point.accuracyMeters) ||
          point.accuracyMeters > Math.min(radius, 100)
        )
          throw new AppError(
            409,
            "LOCATION_INACCURATE",
            "Your location is not accurate enough. Move near the entrance and retry.",
          );
        const distance = distanceMeters(
          gym.location.coordinates as [number, number],
          point.coordinates,
        );
        if (distance > radius)
          throw new AppError(
            409,
            "OUTSIDE_GYM_RADIUS",
            "Move within " + radius + " m of the gym to check in.",
          );
        locationEvidence = {
          point: { type: "Point", coordinates: point.coordinates },
          accuracyMeters: point.accuracyMeters,
          distanceMeters: Math.round(distance),
          allowedRadiusMeters: radius,
          capturedAt,
        };
      }
      const subscription = await Subscription.findOne({
        type: "GYM_MEMBERSHIP",
        gymId: input.gymId,
        memberProfileId: member._id,
        status: "ACTIVE",
        startsAt: { $lte: now },
        endsAt: { $gt: now },
      }).session(session);
      if (
        !subscription &&
        (!member.directAccess || member.currentSubscriptionId)
      )
        throw new AppError(
          409,
          "MEMBERSHIP_NOT_ACTIVE",
          "Your membership is frozen, expired or inactive. Reactivate or renew it before checking in.",
        );
      const date = attendanceLocalDate(now, gym.timezone || "Asia/Kolkata");
      dailyKey = String(gym._id) + ":" + String(member._id) + ":" + date;
      // Historical events lack dailyKey; retain their daily check-in protection.
      const duplicate = await AttendanceEvent.findOne({
        gymId: gym._id,
        memberProfileId: member._id,
        localDate: date,
        type: "CHECK_IN",
      }).session(session);
      if (duplicate) return { event: duplicate, duplicate: true };
      const [event] = await AttendanceEvent.create(
        [
          {
            publicId: nanoid(24),
            gymId: gym._id,
            memberProfileId: member._id,
            userId: member.userId,
            type: "CHECK_IN",
            occurredAt: now,
            localDate: date,
            source: input.source,
            scannerId: input.scannerId,
            idempotencyKey: input.idempotencyKey
              ? String(member._id) + ":" + input.idempotencyKey
              : undefined,
            dailyKey,
            createdBy: input.actorId,
            locationEvidence,
          },
        ],
        { session },
      );
      await AttendanceProjection.findOneAndUpdate(
        { gymId: gym._id, memberProfileId: member._id, localDate: date },
        { $setOnInsert: { firstCheckInAt: now }, $inc: { visitCount: 1 } },
        { upsert: true, session },
      );
      const streak = await StreakProjection.findOne({
        gymId: gym._id,
        memberProfileId: member._id,
      }).session(session);
      const previous = streak?.lastAttendanceDate;
      const consecutive =
        previous &&
        Math.round(
          (Date.parse(date + "T00:00:00Z") -
            Date.parse(previous + "T00:00:00Z")) /
            86_400_000,
        ) === 1;
      const current =
        previous === date
          ? streak.currentStreak
          : consecutive
            ? streak.currentStreak + 1
            : 1;
      await StreakProjection.findOneAndUpdate(
        { gymId: gym._id, memberProfileId: member._id },
        {
          $set: {
            currentStreak: current,
            longestStreak: Math.max(streak?.longestStreak || 0, current),
            lastAttendanceDate: date,
            calculatedAt: now,
          },
          $inc: { totalVisits: 1 },
        },
        { upsert: true, session },
      );
      await emitDomainEvent({
        event: "attendance.checked_in",
        userId: member.userId,
        gymId: gym._id,
        entityId: event.publicId,
        actionUrl: "/app/attendance",
        session,
      });
      return { event, member, subscription, duplicate: false };
    });
  } catch (error: any) {
    if (error?.code === 11000 && dailyKey) {
      const event = await AttendanceEvent.findOne({ dailyKey });
      if (event) return { event, duplicate: true };
    }
    throw error;
  }
}
