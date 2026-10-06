import type { Request, Response } from "express";
import { transitionMembership } from "../services/membershipLifecycleService.js";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Favorite, Referral } from "../models/Business.js";
import {
  Review,
  ClassSession,
  ClassBooking,
  Notification,
} from "../models/Engagement.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import {
  MembershipPlan,
  Subscription,
  SubscriptionEvent,
} from "../models/Commerce.js";
import { AppError } from "../utils/AppError.js";
import { createMembershipQuote } from "../services/checkoutService.js";
import { refreshGymRating } from "../services/gymProjectionService.js";
import { emitDomainEvent } from "../services/domainEventService.js";
import { withGymMedia } from "../services/gymMediaService.js";
import { memberClassScope } from "../services/memberClassAccessService.js";
import { withTrainerMedia } from "../services/userMediaService.js";
import { withClassMedia } from "../services/classMediaService.js";
import {
  validateReviewImages,
  withReviewMedia,
} from "../services/reviewMediaService.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";

export async function favorites(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { userId: req.auth!.userId };
  const [data, total] = await Promise.all([Favorite.find(filter)
    .populate(
      "gymId",
      "publicId name slug logoUrl logoAttachmentId rating address startingPriceMinor",
    )
    .sort({ createdAt: -1 })
    .skip(skip).limit(limit).lean(), Favorite.countDocuments(filter)]);
  const gyms = await withGymMedia(
    data.map((favorite) => favorite.gymId).filter(Boolean),
  );
  res.json({
    success: true,
    data: data.map((favorite) => ({
      ...favorite,
      gymId:
        gyms.find((gym) => String(gym._id) === String(favorite.gymId?._id)) ||
        favorite.gymId,
    })), meta: pageMeta(page, limit, total),
  });
}
export async function addFavorite(req: Request, res: Response) {
  const gym = await Gym.findOne({
    publicId: req.params.gymId,
    status: "ACTIVE",
  });
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  const data = await Favorite.findOneAndUpdate(
    { userId: req.auth!.userId, gymId: gym._id },
    { $setOnInsert: { userId: req.auth!.userId, gymId: gym._id } },
    { upsert: true, returnDocument: "after" },
  );
  res.status(201).json({ success: true, data });
}
export async function removeFavorite(req: Request, res: Response) {
  const gym = await Gym.findOne({ publicId: req.params.gymId }).select("_id");
  if (gym)
    await Favorite.deleteOne({ userId: req.auth!.userId, gymId: gym._id });
  res.status(204).send();
}

export async function createReview(req: Request, res: Response) {
  const gym = await Gym.findOne({ publicId: req.body.gymId, status: "ACTIVE" });
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  const member = await MemberProfile.exists({
    gymId: gym._id,
    userId: req.auth!.userId,
    status: { $in: ["ACTIVE", "INACTIVE"] },
  });
  if (!member)
    throw new AppError(
      403,
      "REVIEW_MEMBERSHIP_REQUIRED",
      "Only gym members can review this gym.",
    );
  if (await Review.exists({ gymId: gym._id, userId: req.auth!.userId }))
    throw new AppError(
      409,
      "REVIEW_EXISTS",
      "You already reviewed this gym. Edit your existing review.",
    );
  const persist = async (session?: mongoose.ClientSession) => {
    const record = {
      publicId: nanoid(20),
      gymId: gym._id,
      userId: req.auth!.userId,
      rating: req.body.rating,
      title: req.body.title,
      body: req.body.body,
      attachmentIds: await validateReviewImages(
        req.body.attachmentIds || [],
        req.auth!.userId,
        session,
      ),
      status: "PUBLISHED",
    };
    return session
      ? (await Review.create([record], { session }))[0]
      : Review.create(record);
  };
  const data = req.body.attachmentIds?.length
    ? await mongoose.connection.transaction(persist)
    : await persist();
  await refreshGymRating(data.gymId);
  await emitDomainEvent({
    event: "review.created",
    userId: gym.ownerId,
    gymId: gym._id,
    entityId: data.publicId,
    actionUrl: `/gyms/${gym.slug}#gym-reviews`,
  });
  res
    .status(201)
    .json({
      success: true,
      data: (await withReviewMedia([data.toObject()]))[0],
    });
}
export async function updateReview(req: Request, res: Response) {
  const persist = async (session?: mongoose.ClientSession) => {
    const attachmentIds =
      req.body.attachmentIds === undefined
        ? undefined
        : await validateReviewImages(
            req.body.attachmentIds,
            req.auth!.userId,
            session,
          );
    const data = await Review.findOneAndUpdate(
      { publicId: req.params.id, userId: req.auth!.userId },
      {
        $set: {
          rating: req.body.rating,
          title: req.body.title,
          body: req.body.body,
          ...(attachmentIds !== undefined ? { attachmentIds } : {}),
          ...(req.body.removeLegacyPhotos ? { photoUrls: [] } : {}),
          editedAt: new Date(),
        },
      },
      {
        returnDocument: "after",
        runValidators: true,
        ...(session ? { session } : {}),
      },
    );
    if (!data) throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found.");
    return data;
  };
  const data = req.body.attachmentIds?.length
    ? await mongoose.connection.transaction(persist)
    : await persist();
  await refreshGymRating(data.gymId);
  const gym = await Gym.findById(data.gymId).select("ownerId slug");
  if (gym)
    await emitDomainEvent({
      event: "review.updated",
      userId: gym.ownerId,
      gymId: gym._id,
      entityId: data.publicId,
      occurrenceId: data.editedAt.toISOString(),
      actionUrl: `/gyms/${gym.slug}#gym-reviews`,
    });
  res.json({
    success: true,
    data: (await withReviewMedia([data.toObject()]))[0],
  });
}

