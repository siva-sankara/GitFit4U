import type { Request, Response } from "express";
import { z } from "zod";
import { transitionMembership } from "../services/membershipLifecycleService.js";
import { privatePendingMember } from "../services/memberInvitationPrivacy.js";
import { redactPendingAccountRows } from "../services/tenantAccountPrivacy.js";
import mongoose, { type ClientSession } from "mongoose";
import { lockAttachments } from "../services/mediaBindingService.js";
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
import { Campaign, ClassBooking, ClassSession, Trainer } from "../models/Engagement.js";
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
  BankAccount,
  Settlement,
} from "../models/Business.js";
import { verifyAttendanceQr } from "../services/attendanceQrService.js";
import {
  calendarDate,
  calendarDaysRemaining,
  shiftCalendarDate,
  zonedDayStart,
} from "../utils/gymCalendar.js";
import {
  withTrainerMedia,
  withMemberMedia,
} from "../services/userMediaService.js";
import { saveGymClass } from "../services/classManagementService.js";
import { withClassMedia } from "../services/classMediaService.js";

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
  const gym = await Gym.findById(gymId)
    .select("publicId name logoUrl logoAttachmentId status timezone platformSubscriptionStatus")
    .lean();
  const timezone = gym?.timezone || "Asia/Kolkata";
  const today = calendarDate(now, timezone);
  const startOfDay = zonedDayStart(today, timezone);
  const endOfDay = zonedDayStart(shiftCalendarDate(today, 1), timezone);
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
      type: "GYM_MEMBERSHIP",
      status: "ACTIVE",
      endsAt: { $gte: now, $lt: zonedDayStart(shiftCalendarDate(today, 8), timezone) },
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
        $lt: endOfDay,
      },
    }),
  ]);
  const platform =
    req.auth!.role === "GYM_OWNER"
      ? await Subscription.findOne({
          gymId,
          type: "PLATFORM",
          status: { $ne: "PENDING_PAYMENT" },
        })
          .sort({ endsAt: -1, createdAt: -1 })
          .lean()
      : null;
  res.json({
    success: true,
    data: {
      gymStatus: gym?.status || "INACTIVE",
      gym: gym ? (await withGymMedia([gym]))[0] : null,
      timezone,
      platformSubscription: platform
        ? {
            publicId: platform.publicId,
            planId: platform.planId,
            status: platform.status,
            adminAuthorization: platform.adminAuthorization,
            plan: platform.planSnapshot,
            startsAt: platform.startsAt,
            endsAt: platform.endsAt,
            daysRemaining: platform.endsAt
              ? calendarDaysRemaining(platform.endsAt, now, timezone)
              : null,
            usage: {
              members: activeMembers,
              memberLimit: platform.planSnapshot?.memberLimit ?? null,
            },
            canRenew: ["ACTIVE", "EXPIRED", "GRACE"].includes(platform.status),
            renewalUrl: "/owner/platform-subscription",
          }
        : null,
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
    data: gym ? (await withGymMedia([gym], { mediaLimit: 4 }))[0] : null,
  });
}

export async function listGymMedia(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const gym: any = await Gym.findById(req.auth!.gymId)
    .select("_id mediaAttachmentIds mediaCaptions coverAttachmentId")
    .lean();
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  const ids = (gym.mediaAttachmentIds || []).slice(skip, skip + limit);
  const resolved: any = (
    await withGymMedia([{ ...gym, mediaAttachmentIds: ids }])
  )[0];
  res.json({
    success: true,
    data: resolved.media || [],
    meta: pageMeta(page, limit, gym.mediaAttachmentIds.length),
  });
}

export async function updateGymMediaCaption(req: Request, res: Response) {
  const caption = z.string().trim().max(500).parse(req.body.caption);
  const mediaId = String(req.params.mediaId);
  if (!mongoose.isValidObjectId(mediaId))
    throw new AppError(422, "GYM_MEDIA_INVALID", "Choose a valid gym media item.");
  const gym = await Gym.findOneAndUpdate(
    { _id: req.auth!.gymId, mediaAttachmentIds: mediaId },
    { $set: { [`mediaCaptions.${mediaId}`]: caption } },
    { returnDocument: "after", runValidators: true },
  ).lean();
  if (!gym) throw new AppError(404, "GYM_MEDIA_NOT_FOUND", "Gym media item not found.");
  await writeAudit(req, { action: "gym.media.caption.updated", entityType: "GymMedia", entityId: mediaId });
  res.json({ success: true, data: { mediaId, caption } });
}

