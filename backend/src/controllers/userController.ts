import type { Request, Response } from "express";
import { User } from "../models/User.js";
import { Subscription, Payment } from "../models/Commerce.js";
import { AttendanceEvent, StreakProjection } from "../models/Attendance.js";
import { MemberProfile } from "../models/Member.js";
import { Notification, SupportTicket } from "../models/Engagement.js";
import { AppError } from "../utils/AppError.js";
import { nanoid } from "nanoid";
import { issueAttendanceQr } from "../services/attendanceQrService.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import {
  ensureSupportConversation,
  notifySupportCreated,
} from "../services/supportConversationService.js";
import { sha256 } from "../utils/crypto.js";
import { withGymMedia } from "../services/gymMediaService.js";

export async function getProfile(req: Request, res: Response) {
  const user = await User.findById(req.auth!.userId).lean();
  res.json({ success: true, data: user });
}

export async function updateProfile(req: Request, res: Response) {
  const update: Record<string, unknown> = { ...req.body };
  for (const group of ["profile", "preferences", "notificationPreferences"]) {
    delete update[group];
    for (const [key, value] of Object.entries(req.body[group] || {}))
      update[`${group}.${key}`] = value;
  }
  const user = await User.findByIdAndUpdate(
    req.auth!.userId,
    { $set: update },
    { new: true, runValidators: true },
  ).lean();
  res.json({ success: true, data: user });
}

export async function subscriptions(req: Request, res: Response) {
  const data = await Subscription.find({
    userId: req.auth!.userId,
    type: "GYM_MEMBERSHIP",
  })
    .populate("gymId", "publicId name slug logoUrl logoAttachmentId address")
    .sort({ createdAt: -1 })
    .lean();
  const gyms = await withGymMedia(
    data.map((subscription) => subscription.gymId).filter(Boolean),
  );
  res.json({
    success: true,
    data: data.map((subscription) => ({
      ...subscription,
      gymId:
        gyms.find(
          (gym) => String(gym._id) === String(subscription.gymId?._id),
        ) || subscription.gymId,
    })),
  });
}

export async function subscriptionDetails(req: Request, res: Response) {
  const data = await Subscription.findOne({
    publicId: req.params.id,
    userId: req.auth!.userId,
  })
    .populate(
      "gymId",
      "publicId name slug logoUrl logoAttachmentId address contact",
    )
    .lean();
  if (!data)
    throw new AppError(
      404,
      "SUBSCRIPTION_NOT_FOUND",
      "Subscription not found.",
    );
  res.json({
    success: true,
    data: {
      ...data,
      gymId: data.gymId ? (await withGymMedia([data.gymId]))[0] : null,
    },
  });
}

export async function payments(req: Request, res: Response) {
  const data = await Payment.find({ payerId: req.auth!.userId })
    .sort({ createdAt: -1 })
    .lean();
  res.json({ success: true, data });
}

export async function attendance(req: Request, res: Response) {
  const memberships = await MemberProfile.find({ userId: req.auth!.userId })
    .select("_id gymId")
    .lean();
  const memberIds = memberships.map((member) => member._id);
  const [events, streaks] = await Promise.all([
    AttendanceEvent.find({
      memberProfileId: { $in: memberIds },
      type: "CHECK_IN",
    })
      .sort({ occurredAt: -1 })
      .limit(365)
      .lean(),
    StreakProjection.find({ memberProfileId: { $in: memberIds } }).lean(),
  ]);
  res.json({ success: true, data: { events, streaks } });
}

export async function attendanceQr(req: Request, res: Response) {
  const membership = await MemberProfile.findOne({
    userId: req.auth!.userId,
    gymId: req.body.gymId,
    status: "ACTIVE",
  }).populate("currentSubscriptionId");
  const subscription = membership
    ? await Subscription.findOne({
        memberProfileId: membership._id,
        gymId: req.body.gymId,
        status: "ACTIVE",
        startsAt: { $lte: new Date() },
        endsAt: { $gte: new Date() },
      })
    : null;
  const now = new Date();
  if (
    !membership ||
    !subscription ||
    subscription.status !== "ACTIVE" ||
    subscription.startsAt > now ||
    subscription.endsAt < now
  ) {
    throw new AppError(
      409,
      "MEMBERSHIP_NOT_ACTIVE",
      "An active membership is required to create an attendance QR.",
    );
  }
  const qr = issueAttendanceQr(membership.publicId, String(membership.gymId));
  res.status(201).json({
    success: true,
    data: {
      ...qr,
      memberId: membership.publicId,
      gymId: String(membership.gymId),
    },
  });
}

export async function markAllNotificationsRead(req: Request, res: Response) {
  const result = await Notification.updateMany(
    { userId: req.auth!.userId, readAt: null },
    { $set: { readAt: new Date() } },
  );
  res.json({ success: true, data: { updated: result.modifiedCount } });
}

export async function notifications(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const category =
    typeof req.query.category === "string" ? req.query.category : "";
  const filter = {
    userId: req.auth!.userId,
    archivedAt: null,
    ...(category === "UNREAD"
      ? { readAt: null }
      : category && category !== "ALL"
        ? { category }
        : {}),
  };
  const [data, total] = await Promise.all([
    Notification.find(filter)
      .select("-pushLeaseId -pushLeaseUntil -pushNextAttemptAt")
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}

export async function markNotificationRead(req: Request, res: Response) {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.auth!.userId },
    { readAt: new Date() },
    { new: true },
  ).lean();
  if (!notification)
    throw new AppError(
      404,
      "NOTIFICATION_NOT_FOUND",
      "Notification not found.",
    );
  res.json({ success: true, data: notification });
}

export async function createSupportTicket(req: Request, res: Response) {
  const requestKey = req.header("idempotency-key");
  if (requestKey && !/^[a-zA-Z0-9-]{8,120}$/.test(requestKey))
    throw new AppError(
      422,
      "INVALID_SUBMISSION_KEY",
      "Use a valid support submission identifier.",
    );
  const publicId = requestKey
    ? `support_${sha256(`${req.auth!.userId}:${requestKey}`).slice(0, 32)}`
    : nanoid(18);
  const input = {
    publicId,
    requesterId: req.auth!.userId,
    gymId: req.body.gymId,
    subject: req.body.subject,
    category: req.body.category,
    priority: req.body.priority,
    messages: [
      {
        authorId: req.auth!.userId,
        body: req.body.message,
        createdAt: new Date(),
      },
    ],
  };
  let ticket;
  try {
    ticket = await SupportTicket.findOneAndUpdate(
      { publicId, requesterId: req.auth!.userId },
      { $setOnInsert: input },
      { upsert: true, new: true, runValidators: true },
    );
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    ticket = await SupportTicket.findOne({
      publicId,
      requesterId: req.auth!.userId,
    });
    if (!ticket) throw error;
  }
  if (
    ticket.subject !== input.subject ||
    ticket.messages[0]?.body !== req.body.message ||
    String(ticket.gymId || "") !== String(req.body.gymId || "")
  )
    throw new AppError(
      409,
      "SUBMISSION_KEY_REUSED",
      "This submission identifier belongs to a different support request.",
    );
  const conversation = await ensureSupportConversation(ticket);
  await notifySupportCreated(ticket, conversation.publicId);
  res.status(201).json({
    success: true,
    data: { ...ticket.toObject(), conversationId: conversation.publicId },
  });
}
