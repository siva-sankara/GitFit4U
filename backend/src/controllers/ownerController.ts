import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Gym } from "../models/Gym.js";
import { validateGymMedia, withGymMedia } from "../services/gymMediaService.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { User } from "../models/User.js";
import { RoleAssignment } from "../models/Auth.js";
import { MembershipPlan, Payment, Subscription } from "../models/Commerce.js";
import { MemberProfile } from "../models/Member.js";
import { AttendanceEvent } from "../models/Attendance.js";
import { Campaign, ClassSession, Trainer } from "../models/Engagement.js";
import {
  OWNER_DEFAULT_PERMISSIONS,
  TRAINER_DEFAULT_PERMISSIONS,
} from "../constants/domain.js";
import { normalizePhone } from "../services/otpService.js";
import { refreshGymPrice } from "../services/gymProjectionService.js";
import { Attachment } from "../models/Business.js";
import { checkIn } from "../services/attendanceService.js";
import { writeAudit } from "../services/auditService.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import { AppError } from "../utils/AppError.js";
import {
  Advertisement,
  BankAccount,
  Offer,
  Settlement,
} from "../models/Business.js";
import { verifyAttendanceQr } from "../services/attendanceQrService.js";

export {
  createRegistration,
  getRegistration,
  updateRegistration,
  submitRegistration,
} from "./registrationController.js";

export async function dashboard(req: Request, res: Response) {
  const gymId = req.auth!.gymId!;
  const canReadFinance = req.auth!.permissions.includes("finance:read");
  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [
    totalMembers,
    activeMembers,
    expiring,
    todayAttendance,
    revenue,
    classesToday,
  ] = await Promise.all([
    MemberProfile.countDocuments({ gymId, status: { $ne: "ARCHIVED" } }),
    MemberProfile.countDocuments({ gymId, status: "ACTIVE" }),
    Subscription.countDocuments({
      gymId,
      status: "ACTIVE",
      endsAt: { $gte: now, $lte: new Date(now.getTime() + 7 * 86_400_000) },
    }),
    AttendanceEvent.countDocuments({
      gymId,
      type: "CHECK_IN",
      occurredAt: { $gte: startOfDay },
    }),
    canReadFinance
      ? Payment.aggregate([
          {
            $match: {
              gymId: new mongoose.Types.ObjectId(gymId),
              status: "CAPTURED",
              capturedAt: { $gte: monthStart },
            },
          },
          { $group: { _id: null, total: { $sum: "$amountMinor" } } },
        ])
      : Promise.resolve([]),
    ClassSession.countDocuments({
      gymId,
      startsAt: {
        $gte: startOfDay,
        $lt: new Date(startOfDay.getTime() + 86_400_000),
      },
    }),
  ]);
  res.json({
    success: true,
    data: {
      gymStatus:
        (await Gym.findById(gymId).select("status").lean())?.status ||
        "INACTIVE",
      totalMembers,
      activeMembers,
      expiringMemberships: expiring,
      todayAttendance,
      ...(canReadFinance
        ? { monthlyRevenueMinor: revenue[0]?.total || 0 }
        : {}),
      classesToday,
    },
  });
}

export async function getGym(req: Request, res: Response) {
  const gym = await Gym.findById(req.auth!.gymId).lean();
  res.json({
    success: true,
    data: gym ? (await withGymMedia([gym]))[0] : null,
  });
}

export async function updateGym(req: Request, res: Response) {
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(req.body)) {
    if (
      ["address", "contact", "location"].includes(key) &&
      value &&
      typeof value === "object"
    )
      for (const [child, entry] of Object.entries(value))
        update[key + "." + child] = entry;
    else update[key] = value;
  }
  const before = await Gym.findById(req.auth!.gymId).lean();
  if (
    req.body.mediaAttachmentIds !== undefined ||
    req.body.coverAttachmentId !== undefined
  ) {
    await validateGymMedia(
      req.auth!.gymId!,
      (req.body.mediaAttachmentIds ?? before?.mediaAttachmentIds ?? []).map(
        String,
      ),
      req.body.coverAttachmentId === undefined
        ? before?.coverAttachmentId?.toString()
        : req.body.coverAttachmentId,
    );
  }
  const gym = await Gym.findOneAndUpdate(
    { _id: req.auth!.gymId, status: { $ne: "ARCHIVED" } },
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  await writeAudit(req, {
    action: "gym.profile.updated",
    entityType: "Gym",
    entityId: gym.publicId,
    before,
    after: gym,
  });
  res.json({ success: true, data: gym });
}

export async function listMembers(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter: Record<string, unknown> = { gymId: req.auth!.gymId };
  if (req.query.status) filter.status = req.query.status;
  const [members, total] = await Promise.all([
    MemberProfile.find(filter)
      .populate("userId", "publicId name phone email avatarUrl")
      .populate("currentSubscriptionId")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MemberProfile.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: members,
    meta: pageMeta(page, limit, total),
  });
}

