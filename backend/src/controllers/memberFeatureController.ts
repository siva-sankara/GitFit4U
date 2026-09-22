import type { Request, Response } from "express";
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

export async function favorites(req: Request, res: Response) {
  const data = await Favorite.find({ userId: req.auth!.userId })
    .populate(
      "gymId",
      "publicId name slug logoUrl rating address startingPriceMinor",
    )
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data });
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
    { upsert: true, new: true },
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
  });
  if (!member)
    throw new AppError(
      403,
      "REVIEW_MEMBERSHIP_REQUIRED",
      "Only gym members can review this gym.",
    );
  const data = await Review.findOneAndUpdate(
    { gymId: gym._id, userId: req.auth!.userId },
    {
      $set: {
        rating: req.body.rating,
        title: req.body.title,
        body: req.body.body,
        photoUrls: req.body.photoUrls || [],
        status: "PUBLISHED",
      },
      $setOnInsert: { publicId: nanoid(20) },
    },
    { upsert: true, new: true, runValidators: true },
  );
  await refreshGymRating(data.gymId);
  res.status(201).json({ success: true, data });
}
export async function updateReview(req: Request, res: Response) {
  const data = await Review.findOneAndUpdate(
    { publicId: req.params.id, userId: req.auth!.userId },
    { $set: req.body },
    { new: true, runValidators: true },
  );
  if (!data) throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found.");
  await refreshGymRating(data.gymId);
  res.json({ success: true, data });
}

export async function classes(req: Request, res: Response) {
  const from = req.query.from ? new Date(String(req.query.from)) : new Date();
  if (Number.isNaN(from.getTime()))
    throw new AppError(422, "INVALID_DATE", "Enter a valid date.");
  const visibleGyms = await Gym.distinct("_id", {
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    platformSubscriptionStatus: "ACTIVE",
    ...(req.query.gymId ? { _id: req.query.gymId } : {}),
  });
  const data = await ClassSession.find({
    startsAt: { $gte: from },
    status: "SCHEDULED",
    gymId: { $in: visibleGyms },
  })
    .populate("gymId", "publicId name slug")
    .populate("trainerId", "publicId name photoUrl")
    .sort({ startsAt: 1 })
    .limit(100)
    .lean();
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
        { new: true, session },
      );
      if (!classSession)
        throw new AppError(
          409,
          "CLASS_FULL_OR_UNAVAILABLE",
          "This class is full or no longer available.",
        );
      const member = await MemberProfile.findOne({
        gymId: classSession.gymId,
        userId: req.auth!.userId,
        status: "ACTIVE",
      }).session(session);
      if (!member)
        throw new AppError(
          403,
          "ACTIVE_MEMBERSHIP_REQUIRED",
          "An active gym membership is required.",
        );
      const active = await Subscription.exists({
        memberProfileId: member._id,
        gymId: classSession.gymId,
        status: "ACTIVE",
        startsAt: { $lte: classSession.startsAt },
        endsAt: { $gte: classSession.endsAt },
      }).session(session);
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
        { upsert: true, new: true, session },
      );
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
      data = await ClassBooking.findOneAndUpdate(
        {
          _id: req.params.bookingId,
          sessionId: classSession._id,
          memberProfileId: { $in: ids },
          status: "BOOKED",
        },
        { $set: { status: "CANCELLED", cancelledAt: new Date() } },
        { new: true, session },
      );
      if (!data)
        throw new AppError(
          409,
          "BOOKING_NOT_ACTIVE",
          "This booking is not active or does not belong to you.",
        );
      await ClassSession.updateOne(
        { _id: classSession._id, bookedCount: { $gt: 0 } },
        { $inc: { bookedCount: -1 } },
        { session },
      );
    });
  } finally {
    await session.endSession();
  }
  res.json({ success: true, data });
}
export async function subscriptionCommand(req: Request, res: Response) {
  const subscription = await Subscription.findOne({
    publicId: req.params.id,
    userId: req.auth!.userId,
  });
  if (!subscription)
    throw new AppError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found.",
    );
  const command = String(req.params.command);
  const now = new Date();
  if (command === "cancel") {
    if (!["ACTIVE", "FROZEN", "GRACE"].includes(subscription.status))
      throw new AppError(
        409,
        "INVALID_SUBSCRIPTION_STATE",
        "This subscription cannot be cancelled.",
      );
    subscription.status = "CANCELLED";
    subscription.cancelledAt = now;
    subscription.cancellationReason = req.body.reason;
  } else if (command === "freeze") {
    if (subscription.status !== "ACTIVE")
      throw new AppError(
        409,
        "INVALID_SUBSCRIPTION_STATE",
        "Only active subscriptions can be frozen.",
      );
    const days = Math.ceil(
      (new Date(req.body.endsAt).getTime() -
        new Date(req.body.startsAt).getTime()) /
        86400000,
    );
    if (
      !Number.isFinite(days) ||
      new Date(req.body.startsAt).getTime() > now.getTime() ||
      new Date(req.body.startsAt).getTime() < now.getTime() - 86400000 ||
      new Date(req.body.endsAt) <= now ||
      subscription.startsAt > now ||
      subscription.endsAt <= now
    )
      throw new AppError(
        422,
        "INVALID_FREEZE_DATES",
        "Freeze requires a current membership, starts today and must end in the future.",
      );
    const allowance = Number(
      (subscription.planSnapshot as any).freezeDaysAllowed || 0,
    );
    const used = subscription.freezePeriods.reduce(
      (sum: number, period: any) =>
        sum +
        Math.ceil(
          (new Date(period.endsAt).getTime() -
            new Date(period.startsAt).getTime()) /
            86400000,
        ),
      0,
    );
    if (days < 1 || days + used > allowance)
      throw new AppError(
        422,
        "FREEZE_ALLOWANCE_EXCEEDED",
        `This plan allows up to ${allowance} freeze days.`,
      );
    subscription.status = "FROZEN";
    subscription.endsAt = new Date(
      new Date(subscription.endsAt).getTime() + days * 86400000,
    );
    subscription.renewalAt = subscription.endsAt;
    subscription.freezePeriods.push({
      startsAt: req.body.startsAt,
      endsAt: req.body.endsAt,
      reason: req.body.reason,
    });
  } else if (["renew", "change-plan"].includes(command)) {
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
    return res.status(201).json({
      success: true,
      data: { quote, next: "/api/v1/checkout/orders" },
    });
  } else
    throw new AppError(
      400,
      "UNKNOWN_SUBSCRIPTION_COMMAND",
      "Unsupported subscription command.",
    );
  await subscription.save();
  await SubscriptionEvent.create({
    subscriptionId: subscription._id,
    type: command.toUpperCase(),
    actorId: req.auth!.userId,
    payload: req.body,
  });
  res.json({ success: true, data: subscription });
}

export async function referrals(req: Request, res: Response) {
  const data = await Referral.find({ referrerId: req.auth!.userId })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data });
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
  await Notification.create({
    userId: req.auth!.userId,
    category: "SYSTEM",
    title: "Referral invitation ready",
    message: "Your referral link is ready to share.",
    entityType: "SYSTEM",
  });
  res.status(201).json({ success: true, data });
}
