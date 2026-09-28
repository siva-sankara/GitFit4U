import mongoose from "mongoose";
import { Gym } from "../models/Gym.js";
import { ClassBooking, ClassSession } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { emitDomainEvents } from "./domainEventService.js";

export function classReminderDue(startsAt: Date, settings: { enabled?: boolean; leadMinutes?: number } | undefined, now: Date) {
  const leadMinutes = Math.max(15, Math.min(1440, settings?.leadMinutes ?? 60));
  return settings?.enabled !== false && startsAt > now && startsAt.getTime() - now.getTime() <= leadMinutes * 60000;
}

export async function classReminderStillCurrent(notification: any, now = new Date()) {
  if (notification.event !== "class.reminder") return true;
  if (!mongoose.isValidObjectId(notification.entityId)) return false;
  const booking = await ClassBooking.findOne({ _id: notification.entityId, gymId: notification.gymId, status: "BOOKED" }).lean();
  if (!booking) return false;
  const member = await MemberProfile.exists({ _id: booking.memberProfileId, gymId: booking.gymId, userId: notification.userId, status: "ACTIVE" });
  if (!member) return false;
  const [classSession, gym] = await Promise.all([
    ClassSession.findOne({ _id: booking.sessionId, gymId: booking.gymId, status: "SCHEDULED" }).lean(),
    Gym.findOne({ _id: booking.gymId, status: "ACTIVE", deletedAt: null }).select("classReminders").lean(),
  ]);
  return !!(classSession && gym && classReminderDue(classSession.startsAt, gym.classReminders, now)
    && notification.dedupeKey === `class.reminder:${booking._id}:${booking.bookedAt.toISOString()}:${classSession.startsAt.toISOString()}`);
}

/** The notification rows are the durable outbox. No delivery occurs until commit. */
export async function scheduleClassReminders(now = new Date()) {
  const candidates = ClassSession.find({ status: "SCHEDULED", bookedCount: { $gt: 0 },
    startsAt: { $gt: now, $lte: new Date(now.getTime() + 86400000) },
  }).select("_id gymId startsAt").sort({ startsAt: 1 }).lean().cursor({ batchSize: 50 });
  for await (const candidate of candidates) {
    await mongoose.connection.transaction(async (session) => {
      const gym = await Gym.findOne({ _id: candidate.gymId, status: "ACTIVE", deletedAt: null })
        .select("classReminders").session(session).lean();
      if (!gym || !classReminderDue(candidate.startsAt, gym.classReminders, now)) return;
      // Serialize against cancellation, rescheduling and seat changes.
      const current = await ClassSession.findOneAndUpdate({ _id: candidate._id,
        status: "SCHEDULED", startsAt: candidate.startsAt, bookedCount: { $gt: 0 },
      }, { $inc: { reminderLock: 1 } }, { session, returnDocument: "after" });
      if (!current) return;
      const bookings = await ClassBooking.find({ sessionId: current._id, status: "BOOKED" }).session(session).lean();
      const members = await MemberProfile.find({ _id: { $in: bookings.map((booking) => booking.memberProfileId) }, gymId: current.gymId })
        .select("_id userId").session(session).lean();
      await emitDomainEvents(bookings.flatMap((booking) => {
        const member = members.find((member) => String(member._id) === String(booking.memberProfileId));
        return member ? [{ event: "class.reminder" as const, userId: member.userId, gymId: current.gymId,
          entityId: String(booking._id), occurrenceId: `${booking.bookedAt.toISOString()}:${current.startsAt.toISOString()}`,
          actionUrl: `/app/classes?booking=${booking._id}`, session }] : [];
      }));
    });
  }
}