export async function createMember(req: Request, res: Response) {
  const phone = req.body.phone ? normalizePhone(req.body.phone) : undefined;
  const email = req.body.email?.trim().toLowerCase();
  let user = await User.findOne({
    $or: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])],
  });
  if (!user) {
    user = await User.create({
      publicId: nanoid(18),
      name: req.body.name,
      phone,
      email,
      roles: ["USER"],
      status: "PENDING_VERIFICATION",
    });
  }
  const member = await MemberProfile.create({
    publicId: nanoid(18),
    gymId: req.auth!.gymId,
    userId: user._id,
    memberCode: req.body.memberCode || `GFU-${nanoid(8).toUpperCase()}`,
    fitnessGoal: req.body.fitnessGoal,
    emergencyContact: req.body.emergencyContact,
  });
  res.status(201).json({ success: true, data: member });
}

export async function getMember(req: Request, res: Response) {
  const member = await MemberProfile.findOne({
    publicId: req.params.id,
    gymId: req.auth!.gymId,
  })
    .populate("userId", "publicId name phone email avatarUrl profile")
    .populate("currentSubscriptionId")
    .lean();
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  const [attendance, payments] = await Promise.all([
    AttendanceEvent.find({ memberProfileId: member._id })
      .sort({ occurredAt: -1 })
      .limit(90)
      .lean(),
    Payment.find({
      payerId: (member.userId as any)._id,
      gymId: req.auth!.gymId,
    })
      .sort({ createdAt: -1 })
      .lean(),
  ]);
  res.json({ success: true, data: { member, attendance, payments } });
}

export async function listPlans(req: Request, res: Response) {
  const plans = await MembershipPlan.find({
    gymId: req.auth!.gymId,
    status: { $ne: "ARCHIVED" },
  })
    .sort({ priceMinor: 1 })
    .lean();
  res.json({ success: true, data: plans });
}

export async function createPlan(req: Request, res: Response) {
  const plan = await MembershipPlan.create({
    ...req.body,
    publicId: nanoid(18),
    gymId: req.auth!.gymId,
  });
  await refreshGymPrice(req.auth!.gymId);
  res.status(201).json({ success: true, data: plan });
}

export async function updatePlan(req: Request, res: Response) {
  const plan = await MembershipPlan.findOneAndUpdate(
    { publicId: req.params.id, gymId: req.auth!.gymId },
    { $set: req.body },
    { new: true, runValidators: true },
  ).lean();
  if (!plan) throw new AppError(404, "PLAN_NOT_FOUND", "Plan not found.");
  await refreshGymPrice(req.auth!.gymId);
  res.json({ success: true, data: plan });
}

export async function scanMember(req: Request, res: Response) {
  const qr = req.body.qrToken
    ? verifyAttendanceQr(req.body.qrToken)
    : undefined;
  if (qr && qr.gymId !== req.auth!.gymId)
    throw new AppError(409, "WRONG_GYM_QR", "This QR belongs to another gym.");
  const result = await checkIn({
    gymId: req.auth!.gymId!,
    memberIdentifier: qr?.memberId || req.body.memberIdentifier,
    actorId: req.auth!.userId,
    source: req.body.source || "QR",
    scannerId: req.body.scannerId,
    qrNonce: qr?.nonce || req.body.qrNonce,
    location: req.body.location,
    idempotencyKey: req.idempotencyKey,
  });
  res
    .status(result.duplicate ? 200 : 201)
    .json({ success: true, data: result });
}

export async function listClasses(req: Request, res: Response) {
  const data = await ClassSession.find({ gymId: req.auth!.gymId })
    .sort({ startsAt: 1 })
    .lean();
  res.json({ success: true, data });
}

export async function createClass(req: Request, res: Response) {
  if (
    req.body.trainerId &&
    !(await Trainer.exists({
      _id: req.body.trainerId,
      gymId: req.auth!.gymId,
      status: "ACTIVE",
    }))
  )
    throw new AppError(
      422,
      "TRAINER_INVALID",
      "Select an active trainer at this gym.",
    );
  const session = await ClassSession.create({
    ...req.body,
    publicId: nanoid(18),
    gymId: req.auth!.gymId,
  });
  res.status(201).json({ success: true, data: session });
}

export async function listTrainers(req: Request, res: Response) {
  const data = await Trainer.find({
    gymId: req.auth!.gymId,
    status: { $ne: "ARCHIVED" },
  }).lean();
  res.json({ success: true, data });
}

export async function createTrainer(req: Request, res: Response) {
  const user = await User.findOne({
    email: req.body.email.toLowerCase(),
    status: "ACTIVE",
  });
  if (!user)
    throw new AppError(
      422,
      "TRAINER_ACCOUNT_REQUIRED",
      "The trainer must create an account with this email first.",
    );
  if (await Trainer.exists({ userId: user._id, gymId: req.auth!.gymId }))
    throw new AppError(
      409,
      "TRAINER_EXISTS",
      "This trainer already belongs to this gym.",
    );
  const trainer = await Trainer.create({
    ...req.body,
    publicId: nanoid(18),
    gymId: req.auth!.gymId,
    userId: user._id,
  });
  await RoleAssignment.findOneAndUpdate(
    { userId: user._id, gymId: req.auth!.gymId, role: "TRAINER" },
    { $set: { permissions: TRAINER_DEFAULT_PERMISSIONS, status: "ACTIVE" } },
    { upsert: true },
  );
  await User.updateOne({ _id: user._id }, { $addToSet: { roles: "TRAINER" } });
  res.status(201).json({ success: true, data: trainer });
}