export async function deleteGymMedia(req: Request, res: Response) {
  const mediaId = String(req.params.mediaId);
  if (!mongoose.isValidObjectId(mediaId))
    throw new AppError(422, "GYM_MEDIA_INVALID", "Choose a valid gym media item.");
  const gym: any = await Gym.findOne({ _id: req.auth!.gymId, mediaAttachmentIds: mediaId }).select("coverAttachmentId");
  if (!gym) throw new AppError(404, "GYM_MEDIA_NOT_FOUND", "Gym media item not found.");
  const update: any = { $pull: { mediaAttachmentIds: mediaId }, $unset: { [`mediaCaptions.${mediaId}`]: 1 } };
  if (String(gym.coverAttachmentId || "") === mediaId) update.$set = { coverAttachmentId: null };
  await Gym.updateOne({ _id: gym._id }, update);
  await writeAudit(req, { action: "gym.media.removed", entityType: "GymMedia", entityId: mediaId });
  res.status(204).send();
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
  const bindingIds = [req.body.logoAttachmentId, req.body.coverAttachmentId,
    ...(req.body.mediaAttachmentIds || [])].filter(Boolean);
  const save = async (session?: ClientSession) => {
  const beforeQuery = Gym.findById(req.auth!.gymId);
  if (session) beforeQuery.session(session);
  const before = await beforeQuery.lean();
  if (req.body.logoAttachmentId !== undefined) {
    await validateGymLogo(req.auth!.gymId!, req.body.logoAttachmentId, session);
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
      session,
    );
  }
  if (session) await lockAttachments(bindingIds, session);
  const gym = await Gym.findOneAndUpdate(
    { _id: req.auth!.gymId, status: { $ne: "ARCHIVED" } },
    { $set: update },
    { returnDocument: "after", runValidators: true, ...(session ? { session } : {}) },
  ).lean();
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  return { before, gym };
  };
  const { before, gym } = bindingIds.length
    ? await mongoose.connection.transaction((session) => save(session))
    : await save();
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
  const filter: Record<string, unknown> = {
    gymId: req.auth!.gymId,
    isDeleted: { $ne: true },
  };
  const gym = await Gym.findById(req.auth!.gymId).select("timezone publicId").lean();
  const timezone = gym?.timezone || "Asia/Kolkata",
    now = new Date();
  const filters = z
    .object({
      q: z.string().max(120).optional(),
      status: z
        .enum([
          "",
          "JOIN_REQUESTED",
          "ACTIVE",
          "INACTIVE",
          "SUSPENDED",
          "ARCHIVED",
        ])
        .optional(),
      membershipStatus: z
        .enum([
          "",
          "ACTIVE",
          "EXPIRING",
          "FROZEN",
          "EXPIRED",
          "CANCELLED",
          "DEACTIVATED",
          "GRACE",
          "PENDING_PAYMENT",
          "NONE",
        ])
        .optional(),
      planId: z.string().max(64).optional(),
      trainerId: z.string().max(64).optional(),
      paymentStatus: z
        .enum(["", "CAPTURED", "DUE", "FAILED", "NONE"])
        .optional(),
      sort: z
        .enum(["JOINED_DESC", "JOINED_ASC", "NAME_ASC", "NAME_DESC"])
        .default("JOINED_DESC"),
    })
    .parse(req.query);
  if (filters.paymentStatus && !canReadFinance)
    throw new AppError(
      403,
      "FINANCE_ACCESS_REQUIRED",
      "Payment filters require finance access.",
    );
  if (filters.status) filter.status = filters.status;
  if (filters.trainerId === "none") filter.assignedTrainerId = null;
  else if (filters.trainerId) {
    if (!mongoose.isValidObjectId(filters.trainerId))
      throw new AppError(
        422,
        "TRAINER_INVALID",
        "Choose a trainer from this gym.",
      );
    filter.assignedTrainerId = filters.trainerId;
  }
  const subscriptionScope = { gymId: req.auth!.gymId, type: "GYM_MEMBERSHIP" };
  const membershipClauses: Record<string, unknown>[] = [];
  if (filters.planId) {
      const plan = await MembershipPlan.findOne({
        gymId: req.auth!.gymId,
        publicId: filters.planId,
      })
        .select("_id publicId")
        .lean();
      if (!plan)
        throw new AppError(
          422,
          "PLAN_INVALID",
          "Choose a membership plan from this gym.",
        );
      filter.currentSubscriptionId = { $in: await Subscription.distinct("_id", {
        ...subscriptionScope, "planSnapshot.planId": plan.publicId,
      }) };
  }
  if (filters.paymentStatus) {
    if (filters.paymentStatus === "NONE") {
      const withoutPayment = await Subscription.distinct("_id", {
        ...subscriptionScope,
        $or: [
          { latestPaymentId: null },
          { latestPaymentId: { $exists: false } },
        ],
      });
      membershipClauses.push({
        $or: [
          { currentSubscriptionId: null },
          { currentSubscriptionId: { $in: withoutPayment } },
        ],
      });
    } else {
      const paymentStatuses =
        filters.paymentStatus === "DUE"
          ? ["CREATED", "PENDING", "AUTHORIZED"]
          : filters.paymentStatus === "FAILED"
            ? ["FAILED", "CANCELLED"]
            : ["CAPTURED"];
      const paymentIds = await Payment.distinct("_id", {
        gymId: req.auth!.gymId,
        purpose: "MEMBERSHIP",
        status: { $in: paymentStatuses },
      });
      const subscriptionPaymentFilter: Record<string, unknown> =
        filters.paymentStatus === "DUE"
          ? {
              ...subscriptionScope,
              $or: [
                { status: "PENDING_PAYMENT" },
                { latestPaymentId: { $in: paymentIds } },
              ],
            }
          : {
              ...subscriptionScope,
              latestPaymentId: { $in: paymentIds },
            };
      const matchingSubscriptions = await Subscription.distinct(
        "_id",
        subscriptionPaymentFilter,
      );
      membershipClauses.push({
        currentSubscriptionId: { $in: matchingSubscriptions },
      });
    }
  }
  const inactive = ["INACTIVE", "ARCHIVED", "SUSPENDED"];
  if (filters.membershipStatus === "NONE") {
    membershipClauses.push({ currentSubscriptionId: null, directAccess: { $ne: true }, status: { $nin: inactive } });
  } else if (filters.membershipStatus) {
    const subscriptionFilter: Record<string, unknown> = { ...subscriptionScope };
    if (filters.membershipStatus === "EXPIRING") {
      subscriptionFilter.status = "ACTIVE";
      subscriptionFilter.endsAt = {
        $gte: now,
        $lt: zonedDayStart(
          shiftCalendarDate(calendarDate(now, timezone), 8),
          timezone,
        ),
      };
    } else if (filters.membershipStatus === "EXPIRED")
      subscriptionFilter.$or = [
        { status: "EXPIRED" },
        { status: { $in: ["ACTIVE", "GRACE"] }, endsAt: { $lt: now } },
      ];
    else if (filters.membershipStatus) {
      subscriptionFilter.status = filters.membershipStatus;
      if (["ACTIVE", "GRACE"].includes(filters.membershipStatus))
        subscriptionFilter.endsAt = { $gte: now };
    }
    const subscribed = { currentSubscriptionId: { $in: await Subscription.distinct("_id", subscriptionFilter) } };
    if (filters.membershipStatus === "DEACTIVATED")
      membershipClauses.push({ $or: [{ status: { $in: ["INACTIVE", "SUSPENDED"] } }, { status: { $ne: "ARCHIVED" }, ...subscribed }] });
    else if (filters.membershipStatus === "CANCELLED")
      membershipClauses.push({ $or: [{ status: "ARCHIVED" }, { status: { $nin: ["INACTIVE", "SUSPENDED"] }, ...subscribed }] });
    else {
      membershipClauses.push({ status: { $nin: inactive } });
      membershipClauses.push(filters.membershipStatus === "ACTIVE"
        ? { $or: [subscribed, { currentSubscriptionId: null, directAccess: true }] }
        : subscribed);
    }
  }
  if (membershipClauses.length) filter.$and = membershipClauses;
  if (filters.q) {
    const query = filters.q
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
  const sort: Record<string, 1 | -1> =
    filters.sort === "JOINED_ASC"
      ? { joinedAt: 1, _id: 1 }
      : filters.sort === "NAME_ASC"
        ? { "contact.name": 1, _id: 1 }
        : filters.sort === "NAME_DESC"
          ? { "contact.name": -1, _id: 1 }
          : { joinedAt: -1, _id: -1 };
  const [members, total, summaryTotal, summaryPending, activeSubscriptions] = await Promise.all([
    MemberProfile.find(filter)
      .populate(
        "userId",
        "publicId name phone email status avatarUrl avatarAttachmentId",
      )
      .populate({
        path: "assignedTrainerId",
        match: { gymId: req.auth!.gymId },
        select: "name phone userId status photoUrl photoAttachmentId",
        populate: { path: "userId", select: "phone" },
      })
      .populate({
        path: "currentSubscriptionId",
        select:
          "publicId status startsAt endsAt renewalAt " +
          (canReadFinance
            ? "planSnapshot latestPaymentId"
            : "planSnapshot.name planSnapshot.durationDays planSnapshot.freezeDaysAllowed"),
        ...(canReadFinance
          ? { populate: { path: "latestPaymentId", select: "publicId status" } }
          : {}),
      })
      .sort(sort)
      .skip(skip)
      .limit(limit)
      .lean(),
    MemberProfile.countDocuments(filter),
    MemberProfile.countDocuments({
      gymId: req.auth!.gymId,
      isDeleted: { $ne: true },
      status: { $ne: "ARCHIVED" },
    }),
    MemberProfile.countDocuments({
      gymId: req.auth!.gymId,
      isDeleted: { $ne: true },
      status: { $ne: "ARCHIVED" },
      "invitation.status": "PENDING",
    }),
    Subscription.distinct("_id", {
      ...subscriptionScope,
      status: { $in: ["ACTIVE", "GRACE"] },
      endsAt: { $gte: now },
    }),
  ]);
  const summaryActive = await MemberProfile.countDocuments({
    gymId: req.auth!.gymId,
    isDeleted: { $ne: true },
    status: "ACTIVE",
    $or: [
      { directAccess: true },
      { currentSubscriptionId: { $in: activeSubscriptions } },
    ],
  });
  let summaryPaymentDue: number | null = null;
  if (canReadFinance) {
    const duePaymentIds = await Payment.distinct("_id", {
      gymId: req.auth!.gymId,
      purpose: "MEMBERSHIP",
      status: { $in: ["CREATED", "PENDING", "AUTHORIZED", "FAILED"] },
    });
    const dueSubscriptionIds = await Subscription.distinct("_id", {
      ...subscriptionScope,
      $or: [
        { status: "PENDING_PAYMENT" },
        { latestPaymentId: { $in: duePaymentIds } },
      ],
    });
    summaryPaymentDue = await MemberProfile.countDocuments({
      gymId: req.auth!.gymId,
      isDeleted: { $ne: true },
      status: { $ne: "ARCHIVED" },
      currentSubscriptionId: { $in: dueSubscriptionIds },
    });
  }
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
  const trainers = await withTrainerMedia(
    members.flatMap((member: any) =>
      member.assignedTrainerId ? [member.assignedTrainerId] : [],
    ),
  );
  const resolvedMembers = await withMemberMedia(members);
  res.json({
    success: true,
    data: resolvedMembers.map((member: any) => ({
      ...privatePendingMember(member),
      assignedTrainerId:
        trainers.find(
          (trainer: any) =>
            String(trainer._id) === String(member.assignedTrainerId?._id),
        ) || member.assignedTrainerId,
      attendanceVisits30Days: visitCounts.get(String(member._id)) || 0,
    })),
    meta: {
      ...pageMeta(page, limit, total),
      timezone,
      serverNow: now.toISOString(),
      summary: {
        total: summaryTotal,
        active: summaryActive,
        pendingActivation: summaryPending,
        paymentDue: summaryPaymentDue,
      },
    },
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
    isDeleted: { $ne: true },
  })
    .select("+medicalNotes")
    .populate(
      "userId",
      "publicId name phone email status avatarUrl avatarAttachmentId profile",
    )
    .populate({
      path: "assignedTrainerId",
      match: { gymId: req.auth!.gymId },
      select:
        "publicId name userId photoUrl photoAttachmentId phone email specializations experienceYears qualifications availability status",
      populate: {
        path: "userId",
        select: "name phone email avatarUrl avatarAttachmentId",
      },
    })
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
          .limit(50)
          .lean()
      : Promise.resolve([]),
  ]);
  if (member.assignedTrainerId)
    member.assignedTrainerId = (
      await withTrainerMedia([member.assignedTrainerId])
    )[0];
  const gym = await Gym.findById(req.auth!.gymId).select("timezone publicId").lean();
  res.json({
    success: true,
    data: {
      member: privatePendingMember((await withMemberMedia([member]))[0]),
      gymPublicId: gym?.publicId,
      attendance,
      payments,
      timezone: gym?.timezone || "Asia/Kolkata",
    },
  });
}

