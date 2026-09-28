import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { ClassBooking, ClassSession, Trainer, Notification } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { Attachment } from "../models/Business.js";
import { classInput } from "../routes/inputSchemas.js";
import { AppError } from "../utils/AppError.js";
import { emitDomainEvents } from "./domainEventService.js";
import { validatedImageAttachment } from "./userMediaService.js";

export async function saveGymClass(input: {
  gymId: string;
  actorId?: string;
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
      // Detachment begins a fresh 24-hour cleanup grace period and shares the
      // attachment write lock with binding/deletion across API instances.
      if (existing?.imageAttachmentId && body.imageAttachmentId !== undefined &&
          String(existing.imageAttachmentId) !== String(body.imageAttachmentId || "")) {
        await Attachment.updateOne({ _id: existing.imageAttachmentId, gymId: input.gymId, purpose: "CLASS_IMAGE", status: "READY" },
          { $inc: { bindingVersion: 1 } }, { session });
      }
      if (body.imageAttachmentId && String(existing?.imageAttachmentId || "") !== body.imageAttachmentId) {
        if (!input.actorId) throw new AppError(403, "MEDIA_OWNER_REQUIRED", "Sign in to attach a class image.");
        await validatedImageAttachment(body.imageAttachmentId, input.actorId, "CLASS_IMAGE", input.gymId, session);
      }
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
    const changedTrainer = existing && body && body.trainerId !== undefined &&
      String(existing.trainerId || "") !== String(body.trainerId || "");
    const changedSchedule =
      existing &&
      body &&
      (existing.startsAt.getTime() !== body.startsAt.getTime() ||
        existing.endsAt.getTime() !== body.endsAt.getTime());
    let data = existing;
    if (!data)
      [data] = await ClassSession.create(
        [{ ...body, publicId: nanoid(18), gymId: input.gymId }],
        { session },
      );
    else {
      if (body) {
        Object.assign(data, body);
        if (body.imageAttachmentId === null) data.imageUrl = undefined;
      }
      if (cancelling)
        Object.assign(data, {
          status: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: input.reason || "Cancelled by gym management",
          bookedCount: 0,
        });
      await data.save({ session });
    }
    if (existing && (cancelling || changedSchedule || changedTrainer)) {
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
        .select("_id userId")
        .session(session);
      if (cancelling || changedSchedule) await Notification.updateMany({
        gymId: input.gymId, entityId: { $in: bookings.map((booking) => String(booking._id)) },
        event: "class.reminder", pushStatus: "QUEUED",
      }, { $set: { pushStatus: "SKIPPED" }, $unset: { pushLeaseId: 1, pushLeaseUntil: 1 } }, { session });
      await emitDomainEvents(
        bookings.flatMap((booking) => {
          const member = members.find((member) => String(member._id) === String(booking.memberProfileId));
          if (!member) return [];
          return [{
          event: cancelling ? "class.cancelled" as const : changedSchedule ? "class.updated" as const : "class.trainer_changed" as const,
          userId: member.userId,
          gymId: input.gymId,
          entityId: String(booking._id),
          occurrenceId: String(data.version),
          actionUrl: `/app/classes?booking=${booking._id}`,
          session,
        }]; }),
      );
    }
    return data;
  });
}