export async function listCampaigns(req: Request, res: Response) {
  const data = await Campaign.find({ gymId: req.auth!.gymId })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data });
}

export async function createCampaign(req: Request, res: Response) {
  const campaign = await Campaign.create({
    ...req.body,
    publicId: nanoid(18),
    gymId: req.auth!.gymId,
    createdBy: req.auth!.userId,
    status: "DRAFT",
  });
  res.status(201).json({ success: true, data: campaign });
}

export async function listSubscriptions(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter: any = { gymId: req.auth!.gymId };
  if (req.query.status) filter.status = req.query.status;
  const [data, total] = await Promise.all([
    Subscription.find(filter)
      .populate("userId", "publicId name phone email")
      .populate("memberProfileId", "publicId memberCode")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Subscription.countDocuments(filter),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}
export async function subscriptionAction(req: Request, res: Response) {
  const subscription = await Subscription.findOne({
    publicId: req.params.id,
    gymId: req.auth!.gymId,
  });
  if (!subscription)
    throw new AppError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found.",
    );
  const action = req.params.action;
  if (
    action === "activate" &&
    ["GRACE", "FROZEN"].includes(subscription.status) &&
    subscription.endsAt > new Date()
  )
    subscription.status = "ACTIVE";
  else if (
    action === "cancel" &&
    ["ACTIVE", "FROZEN", "GRACE"].includes(subscription.status)
  ) {
    subscription.status = "CANCELLED";
    subscription.cancelledAt = new Date();
    subscription.cancellationReason = req.body.reason;
  } else
    throw new AppError(
      409,
      "INVALID_SUBSCRIPTION_TRANSITION",
      "This subscription action is not allowed.",
    );
  await subscription.save();
  await writeAudit(req, {
    action: `subscription.${action}`,
    entityType: "Subscription",
    entityId: subscription.publicId,
    after: { status: subscription.status },
  });
  res.json({ success: true, data: subscription });
}
export async function listOffers(req: Request, res: Response) {
  res.json({
    success: true,
    data: await Offer.find({
      gymId: req.auth!.gymId,
      status: { $ne: "ARCHIVED" },
    })
      .sort({ createdAt: -1 })
      .lean(),
  });
}
export async function createOffer(req: Request, res: Response) {
  const data = await Offer.create({
    ...req.body,
    publicId: nanoid(20),
    gymId: req.auth!.gymId,
    createdBy: req.auth!.userId,
  });
  res.status(201).json({ success: true, data });
}
export async function updateOffer(req: Request, res: Response) {
  const data = await Offer.findOneAndUpdate(
    { publicId: req.params.id, gymId: req.auth!.gymId },
    { $set: req.body },
    { new: true, runValidators: true },
  );
  if (!data) throw new AppError(404, "OFFER_NOT_FOUND", "Offer not found.");
  res.json({ success: true, data });
}
export async function listAds(req: Request, res: Response) {
  res.json({
    success: true,
    data: await Advertisement.find({
      gymId: req.auth!.gymId,
      status: { $ne: "ARCHIVED" },
    })
      .sort({ createdAt: -1 })
      .lean(),
  });
}
export async function createAd(req: Request, res: Response) {
  const data = await Advertisement.create({
    ...req.body,
    publicId: nanoid(20),
    gymId: req.auth!.gymId,
    createdBy: req.auth!.userId,
  });
  res.status(201).json({ success: true, data });
}
export async function revenue(req: Request, res: Response) {
  const [captured, refunds, settlements, bank] = await Promise.all([
    Payment.aggregate([
      {
        $match: {
          gymId: new mongoose.Types.ObjectId(req.auth!.gymId),
          status: { $in: ["CAPTURED", "PARTIALLY_REFUNDED"] },
        },
      },
      { $group: { _id: null, grossMinor: { $sum: "$amountMinor" } } },
    ]),
    (await import("../models/Business.js")).Refund.aggregate([
      {
        $lookup: {
          from: "payments",
          localField: "paymentId",
          foreignField: "_id",
          as: "payment",
        },
      },
      { $unwind: "$payment" },
      {
        $match: {
          "payment.gymId": new mongoose.Types.ObjectId(req.auth!.gymId),
          status: "PROCESSED",
        },
      },
      { $group: { _id: null, total: { $sum: "$amountMinor" } } },
    ]),
    Settlement.find({ gymId: req.auth!.gymId })
      .sort({ createdAt: -1 })
      .limit(50)
      .lean(),
    BankAccount.findOne({ gymId: req.auth!.gymId }).lean(),
  ]);
  const gross = captured[0]?.grossMinor || 0,
    refunded = refunds[0]?.total || 0;
  res.json({
    success: true,
    data: {
      grossMinor: gross,
      refundMinor: refunded,
      netMinor: gross - refunded,
      bankAccount: bank,
      settlements,
    },
  });
}