export async function listPlans(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  const filter: any = {
    gymId: req.auth!.gymId,
    status: { $ne: "ARCHIVED" },
    ...(q ? { name: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") } : {}),
  };
  const [plans, total] = await Promise.all([
    MembershipPlan.find(filter).sort({ priceMinor: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    MembershipPlan.countDocuments(filter),
  ]);
  res.json({ success: true, data: plans, meta: pageMeta(page, limit, total) });
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
    { returnDocument: "after", runValidators: true },
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
    actorRole: req.auth!.role,
    reason: req.body.reason,
    source: "MANUAL",
    idempotencyKey: req.idempotencyKey,
  });
  res
    .status(result.duplicate ? 200 : 201)
    .json({ success: true, data: result });
}

export async function listClasses(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const query = z
    .object({
      status: z.enum(["", "SCHEDULED", "CANCELLED", "COMPLETED"]).optional(),
      q: z.string().max(120).optional(),
    })
    .parse(req.query);
  const filter = {
    gymId: req.auth!.gymId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.q
      ? {
          name: new RegExp(query.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"),
        }
      : {}),
  };
  const data = await ClassSession.find(filter)
    .populate("gymId", "name timezone")
    .populate("trainerId", "publicId name photoUrl photoAttachmentId status")
    .sort({ startsAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
  const trainers = await withTrainerMedia(
    data.flatMap((row: any) => (row.trainerId ? [row.trainerId] : [])),
  );
  res.json({
    success: true,
    data: (await withClassMedia(data)).map((row: any) => ({
      ...row,
      trainerId:
        trainers.find(
          (trainer: any) => String(trainer._id) === String(row.trainerId?._id),
        ) || row.trainerId,
    })),
    meta: pageMeta(page, limit, await ClassSession.countDocuments(filter)),
  });
}

export async function createClass(req: Request, res: Response) {
  const data = await saveGymClass({ gymId: req.auth!.gymId!, actorId: req.auth!.userId, body: req.body });
  await writeAudit(req, {
    action: "class.created",
    entityType: "ClassSession",
    entityId: data.publicId,
  });
  res.status(201).json({ success: true, data });
}

export async function cancelClass(req: Request, res: Response) {
  const body = z
    .object({ reason: z.string().trim().min(3).max(500) })
    .parse(req.body);
  const data = await saveGymClass({
    gymId: req.auth!.gymId!,
    publicId: String(req.params.id),
    body: {},
    cancel: true,
    reason: body.reason,
  });
  await writeAudit(req, {
    action: "class.cancelled",
    entityType: "ClassSession",
    entityId: data.publicId,
  });
  res.json({ success: true, data });
}

export async function listTrainers(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 120) : "";
  const filter: any = {
    gymId: req.auth!.gymId,
    status: { $ne: "ARCHIVED" },
    ...(q ? { $or: ["name", "email", "phone"].map((field) => ({ [field]: new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") })) } : {}),
  };
  const [data, total] = await Promise.all([Trainer.find(filter)
    .populate("userId", "name email phone avatarUrl avatarAttachmentId")
    .sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(), Trainer.countDocuments(filter)]);
  res.json({ success: true, data: await withTrainerMedia(data), meta: pageMeta(page, limit, total) });
}

export { saveTrainer as createTrainer } from "./memberManagementController.js";

export async function listCampaigns(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { gymId: req.auth!.gymId };
  const [data, total] = await Promise.all([
    Campaign.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    Campaign.countDocuments(filter),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}

export async function listClassBookings(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const classSession = await ClassSession.findOne({
    publicId: String(req.params.id),
    gymId: req.auth!.gymId,
  }).select("_id publicId name").lean();
  if (!classSession) throw new AppError(404, "CLASS_NOT_FOUND", "Class not found in this gym.");
  const filter = { sessionId: classSession._id };
  const [data, total] = await Promise.all([
    ClassBooking.find(filter)
      .select("memberProfileId status bookedAt cancelledAt")
      .populate("memberProfileId", "publicId memberCode contact status")
      .sort({ bookedAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    ClassBooking.countDocuments(filter),
  ]);
  const members = await withMemberMedia(data.map((row: any) => row.memberProfileId).filter(Boolean));
  res.json({
    success: true,
    data: data.map((row: any) => ({
      ...row,
      memberProfileId: members.find((member: any) => String(member._id) === String(row.memberProfileId?._id)) || row.memberProfileId,
    })),
    meta: pageMeta(page, limit, total),
  });
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
  res.json({ success: true, data: await redactPendingAccountRows(data, req.auth!.gymId, "userId"), meta: pageMeta(page, limit, total) });
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
    actorRole: req.auth!.role,
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
export { listOffers, createOffer, updateOffer, listAds, createAd, updateAd } from "./promotionController.js";
export async function revenue(req: Request, res: Response) {
  res.json({
    success: true,
    data: await gymRevenue(
      req.auth!.gymId!,
      req.query.from,
      req.query.to,
      req.query.period,
    ),
  });
}
