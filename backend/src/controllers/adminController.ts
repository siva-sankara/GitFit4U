import type { Request, Response } from "express";
import mongoose from "mongoose";
import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { User } from "../models/User.js";
import {
  MembershipPlan,
  Payment,
  PlatformPlan,
  Subscription,
} from "../models/Commerce.js";
import { AuditLog } from "../models/Operations.js";
import { writeAudit } from "../services/auditService.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import { AppError } from "../utils/AppError.js";
import {
  registrationStatus,
  editableRegistrationStates,
  registrationPayment,
} from "../services/registrationService.js";
import { env } from "../config/env.js";

export async function dashboard(req: Request, res: Response) {
  const monthStart = new Date(
    new Date().getFullYear(),
    new Date().getMonth(),
    1,
  );
  const [
    totalGyms,
    activeGyms,
    pendingGyms,
    totalOwners,
    totalUsers,
    activeSubscriptions,
    revenue,
    failedPayments,
  ] = await Promise.all([
    Gym.countDocuments({ status: { $ne: "ARCHIVED" } }),
    Gym.countDocuments({ status: "ACTIVE" }),
    GymRegistration.countDocuments({
      status: { $in: editableRegistrationStates },
    }),
    User.countDocuments({ roles: "GYM_OWNER" }),
    User.countDocuments({ roles: "USER" }),
    Subscription.countDocuments({ status: "ACTIVE" }),
    Payment.aggregate([
      { $match: { status: "CAPTURED", capturedAt: { $gte: monthStart } } },
      { $group: { _id: null, total: { $sum: "$amountMinor" } } },
    ]),
    Payment.countDocuments({
      status: "FAILED",
      createdAt: { $gte: monthStart },
    }),
  ]);
  res.json({
    success: true,
    data: {
      totalGyms,
      activeGyms,
      awaitingPaymentGyms: pendingGyms,
      totalOwners,
      totalUsers,
      activeSubscriptions,
      monthlyRevenueMinor: revenue[0]?.total || 0,
      failedPayments,
    },
  });
}

export async function listRegistrations(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  const [data, total] = await Promise.all([
    GymRegistration.find(filter)
      .populate("ownerId", "publicId name phone email")
      .populate(
        "gymId",
        "publicId name address platformSubscriptionStatus status",
      )
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    GymRegistration.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: data.map((r) => ({ ...r, status: registrationStatus(r) })),
    meta: pageMeta(page, limit, total),
  });
}

export async function registrationDetails(req: Request, res: Response) {
  const data = await GymRegistration.findOne({ publicId: req.params.id })
    .populate("ownerId")
    .populate("gymId")
    .lean();
  if (!data)
    throw new AppError(
      404,
      "REGISTRATION_NOT_FOUND",
      "Registration not found.",
    );
  const payments = await Payment.find({
    gymId: data.gymId,
    payerId: data.ownerId,
    purpose: "PLATFORM_PLAN",
  })
    .select(
      "publicId amountMinor currency status createdAt capturedAt providerOrderId failureDescription",
    )
    .sort({ createdAt: -1 })
    .lean();
  res.json({
    success: true,
    data: {
      registration: { ...data, status: registrationStatus(data) },
      payments,
    },
  });
}

export async function listGyms(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = req.query.status;
  const [data, total] = await Promise.all([
    Gym.find(filter)
      .populate("ownerId", "publicId name phone email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Gym.countDocuments(filter),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}

export async function setGymStatus(req: Request, res: Response) {
  const action = String(req.params.action);
  const statusMap: Record<string, string> = {
    activate: "ACTIVE",
    suspend: "SUSPENDED",
    archive: "ARCHIVED",
  };
  const status = statusMap[action];
  if (!status)
    throw new AppError(404, "ACTION_NOT_FOUND", "Unsupported gym action.");
  const gym = await mongoose.connection.transaction(async (session) => {
    const target = await Gym.findOne({ publicId: req.params.id }).session(
      session,
    );
    if (!target) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
    const registration = await GymRegistration.findOne({
      gymId: target._id,
      ownerId: target.ownerId,
    }).session(session);
    if (
      status === "ACTIVE" &&
      (!registration || !(await registrationPayment(registration, session)))
    )
      throw new AppError(
        409,
        "GYM_NOT_ELIGIBLE",
        "A verified captured registration payment and active platform subscription are required.",
      );
    target.status = status;
    target.suspendedAt = status === "SUSPENDED" ? new Date() : undefined;
    target.suspensionReason =
      status === "SUSPENDED" ? req.body.reason : undefined;
    await target.save({ session });
    if (registration) {
      registration.status = status === "ACTIVE" ? "ACTIVE" : "SUSPENDED";
      if (status === "ACTIVE") registration.currentStep = "COMPLETE";
      await registration.save({ session });
    }
    return target.toObject();
  });
  await writeAudit(req, {
    action: `gym.${action}`,
    entityType: "Gym",
    entityId: gym.publicId,
    reason: req.body.reason,
  });
  res.json({ success: true, data: gym });
}

export async function platformPlans(_req: Request, res: Response) {
  const data = await PlatformPlan.find().sort({ priceMinor: 1 }).lean();
  res.json({ success: true, data });
}

export async function createPlatformPlan(req: Request, res: Response) {
  const plan = await PlatformPlan.create(req.body);
  res.status(201).json({ success: true, data: plan });
}

export async function auditLogs(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const [data, total] = await Promise.all([
    AuditLog.find().sort({ occurredAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}

export async function healthOverview(_req: Request, res: Response) {
  const dbHealthy = mongoose.connection.readyState === 1;
  const pendingPayments = await Payment.countDocuments({
    status: "PENDING",
    createdAt: { $lte: new Date(Date.now() - 15 * 60_000) },
  });
  res.json({
    success: true,
    data: {
      api: { status: "HEALTHY" },
      database: { status: dbHealthy ? "HEALTHY" : "CRITICAL" },
      payments: {
        status: pendingPayments > 20 ? "WARNING" : "HEALTHY",
        pendingReconciliation: pendingPayments,
      },
      notifications: {
        status: "AVAILABLE",
        detail: "In-app notifications are stored in the database.",
      },
      queues: {
        status: "AVAILABLE",
        detail:
          "Database campaign worker processes in-app delivery every 30 seconds.",
      },
      paymentProvider: {
        status:
          env.RAZORPAY_KEY_ID &&
          env.RAZORPAY_KEY_SECRET &&
          env.RAZORPAY_WEBHOOK_SECRET
            ? "CONFIGURED"
            : "NOT_CONFIGURED",
        detail:
          "Configuration presence only; provider availability is not measured.",
      },
      storage: {
        status:
          env.OBJECT_STORAGE_ENDPOINT &&
          env.OBJECT_STORAGE_ACCESS_KEY &&
          env.OBJECT_STORAGE_SECRET_KEY
            ? "CONFIGURED"
            : "NOT_CONFIGURED",
      },
      maps: {
        provider: "LOCATIONIQ",
        status: env.LOCATIONIQ_API_KEY?.trim()
          ? "CONFIGURED"
          : "NOT_CONFIGURED",
        detail:
          "Configuration presence only; provider availability is not measured.",
      },
      sms: {
        status:
          env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID
            ? "CONFIGURED"
            : "NOT_CONFIGURED",
        detail: "MSG91 credentials and an approved OTP template are required.",
      },
    },
  });
}
