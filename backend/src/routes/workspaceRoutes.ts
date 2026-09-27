import { Router } from "express";
import type { Request } from "express";
import { saveGymClass } from "../services/classManagementService.js";
import mongoose from "mongoose";
import { z } from "zod";
import { nanoid } from "nanoid";
import {
  requireAuth,
  requireGymContext,
  requireRole,
  requirePermission,
} from "../middleware/auth.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { GymRegistration } from "../models/GymRegistration.js";
import {
  Payment,
  Subscription,
  MembershipPlan,
  PlatformPlan,
} from "../models/Commerce.js";
import { AttendanceEvent } from "../models/Attendance.js";
import {
  Campaign,
  ClassSession,
  ClassBooking,
  Trainer,
  Review,
  SupportTicket,
  Notification,
} from "../models/Engagement.js";
import {
  Invoice,
  Refund,
  Offer,
  Advertisement,
  Referral,
  Favorite,
  Attachment,
  Settlement,
} from "../models/Business.js";
import {
  WorkoutPlan,
  WorkoutAssignment,
  ProgressEntry,
} from "../models/Fitness.js";
import { RoleAssignment } from "../models/Auth.js";
import { AuditLog } from "../models/Operations.js";
import { AppError } from "../utils/AppError.js";
import { pageMeta, paginationFromQuery } from "../utils/pagination.js";
import { writeAudit } from "../services/auditService.js";
import {
  memberUpdate,
  classInput,
  platformInput,
  progressInput,
} from "./inputSchemas.js";
import type { Permission } from "../constants/domain.js";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";
import { ensureSupportConversation, notifySupportReply } from "../services/supportConversationService.js";
import { updateMember } from "../controllers/memberManagementController.js";
import { allowedContacts } from "../services/contactService.js";
import { refreshGymRating } from "../services/gymProjectionService.js";
import { withGymMedia } from "../services/gymMediaService.js";
import { withMemberMedia, withUserMedia } from "../services/userMediaService.js";
import {
  registrationStatus,
  legacyRegistrationStates,
} from "../services/registrationService.js";
import { env } from "../config/env.js";
import rateLimit from "express-rate-limit";
import { downloadPaymentInvoice } from "../controllers/invoiceController.js";