export async function ownReview(req: Request, res: Response) {
  const gym = await Gym.findOne({
    publicId: String(req.query.gymId || ""),
  }).select("_id");
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  const data = await Review.findOne({
    gymId: gym._id,
    userId: req.auth!.userId,
  }).lean();
  res.json({
    success: true,
    data: data ? (await withReviewMedia([data]))[0] : null,
  });
}

export async function classes(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const from = req.query.from ? new Date(String(req.query.from)) : new Date();
  if (Number.isNaN(from.getTime()))
    throw new AppError(422, "INVALID_DATE", "Enter a valid date.");
  const day = req.query.day;
  if (
    day &&
    (typeof day !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(day) ||
      !Number.isFinite(Date.parse(day)) ||
      new Date(day).toISOString().slice(0, 10) !== day)
  )
    throw new AppError(422, "INVALID_DATE", "Choose a valid calendar date.");
  if (
    req.query.gymId &&
    (typeof req.query.gymId !== "string" ||
      !mongoose.isValidObjectId(req.query.gymId))
  )
    throw new AppError(422, "GYM_INVALID", "Choose a valid gym.");
  const { filter, eligibleGymCount } = await memberClassScope(req.auth!.userId, {
    from, day: day as string | undefined,
    gymId: req.query.gymId as string | undefined,
    search: typeof req.query.q === "string" ? req.query.q : undefined,
  });
  const data = await ClassSession.find(filter)
    .populate("gymId", "publicId name slug timezone")
    .populate("trainerId", "publicId name photoUrl photoAttachmentId")
    .sort({ startsAt: 1, _id: 1 })
    .skip(skip)
    .limit(limit)
    .lean();
  const trainers = await withTrainerMedia(
    data.flatMap((row: any) => (row.trainerId ? [row.trainerId] : [])),
  );
  const ownBookings = data.length
    ? await ClassBooking.find({
        sessionId: { $in: data.map((row) => row._id) },
        memberProfileId: {
          $in: await MemberProfile.distinct("_id", {
            userId: req.auth!.userId,
          }),
        },
        status: { $in: ["BOOKED", "WAITLISTED"] },
      })
        .select("_id sessionId status")
        .lean()
    : [];
  res.json({
    success: true,
    data: (await withClassMedia(data)).map((row: any) => ({
      ...row,
      myBooking:
        ownBookings.find(
          (booking) => String(booking.sessionId) === String(row._id),
        ) || null,
      trainerId:
        trainers.find(
          (trainer: any) => String(trainer._id) === String(row.trainerId?._id),
        ) || row.trainerId,
    })),
    meta: { ...pageMeta(page, limit, await ClassSession.countDocuments(filter)), eligibleGymCount },
  });
}
export async function classDetails(req: Request, res: Response) {
  const { filter } = await memberClassScope(req.auth!.userId);
  const row = await ClassSession.findOne({ ...filter, publicId: req.params.id })
    .populate("gymId", "publicId name slug timezone")
    .populate("trainerId", "publicId name photoUrl photoAttachmentId").lean();
  if (!row) throw new AppError(404, "CLASS_UNAVAILABLE", "This class is not available for your memberships.");
  const [data] = await withClassMedia([row]);
  if (data.trainerId) [data.trainerId] = await withTrainerMedia([data.trainerId]);
  res.json({ success: true, data });
}
export async function bookClass(req: Request, res: Response) {
  const session = await mongoose.startSession();
  let booking: any;
  try {
    await session.withTransaction(async () => {
      const classSession = await ClassSession.findOneAndUpdate(
        {
          publicId: req.params.id,
          status: "SCHEDULED",
          startsAt: { $gt: new Date() },
          $expr: { $lt: ["$bookedCount", "$capacity"] },
        },
        { $inc: { bookedCount: 1 } },
        { returnDocument: "after", session },
      );
      if (!classSession)
        throw new AppError(
          409,
          "CLASS_FULL_OR_UNAVAILABLE",
          "This class is full or no longer available.",
        );
      if (
        !(await Gym.exists({
          _id: classSession.gymId,
          status: "ACTIVE",
          verificationStatus: "VERIFIED",
          platformSubscriptionStatus: "ACTIVE",
          deletedAt: null,
        }).session(session))
      )
        throw new AppError(
          409,
          "GYM_UNAVAILABLE",
          "This gym is not accepting class bookings.",
        );
      const member = await MemberProfile.findOneAndUpdate({
        gymId: classSession.gymId,
        userId: req.auth!.userId,
        status: "ACTIVE",
        "invitation.status": { $ne: "PENDING" },
      }, { $inc: { version: 1 } }, { session, returnDocument: "after" });
      if (!member)
        throw new AppError(
          403,
          "ACTIVE_MEMBERSHIP_REQUIRED",
          "An active gym membership is required.",
        );
      const active = await Subscription.findOneAndUpdate({
        type: "GYM_MEMBERSHIP",
        memberProfileId: member._id,
        userId: req.auth!.userId,
        ...(member.currentSubscriptionId ? { _id: member.currentSubscriptionId } : {}),
        gymId: classSession.gymId,
        status: "ACTIVE",
        startsAt: { $lte: new Date() },
        endsAt: { $gte: classSession.endsAt },
      }, { $inc: { version: 1 } }, { session, returnDocument: "after" });
      if (!active)
        throw new AppError(
          403,
          "ACTIVE_MEMBERSHIP_REQUIRED",
          "A membership covering this class is required.",
        );
      const prior = await ClassBooking.findOne({
        sessionId: classSession._id,
        memberProfileId: member._id,
      }).session(session);
      if (prior && prior.status !== "CANCELLED")
        throw new AppError(
          409,
          "ALREADY_BOOKED",
          "You already booked this class.",
        );
      booking = await ClassBooking.findOneAndUpdate(
        { sessionId: classSession._id, memberProfileId: member._id },
        {
          $set: {
            gymId: classSession.gymId,
            status: "BOOKED",
            bookedAt: new Date(),
            cancelledAt: null,
          },
        },
        { upsert: true, returnDocument: "after", session },
      );
      await emitDomainEvent({
        event: "class.booked",
        userId: req.auth!.userId,
        gymId: classSession.gymId,
        entityId: String(booking._id),
        occurrenceId: booking.bookedAt.toISOString(),
        actionUrl: `/app/classes?booking=${booking._id}`,
        session,
      });
    });
  } finally {
    await session.endSession();
  }
  res.status(201).json({ success: true, data: booking });
}
export async function cancelBooking(req: Request, res: Response) {
  const session = await mongoose.startSession();
  let data: any;
  try {
    await session.withTransaction(async () => {
      const ids = await MemberProfile.distinct("_id", {
        userId: req.auth!.userId,
      }).session(session);
      const classSession = await ClassSession.findOne({
        publicId: req.params.id,
        startsAt: { $gt: new Date() },
      }).session(session);
      if (!classSession)
        throw new AppError(
          409,
          "CLASS_UNAVAILABLE",
          "Only upcoming bookings can be cancelled.",
        );
      const cancelledAt = new Date();
      data = await ClassBooking.findOneAndUpdate(
        {
          _id: req.params.bookingId,
          sessionId: classSession._id,
          memberProfileId: { $in: ids },
          status: { $in: ["BOOKED", "WAITLISTED"] },
        },
        { $set: { status: "CANCELLED", cancelledAt } },
        { returnDocument: "before", session },
      );
      if (!data)
        throw new AppError(
          409,
          "BOOKING_NOT_ACTIVE",
          "This booking is not active or does not belong to you.",
        );
      if (data.status === "BOOKED")
        await ClassSession.updateOne(
          { _id: classSession._id, bookedCount: { $gt: 0 } },
          { $inc: { bookedCount: -1 } },
          { session },
        );
      data.status = "CANCELLED";
      data.cancelledAt = cancelledAt;
      await Notification.updateMany({ userId: req.auth!.userId, entityId: String(data._id), event: "class.reminder", pushStatus: "QUEUED" },
        { $set: { pushStatus: "SKIPPED" }, $unset: { pushLeaseId: 1, pushLeaseUntil: 1 } }, { session });
      await emitDomainEvent({
        event: "class.cancelled",
        userId: req.auth!.userId,
        gymId: classSession.gymId,
        entityId: String(data._id),
        occurrenceId: data.cancelledAt.toISOString(),
        actionUrl: `/app/classes?booking=${data._id}`,
        session,
      });
    });
  } finally {
    await session.endSession();
  }
  res.json({ success: true, data });
}
export async function bookingDetails(req: Request, res: Response) {
  if (!mongoose.isValidObjectId(req.params.bookingId))
    throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found.");
  const members = await MemberProfile.distinct("_id", { userId: req.auth!.userId });
  const booking = await ClassBooking.findOne({ _id: req.params.bookingId, memberProfileId: { $in: members } })
    .select("sessionId status bookedAt cancelledAt")
    .populate({ path: "sessionId", populate: [
      { path: "gymId", select: "name publicId timezone" },
      { path: "trainerId", select: "name photoUrl photoAttachmentId" },
    ] }).lean();
  if (!booking) throw new AppError(404, "BOOKING_NOT_FOUND", "Booking not found.");
  const [classSession] = await withClassMedia(booking.sessionId ? [booking.sessionId] : []);
  if (classSession?.trainerId) [classSession.trainerId] = await withTrainerMedia([classSession.trainerId]);
  res.json({ success: true, data: { ...booking, sessionId: classSession || null } });
}
export async function subscriptionCommand(req: Request, res: Response) {
  const command = String(req.params.command);
  if (["cancel", "freeze", "reactivate"].includes(command)) {
    const data = await transitionMembership({
      publicId: String(req.params.id),
      userId: req.auth!.userId,
      actorId: req.auth!.userId,
      action: command as "cancel" | "freeze" | "reactivate",
      actorRole: req.auth!.role,
      endsAt: req.body.endsAt,
      reason: req.body.reason,
    });
    return res.json({ success: true, data });
  }
  const subscription = await Subscription.findOne({
    publicId: req.params.id,
    userId: req.auth!.userId,
  });
  if (!subscription)
    throw new AppError(404, "SUBSCRIPTION_NOT_FOUND", "Membership not found.");
  if (!["renew", "change-plan"].includes(command))
    throw new AppError(
      400,
      "UNKNOWN_SUBSCRIPTION_COMMAND",
      "Unsupported membership command.",
    );
  const plan = await MembershipPlan.findOne({
    publicId: req.body.planId,
    gymId: subscription.gymId,
    status: "ACTIVE",
  });
  if (!plan)
    throw new AppError(
      404,
      "PLAN_NOT_FOUND",
      "Selected plan is not available.",
    );
  const quote = await createMembershipQuote({
    userId: req.auth!.userId,
    gymId: String(subscription.gymId),
    planId: String(plan._id),
    couponCode: req.body.couponCode,
  });
  res
    .status(201)
    .json({ success: true, data: { quote, next: "/api/v1/checkout/orders" } });
}

export async function referrals(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { referrerId: req.auth!.userId };
  const [data, total] = await Promise.all([
    Referral.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Referral.countDocuments(filter),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}
export async function inviteReferral(req: Request, res: Response) {
  let existing = await Referral.findOne({
    referrerId: req.auth!.userId,
    code: req.body.code,
    status: { $in: ["INVITED", "SIGNED_UP"] },
  });
  if (existing) return res.json({ success: true, data: existing });
  const data = await Referral.create({
    referrerId: req.auth!.userId,
    code: req.body.code,
    status: "INVITED",
  });
  await emitDomainEvent({
    event: "referral.created",
    userId: req.auth!.userId,
    entityId: String(data._id),
    actionUrl: "/app/referrals",
  });
  res.status(201).json({ success: true, data });
}
