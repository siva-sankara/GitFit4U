import type { Request, Response } from "express";
import { z } from "zod";
import { transitionMembership } from "../services/membershipLifecycleService.js";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Gym } from "../models/Gym.js";
import { gymRevenue } from "../services/revenueService.js";
import {
  validateGymLogo,
  validateGymMedia,
  withGymMedia,
} from "../services/gymMediaService.js";
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
      ? gymRevenue(gymId).then((report) => [{ total: report.monthMinor }])
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
  if (req.body.logoAttachmentId !== undefined) {
    await validateGymLogo(req.auth!.gymId!, req.body.logoAttachmentId);
    if (req.body.logoAttachmentId === null) update.logoUrl = null;
  }
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
  const canReadFinance =
    req.auth!.permissions.includes("finance:read") ||
    req.auth!.role === "ADMIN";
  const filter: Record<string, unknown> = { gymId: req.auth!.gymId };
  if (req.query.status) filter.status = req.query.status;
  if (req.query.q) {
    const query = String(req.query.q)
      .trim()
      .slice(0, 120)
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(query, "i");
    const users = await User.distinct("_id", {
      $or: [{ name: regex }, { email: regex }, { phone: regex }],
    });
    filter.$or = [
      { userId: { $in: users } },
      { memberCode: regex },
      { "contact.name": regex },
      { "contact.email": regex },
      { "contact.phone": regex },
    ];
  }
  const [members, total] = await Promise.all([
    MemberProfile.find(filter)
      .populate("userId", "publicId name phone email avatarUrl")
      .populate({
        path: "currentSubscriptionId",
        select:
          "publicId status startsAt endsAt " +
          (canReadFinance
            ? "planSnapshot latestPaymentId"
            : "planSnapshot.name planSnapshot.durationDays planSnapshot.freezeDaysAllowed"),
        ...(canReadFinance
          ? { populate: { path: "latestPaymentId", select: "publicId status" } }
          : {}),
      })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    MemberProfile.countDocuments(filter),
  ]);
  const visits = members.length
    ? await AttendanceEvent.aggregate<{
        _id: mongoose.Types.ObjectId;
        count: number;
      }>([
        {
          $match: {
            gymId: new mongoose.Types.ObjectId(req.auth!.gymId),
            memberProfileId: { $in: members.map((member: any) => member._id) },
            type: "CHECK_IN",
            occurredAt: {
              $gte: new Date(Date.now() - 30 * 86400000),
              $lte: new Date(),
            },
          },
        },
        { $group: { _id: "$memberProfileId", count: { $sum: 1 } } },
      ])
    : [];
  const visitCounts = new Map(
    visits.map((visit) => [String(visit._id), visit.count]),
  );
  res.json({
    success: true,
    data: members.map((member: any) => ({
      ...member,
      attendanceVisits30Days: visitCounts.get(String(member._id)) || 0,
    })),
    meta: pageMeta(page, limit, total),
  });
}

export { createMemberWithMembership as createMember } from "./memberManagementController.js";

export async function getMember(req: Request, res: Response) {
  const canReadFinance =
    req.auth!.permissions.includes("finance:read") ||
    req.auth!.role === "ADMIN";
  const member = await MemberProfile.findOne({
    publicId: req.params.id,
    gymId: req.auth!.gymId,
  })
    .select("+medicalNotes")
    .populate("userId", "publicId name phone email avatarUrl profile")
    .populate({
      path: "currentSubscriptionId",
      select:
        "publicId status startsAt endsAt freezePeriods " +
        (canReadFinance
          ? "planSnapshot latestPaymentId"
          : "planSnapshot.name planSnapshot.durationDays planSnapshot.freezeDaysAllowed"),
    })
    .lean();
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  const [attendance, payments] = await Promise.all([
    AttendanceEvent.find({ memberProfileId: member._id })
      .sort({ occurredAt: -1 })
      .limit(90)
      .lean(),
    canReadFinance
      ? Payment.find({
          payerId: (member.userId as any)._id,
          gymId: req.auth!.gymId,
        })
          .sort({ createdAt: -1 })
          .lean()
      : Promise.resolve([]),
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
  if (req.body.qrToken || req.body.source === "QR")
    throw new AppError(
      410,
      "ATTENDANCE_FLOW_CHANGED",
      "Members now scan the gym QR from their own device. Use manual check-in for an authorized exception.",
    );
  const result = await checkIn({
    gymId: req.auth!.gymId!,
    memberIdentifier: req.body.memberIdentifier,
    actorId: req.auth!.userId,
    source: "MANUAL",
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
  })
    .populate("userId", "name email phone avatarUrl")
    .lean();
  res.json({ success: true, data });
}

export { saveTrainer as createTrainer } from "./memberManagementController.js";

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
  const body = z
    .object({
      reason: z.string().max(1000).optional(),
      endsAt: z.coerce.date().optional(),
    })
    .parse(req.body);
  const action = z
    .enum(["activate", "freeze", "reactivate", "cancel", "deactivate"])
    .parse(req.params.action);
  const data = await transitionMembership({
    publicId: String(req.params.id),
    gymId: req.auth!.gymId,
    actorId: req.auth!.userId,
    action,
    ...body,
  });
  await writeAudit(req, {
    action: "subscription." + action,
    entityType: "Subscription",
    entityId: data.publicId,
    after: { status: data.status, endsAt: data.endsAt },
  });
  res.json({ success: true, data });
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
  res.json({
    success: true,
    data: await gymRevenue(req.auth!.gymId!, req.query.from, req.query.to),
  });
}
