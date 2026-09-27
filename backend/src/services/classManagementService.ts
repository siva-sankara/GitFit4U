import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { ClassBooking, ClassSession, Trainer } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { classInput } from "../routes/inputSchemas.js";
import { AppError } from "../utils/AppError.js";
import { emitDomainEvents } from "./domainEventService.js";

export async function saveGymClass(input: {
  gymId: string;
  publicId?: string;
  body: unknown;
  cancel?: boolean;
  reason?: string;
}) {
  const body = input.cancel ? null : classInput.parse(input.body);
  return mongoose.connection.transaction(async (session) => {
    const existing = input.publicId
      ? await ClassSession.findOne({
          publicId: input.publicId,
          gymId: input.gymId,
        }).session(session)
      : null;
    if (input.publicId && !existing)
      throw new AppError(
        404,
        "CLASS_NOT_FOUND",
        "Class not found in this gym.",
      );
    if (existing?.status === "CANCELLED") {
      if (input.cancel) return existing;
      throw new AppError(
        409,
        "CLASS_CANCELLED",
        "Cancelled classes cannot be reopened. Create a new class instead.",
      );
    }
    const cancelling = input.cancel || body?.status === "CANCELLED";
    if (!existing && cancelling)
      throw new AppError(
        422,
        "CLASS_INVALID_STATUS",
        "Create the class as scheduled before cancelling it.",
      );
    if (body) {
      if (
        body.trainerId &&
        !(await Trainer.exists({
          _id: body.trainerId,
          gymId: input.gymId,
          status: "ACTIVE",
        }).session(session))
      )
        throw new AppError(
          422,
          "TRAINER_INVALID",
          "Select an active trainer at this gym.",
          {
            fieldErrors: {
              trainerId: ["Select an active trainer at this gym."],
            },
          },
        );
      if (!existing && body.startsAt <= new Date())
        throw new AppError(
          422,
          "CLASS_START_PAST",
          "Start time must be in the future.",
          { fieldErrors: { startsAt: ["Start time must be in the future."] } },
        );
      if (existing && body.capacity < existing.bookedCount)
        throw new AppError(
          409,
          "CLASS_CAPACITY_TOO_SMALL",
          "Capacity cannot be lower than the number of booked members.",
          {
            fieldErrors: {
              capacity: ["Capacity cannot be lower than current bookings."],
            },
          },
        );
      if (body.status === "COMPLETED" && body.endsAt > new Date())
        throw new AppError(
          422,
          "CLASS_NOT_ENDED",
          "Only classes that have ended can be marked completed.",
          { fieldErrors: { status: ["The class has not ended yet."] } },
        );
      if (
        existing &&
        body.startsAt.getTime() !== existing.startsAt.getTime() &&
        body.startsAt <= new Date()
      )
        throw new AppError(
          422,
          "CLASS_START_PAST",
          "A rescheduled start must be in the future.",
          { fieldErrors: { startsAt: ["Choose a future start time."] } },
        );
    }
    const changedSchedule =
      existing &&
      body &&
      (existing.startsAt.getTime() !== body.startsAt.getTime() ||
        existing.endsAt.getTime() !== body.endsAt.getTime() ||
        (body.trainerId !== undefined &&
          String(existing.trainerId || "") !== String(body.trainerId || "")));
    let data = existing;
    if (!data)
      [data] = await ClassSession.create(
        [{ ...body, publicId: nanoid(18), gymId: input.gymId }],
        { session },
      );
    else {
      if (body) Object.assign(data, body);
      if (cancelling)
        Object.assign(data, {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: input.reason || "Cancelled by gym management",
          bookedCount: 0,
        });
      await data.save({ session });
    }
    if (existing && (cancelling || changedSchedule)) {
      const bookings = await ClassBooking.find({
        sessionId: data._id,
        status: { $in: ["BOOKED", "WAITLISTED"] },
      }).session(session);
      if (cancelling)
        await ClassBooking.updateMany(
          { sessionId: data._id, status: { $in: ["BOOKED", "WAITLISTED"] } },
          { $set: { status: "CANCELLED", cancelledAt: new Date() } },
          { session },
        );
      const members = await MemberProfile.find({
        _id: { $in: bookings.map((booking) => booking.memberProfileId) },
        gymId: input.gymId,
      })
        .select("userId")
        .session(session);
      await emitDomainEvents(
        members.map((member) => ({
          event: cancelling ? "class.cancelled" : "class.updated",
          userId: member.userId,
          gymId: input.gymId,
          entityId: data.publicId,
          occurrenceId: String(data.version),
          actionUrl: "/app/classes",
          session,
        })),
      );
    }
    return data;
  });
}