export const workspaceRoutes = Router();
workspaceRoutes.use(requireAuth);
workspaceRoutes.get("/payments/:id/invoice", rateLimit({ windowMs: 60000, limit: 15, keyGenerator: req => req.auth!.userId, standardHeaders: "draft-8", legacyHeaders: false }), downloadPaymentInvoice);
workspaceRoutes.get("/registration-options", (_req, res) =>
  res.json({
    success: true,
    data: {
      paymentsAvailable: Boolean(
        env.RAZORPAY_KEY_ID?.trim() &&
        env.RAZORPAY_KEY_SECRET?.trim() &&
        env.RAZORPAY_WEBHOOK_SECRET?.trim(),
      ),
      activationMode: "VERIFIED_PAYMENT",
    },
  }),
);
workspaceRoutes.get("/contacts", async (req, res) =>
  res.json({ success: true, data: await allowedContacts(req) }),
);
workspaceRoutes.post(
  "/campaigns/:id/send",
  requireRole("GYM_OWNER", "GYM_STAFF"),
  requireGymContext,
  requirePermission("campaign:write"),
  async (req, res) => {
    const campaign = await Campaign.findOne({
      publicId: req.params.id,
      gymId: req.auth!.gymId,
    });
    if (!campaign)
      throw new AppError(404, "CAMPAIGN_NOT_FOUND", "Campaign not found.");
    if (campaign.channel !== "IN_APP")
      throw new AppError(
        503,
        "DELIVERY_UNAVAILABLE",
        "This channel requires a configured delivery and consent workflow. Use an in-app campaign.",
      );
    const recipients = await MemberProfile.countDocuments({
      gymId: req.auth!.gymId,
      status: campaign.audience.status,
    });
    const data = await Campaign.findOneAndUpdate(
      { _id: campaign._id, status: "DRAFT" },
      { $set: { status: "QUEUED", "analytics.recipients": recipients } },
      { returnDocument: "after" },
    );
    if (!data)
      throw new AppError(
        409,
        "CAMPAIGN_ALREADY_SUBMITTED",
        "Campaign is already submitted.",
      );
    await writeAudit(req, {
      action: "campaign.queued",
      entityType: "Campaign",
      entityId: campaign.publicId,
    });
    res.status(202).json({ success: true, data });
  },
);
workspaceRoutes.get("/documents/:id/url", async (req, res) => {
  const attachment = await Attachment.findOne({
    publicId: req.params.id,
    status: "READY",
    ...(req.auth!.role === "ADMIN" ? {} : { ownerId: req.auth!.userId }),
  });
  if (!attachment)
    throw new AppError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
  res.json({
    success: true,
    data: { url: attachmentUrl(attachment) },
  });
});
const person = "publicId name email phone avatarUrl avatarAttachmentId";
type Resource = {
  model: any;
  select: string;
  search?: string[];
  populate?: any[];
  sort?: string;
  permission?: Permission;
};
const resources: Record<string, Resource> = {
  notifications: {
    model: Notification,
    select:
      "userId title message category readAt archivedAt pushStatus createdAt",
    search: ["title", "message"],
    populate: [{ path: "userId", select: "name publicId" }],
  },
  members: {
    model: MemberProfile,
    select:
      "publicId gymId userId contact memberCode status fitnessGoal currentSubscriptionId assignedTrainerId trainerAssignedAt joinedAt createdAt",
    search: ["memberCode", "fitnessGoal"],
    populate: [
      { path: "gymId", select: "name publicId" },
      { path: "userId", select: person },
      {
        path: "assignedTrainerId",
        select: "name publicId status photoUrl photoAttachmentId",
      },
      {
        path: "currentSubscriptionId",
        select: "publicId planSnapshot status startsAt endsAt",
      },
    ],
    permission: "member:read",
  },
  plans: {
    model: MembershipPlan,
    select:
      "publicId gymId code name description durationDays priceMinor discountMinor taxRateBasisPoints benefits freezeDaysAllowed status version createdAt",
    populate: [{ path: "gymId", select: "name publicId" }],
    search: ["name", "code"],
    permission: "gym:read",
  },
  subscriptions: {
    model: Subscription,
    select:
      "publicId type userId gymId planSnapshot status startsAt endsAt renewalAt freezePeriods createdAt",
    populate: [
      { path: "userId", select: person },
      { path: "gymId", select: "name slug publicId logoAttachmentId logoUrl timezone" },
    ],
    permission: "member:read",
  },
  payments: {
    model: Payment,
    select:
      "publicId purpose payerId gymId subscriptionId amountMinor currency provider status methodCategory capturedAt failureDescription createdAt",
    populate: [
      { path: "payerId", select: "name publicId" },
      { path: "gymId", select: "name" },
      { path: "subscriptionId", select: "planSnapshot.name" },
    ],
    permission: "finance:read",
  },
  attendance: {
    model: AttendanceEvent,
    select:
      "publicId memberProfileId userId gymId type occurredAt localDate source",
    populate: [
      { path: "userId", select: "name publicId avatarUrl avatarAttachmentId" },
      { path: "gymId", select: "name" },
      { path: "memberProfileId", select: "memberCode gymId contact.name contact.avatarUrl contact.avatarAttachmentId" },
    ],
    sort: "occurredAt",
    permission: "member:read",
  },
  classes: {
    model: ClassSession,
    select:
      "publicId gymId name category trainerId startsAt endsAt capacity bookedCount status room",
    search: ["name", "room"],
    populate: [
      { path: "trainerId", select: "name publicId" },
      { path: "gymId", select: "name" },
    ],
    sort: "startsAt",
    permission: "gym:read",
  },
  trainers: {
    model: Trainer,
    select:
      "publicId gymId name userId phone email experienceYears availability photoUrl qualifications specializations bio status",
    populate: [{ path: "gymId", select: "name publicId" }],
    search: ["name"],
    permission: "gym:read",
  },
  campaigns: {
    model: Campaign,
    select:
      "publicId gymId name channel message audience status analytics createdAt",
    search: ["name"],
    permission: "campaign:write",
  },
  offers: {
    model: Offer,
    select:
      "publicId name description type discount startsAt endsAt status redemptionCount",
    search: ["name"],
    permission: "campaign:write",
  },
  ads: {
    model: Advertisement,
    select:
      "publicId name description startsAt endsAt budgetMinor spentMinor metrics status",
    search: ["name"],
    permission: "campaign:write",
  },
  invoices: {
    model: Invoice,
    select:
      "publicId number lines subtotalMinor taxMinor totalMinor currency status issuedAt supplierSnapshot customerSnapshot",
    search: ["number"],
    sort: "issuedAt",
    permission: "finance:read",
  },
  settlements: {
    model: Settlement,
    select:
      "publicId periodStart periodEnd grossMinor commissionMinor refundMinor netMinor status settledAt",
    permission: "finance:read",
  },
  users: {
    model: User,
    select: "publicId name email phone roles activeRole status createdAt",
    search: ["name", "email", "phone"],
  },
  owners: {
    model: User,
    select: "publicId name email phone status createdAt",
    search: ["name", "email"],
  },
  gyms: {
    model: Gym,
    select:
      "publicId name slug ownerId address contact description facilities location timezone status verificationStatus platformSubscriptionStatus createdAt",
    search: ["name", "address.city"],
    populate: [{ path: "ownerId", select: person }],
  },
  registrations: {
    model: GymRegistration,
    select:
      "publicId ownerId gymId currentStep status selectedPlatformPlanId latestPaymentId activatedAt createdAt",
    populate: [
      { path: "ownerId", select: person },
      { path: "gymId", select: "name address status" },
    ],
  },
  "platform-plans": {
    model: PlatformPlan,
    select:
      "code version name billingPeriod priceMinor currency memberLimit staffLimit features active",
    search: ["name", "code"],
  },
  refunds: {
    model: Refund,
    select: "publicId paymentId amountMinor currency reason status createdAt",
    populate: [{ path: "paymentId", select: "publicId" }],
  },
  audit: {
    model: AuditLog,
    select:
      "actorId actorRole action entityType entityId outcome reason occurredAt",
    populate: [{ path: "actorId", select: "name" }],
    search: ["action", "entityType"],
    sort: "occurredAt",
  },
  reviews: {
    model: Review,
    select: "publicId gymId userId rating title body status createdAt",
    populate: [
      { path: "gymId", select: "name" },
      { path: "userId", select: "name" },
    ],
    search: ["title", "body"],
  },
  support: {
    model: SupportTicket,
    select:
      "publicId requesterId subject category priority status messages createdAt updatedAt",
    populate: [{ path: "requesterId", select: "name" }],
    search: ["subject"],
  },
  referrals: { model: Referral, select: "code status rewardMinor createdAt" },
  favorites: {
    model: Favorite,
    select: "gymId createdAt",
    populate: [
      {
        path: "gymId",
        select:
          "publicId name slug coverImageUrl address rating startingPriceMinor facilities",
      },
    ],
  },
  "workout-plans": {
    model: WorkoutPlan,
    select: "publicId name description goal version exercises status updatedAt",
    search: ["name"],
  },
  progress: {
    model: ProgressEntry,
    select: "publicId memberProfileId weightKg bodyFatPercent recordedAt notes",
    populate: [
      {
        path: "memberProfileId",
        select: "memberCode userId",
        populate: { path: "userId", select: "name" },
      },
    ],
    sort: "recordedAt",
  },
  workouts: {
    model: WorkoutAssignment,
    select: "publicId planSnapshot startsAt endsAt status notes",
  },
  bookings: {
    model: ClassBooking,
    select: "sessionId status bookedAt",
    populate: [
      { path: "sessionId", select: "publicId name startsAt endsAt gymId" },
    ],
    sort: "bookedAt",
  },
};
const ownerResources = new Set([
  "members",
  "plans",
  "subscriptions",
  "payments",
  "attendance",
  "classes",
  "trainers",
  "campaigns",
  "offers",
  "ads",
  "invoices",
  "settlements",
  "reviews",
]);
const memberResources = new Set([
  "subscriptions",
  "payments",
  "attendance",
  "invoices",
  "referrals",
  "favorites",
  "workouts",
  "bookings",
  "progress",
]);
export async function resourceScope(
  req: Request,
  key: string,
): Promise<Record<string, any>> {
  const auth = req.auth!;
  if (key === "support")
    return auth.role === "ADMIN" ? {} : { requesterId: auth.userId };
  if (auth.role === "ADMIN")
    return key === "owners" ? { roles: "GYM_OWNER" } : {};
  if (auth.role === "GYM_OWNER" || auth.role === "GYM_STAFF") {
    if (key === "registrations" && auth.role === "GYM_OWNER")
      return { ownerId: auth.userId };
    if (!ownerResources.has(key) || !auth.gymId)
      throw new AppError(
        403,
        "RESOURCE_FORBIDDEN",
        "This resource is unavailable in your workspace.",
      );
    const permission = resources[key].permission;
    if (permission && !auth.permissions.includes(permission))
      throw new AppError(
        403,
        "PERMISSION_DENIED",
        "You do not have permission for this resource.",
      );
    return { gymId: auth.gymId };
  }
  if (auth.role === "TRAINER") {
    const trainer = await Trainer.findOne({
      userId: auth.userId,
      gymId: auth.gymId,
      status: "ACTIVE",
    });
    if (!trainer)
      throw new AppError(
        403,
        "TRAINER_REQUIRED",
        "Select an active trainer workspace.",
      );
    if (key === "workout-plans" || key === "classes")
      return { gymId: auth.gymId, trainerId: trainer._id };
    const ids = await WorkoutAssignment.distinct("memberProfileId", {
      gymId: auth.gymId,
      trainerId: trainer._id,
      status: { $ne: "CANCELLED" },
    });
    if (key === "members")
      return {
        gymId: auth.gymId,
        $or: [{ _id: { $in: ids } }, { assignedTrainerId: trainer._id }],
      };
    if (key === "progress" || key === "attendance") {
      const assigned = await MemberProfile.distinct("_id", {
        gymId: auth.gymId,
        assignedTrainerId: trainer._id,
      });
      return {
        gymId: auth.gymId,
        memberProfileId: { $in: [...ids, ...assigned] },
      };
    }
    throw new AppError(
      403,
      "RESOURCE_FORBIDDEN",
      "This resource is unavailable in your workspace.",
    );
  }
  if (!memberResources.has(key))
    throw new AppError(
      403,
      "RESOURCE_FORBIDDEN",
      "This resource is unavailable in your workspace.",
    );
  if (key === "payments") return { payerId: auth.userId };
  if (key === "referrals") return { referrerId: auth.userId };
  if (["workouts", "bookings", "progress"].includes(key))
    return {
      memberProfileId: {
        $in: await MemberProfile.distinct("_id", { userId: auth.userId }),
      },
    };
  return {
    userId: auth.userId,
    ...(key === "subscriptions" ? { type: "GYM_MEMBERSHIP" } : {}),
  };
}
function literal(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
workspaceRoutes.get("/records/:resource", async (req, res) => {
  const key = String(req.params.resource),
    config = resources[key];
  if (!config)
    throw new AppError(404, "RESOURCE_NOT_FOUND", "Resource not found.");
  const scope = await resourceScope(req, key),
    clauses: any[] = [scope];
  const q =
    typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  if (q) {
    const regex = new RegExp(literal(q), "i");
    const fields =
      config.search ||
      ["publicId", "code", "name", "status"].filter(
        (field) => config.model.schema.path(field)?.instance === "String",
      );
    const alternatives: any[] = fields.map((field) => ({ [field]: regex }));
    if (config.model.schema.path("gymId")) {
      const gymIds = await Gym.distinct("_id", {
        $or: [{ name: regex }, { slug: regex }],
      });
      alternatives.push({ gymId: { $in: gymIds } });
    }
    const personFields = ["userId", "payerId", "requesterId", "ownerId"].filter(
      (field) => config.model.schema.path(field)?.options?.ref === "User",
    );
    if (personFields.length) {
      const userIds = await User.distinct("_id", {
        $or: [{ name: regex }, { email: regex }, { phone: regex }],
      });
      alternatives.push(
        ...personFields.map((field) => ({ [field]: { $in: userIds } })),
      );
    }
    if (config.model.schema.path("sessionId")) {
      const sessions = await ClassSession.distinct("_id", { name: regex });
      alternatives.push({ sessionId: { $in: sessions } });
    }
    clauses.push(
      alternatives.length ? { $or: alternatives } : { _id: { $in: [] } },
    );
  }
  if (typeof req.query.status === "string" && req.query.status)
    clauses.push({
      status:
        key === "registrations" && req.query.status === "DRAFT"
          ? { $in: ["DRAFT", ...legacyRegistrationStates] }
          : req.query.status.slice(0, 40),
    });
  if (req.query.from || req.query.to) {
    const range: any = {};
    if (req.query.from) range.$gte = z.coerce.date().parse(req.query.from);
    if (req.query.to)
      range.$lt = new Date(
        z.coerce.date().parse(req.query.to).getTime() + 86400000,
      );
    clauses.push({ [config.sort || "createdAt"]: range });
  }
  const filter = { $and: clauses },
    { page, limit, skip } = paginationFromQuery(req.query);
  const query = config.model
    .find(filter)
    .select(config.select)
    .sort({ [config.sort || "createdAt"]: -1, _id: -1 })
    .skip(skip)
    .limit(limit);
  for (const item of config.populate || []) {
    if (req.auth!.role === "TRAINER" && item.path === "currentSubscriptionId") {
      query.populate({ ...item, select: "publicId status startsAt endsAt" });
    } else if (
      key === "members" &&
      item.path === "currentSubscriptionId" &&
      (req.auth!.role === "ADMIN" ||
        req.auth!.permissions.includes("finance:read"))
    ) {
      query.populate({
        ...item,
        select: `${item.select} latestPaymentId`,
        populate: { path: "latestPaymentId", select: "publicId status" },
      });
    } else query.populate(item);
  }
  const [data, total] = await Promise.all([
    query.lean(),
    config.model.countDocuments(filter),
  ]);
  // One aggregate per page keeps attendance accurate without a request per member.
  let memberRows = data;
  if (key === "members" && data.length) {
    const visits = await AttendanceEvent.aggregate<{
      _id: mongoose.Types.ObjectId;
      count: number;
    }>([
      {
        $match: {
          gymId: {
            $in: data.map(
              (member: { gymId: any }) => member.gymId?._id || member.gymId,
            ),
          },
          memberProfileId: {
            $in: data.map(
              (member: { _id: mongoose.Types.ObjectId }) => member._id,
            ),
          },
          type: "CHECK_IN",
          occurredAt: {
            $gte: new Date(Date.now() - 30 * 86400000),
            $lte: new Date(),
          },
        },
      },
      { $group: { _id: "$memberProfileId", count: { $sum: 1 } } },
    ]);
    const visitCounts = new Map(
      visits.map((visit) => [String(visit._id), visit.count]),
    );
    memberRows = data.map((member: { _id: mongoose.Types.ObjectId }) => ({
      ...member,
      attendanceVisits30Days: visitCounts.get(String(member._id)) || 0,
    }));
  }
  if (key === "members") memberRows = await withMemberMedia(memberRows);
  if (key === "attendance") {
    const people = await withUserMedia(data.map((row: any) => row.userId).filter(Boolean));
    const members = await withMemberMedia(data.map((row: any) => row.memberProfileId).filter(Boolean));
    memberRows = data.map((row: any) => ({ ...row,
      userId: people.find(person => String(person._id) === String(row.userId?._id)) || row.userId,
      memberProfileId: members.find(member => String(member._id) === String(row.memberProfileId?._id)) || row.memberProfileId,
    }));
  }
  res.json({
    success: true,
    data:
      key === "registrations"
        ? data.map((r: any) => ({ ...r, status: registrationStatus(r) }))
        : key === "subscriptions"
          ? await Promise.all(
              data.map(async (row: any) => ({
                ...row,
                gymId: row.gymId
                  ? (await withGymMedia([row.gymId]))[0]
                  : row.gymId,
              })),
            )
          : memberRows,
    meta: pageMeta(page, limit, total),
  });
});
workspaceRoutes.get("/summary", async (req, res) => {
  const auth = req.auth!,
    admin = auth.role === "ADMIN",
    owner = ["GYM_OWNER", "GYM_STAFF"].includes(auth.role);
  if (owner && (!auth.gymId || !auth.permissions.includes("finance:read")))
    throw new AppError(403, "PERMISSION_DENIED", "Finance access is required.");
  const paymentFilter = admin
    ? {}
    : owner
      ? {
          gymId: new mongoose.Types.ObjectId(auth.gymId),
          purpose: "MEMBERSHIP",
        }
      : { payerId: new mongoose.Types.ObjectId(auth.userId) };
  const attendanceFilter = admin
    ? {}
    : owner
      ? { gymId: new mongoose.Types.ObjectId(auth.gymId) }
      : { userId: new mongoose.Types.ObjectId(auth.userId) };
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - 5, 1);
  since.setUTCHours(0, 0, 0, 0);
  const [revenue, visits, subscriptions, notifications] = await Promise.all([
    Payment.aggregate([
      {
        $match: {
          ...paymentFilter,
          status: {
            $in: [
              "CAPTURED",
              "PARTIALLY_REFUNDED",
              "REFUNDED",
              "REFUND_PENDING",
            ],
          },
          capturedAt: { $gte: since },
        },
      },
      {
        $group: {
          _id: {
            $dateToString: {
              date: "$capturedAt",
              format: "%Y-%m",
              timezone: "Asia/Kolkata",
            },
          },
          totalMinor: { $sum: "$amountMinor" },
        },
      },
      { $sort: { _id: 1 } },
    ]),
    AttendanceEvent.aggregate([
      {
        $match: {
          ...attendanceFilter,
          type: "CHECK_IN",
          occurredAt: { $gte: since },
        },
      },
      { $group: { _id: "$localDate", visits: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Subscription.countDocuments({
      ...(admin ? {} : owner ? { gymId: auth.gymId } : { userId: auth.userId }),
      status: "ACTIVE",
      endsAt: { $gte: new Date() },
    }),
    Notification.countDocuments({
      userId: auth.userId,
      readAt: null,
      archivedAt: null,
    }),
  ]);
  res.json({
    success: true,
    data: {
      revenue,
      visits,
      activeSubscriptions: subscriptions,
      unreadNotifications: notifications,
    },
  });
});
workspaceRoutes.patch(
  "/members/:id",
  requireRole("GYM_OWNER", "GYM_STAFF"),
  requireGymContext,
  requirePermission("member:write"),
  updateMember,
);
workspaceRoutes.patch(
  "/classes/:id",
  requireRole("GYM_OWNER", "GYM_STAFF"),
  requireGymContext,
  requirePermission("class:write"),
  async (req, res) => {
    const data = await saveGymClass({
      gymId: req.auth!.gymId!,
      publicId: String(req.params.id),
      body: req.body,
    });
    res.json({ success: true, data });
  },
);
workspaceRoutes.post("/support/:id/replies", async (req, res) => {
  const body = z
    .object({
      message: z.string().trim().min(1).max(5000),
      status: z
        .enum(["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"])
        .optional(),
    })
    .parse(req.body);
  const ticket = await SupportTicket.findOne({
    publicId: req.params.id,
    ...(req.auth!.role === "ADMIN" ? {} : { requesterId: req.auth!.userId }),
  });
  if (!ticket) throw new AppError(404, "TICKET_NOT_FOUND", "Ticket not found.");
  if (
    ["RESOLVED", "CLOSED"].includes(ticket.status) &&
    !(
      req.auth!.role === "ADMIN" &&
      body.status &&
      !["RESOLVED", "CLOSED"].includes(body.status)
    )
  )
    throw new AppError(
      409,
      "SUPPORT_CLOSED",
      "Reopen the support conversation before replying.",
    );
  ticket.messages.push({
    authorId: req.auth!.userId,
    body: body.message,
    createdAt: new Date(),
  });
  if (req.auth!.role === "ADMIN" && body.status) ticket.status = body.status;
  await ticket.save();
  const conversation = await ensureSupportConversation(ticket);
  await notifySupportReply(ticket, conversation.publicId, ticket.messages.at(-1));
  res.json({
    success: true,
    data: { ...ticket.toObject(), conversationId: conversation.publicId },
  });
});
workspaceRoutes.post(
  "/platform-plans",
  requireRole("ADMIN"),
  async (req, res) => {
    const data = await PlatformPlan.create(platformInput.parse(req.body));
    res.status(201).json({ success: true, data });
  },
);
workspaceRoutes.patch(
  "/platform-plans/:id",
  requireRole("ADMIN"),
  async (req, res) => {
    const data = await PlatformPlan.findByIdAndUpdate(
      req.params.id,
      { $set: platformInput.partial().parse(req.body) },
      { returnDocument: "after", runValidators: true },
    );
    if (!data) throw new AppError(404, "PLAN_NOT_FOUND", "Plan not found.");
    res.json({ success: true, data });
  },
);
workspaceRoutes.patch(
  "/reviews/:id",
  requireRole("ADMIN"),
  async (req, res) => {
    const body = z
      .object({ status: z.enum(["PUBLISHED", "HIDDEN", "REMOVED"]) })
      .parse(req.body);
    const data = await Review.findOneAndUpdate(
      { publicId: req.params.id },
      body,
      { returnDocument: "after" },
    );
    if (!data) throw new AppError(404, "REVIEW_NOT_FOUND", "Review not found.");
    await refreshGymRating(data.gymId);
    res.json({ success: true, data });
  },
);
workspaceRoutes.get("/registrations", async (req, res) => {
  const rows = await GymRegistration.find({ ownerId: req.auth!.userId })
    .populate("gymId")
    .populate("latestPaymentId", "publicId status metadata")
    .sort({ createdAt: -1 })
    .lean();
  res.json({
    success: true,
    data: rows.map((r) => ({ ...r, status: registrationStatus(r) })),
  });
});
workspaceRoutes.get("/platform-plans", async (_req, res) =>
  res.json({
    success: true,
    data: await PlatformPlan.find({ active: true, priceMinor: { $gte: 100 } })
      .sort({ priceMinor: 1 })
      .lean(),
  }),
);
workspaceRoutes.get("/documents", async (req, res) => {
  let registrationFilter = {};
  if (req.query.registrationId) {
    const registration = await GymRegistration.findOne({
      publicId: String(req.query.registrationId),
      ...(req.auth!.role === "ADMIN" ? {} : { ownerId: req.auth!.userId }),
    });
    if (!registration)
      throw new AppError(
        404,
        "REGISTRATION_NOT_FOUND",
        "Registration not found.",
      );
    registrationFilter = {
      registrationId: registration._id,
      gymId: registration.gymId,
      ownerId: registration.ownerId,
    };
  }
  const filter =
    req.auth!.role === "ADMIN" && req.query.ownerId
      ? {
          ownerId: z
            .string()
            .regex(/^[a-f\d]{24}$/i)
            .parse(req.query.ownerId),
        }
      : { ownerId: req.auth!.userId };
  res.json({
    success: true,
    data: await Attachment.find({
      ...filter,
      ...registrationFilter,
      purpose: "DOCUMENT",
      status: "READY",
    })
      .select("publicId originalName size createdAt")
      .lean(),
  });
});
