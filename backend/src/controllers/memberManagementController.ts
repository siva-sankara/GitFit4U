import type { Request, Response } from "express";
import { validatedImageAttachment } from "../services/userMediaService.js";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import {
  MembershipPlan,
  Payment,
  Subscription,
  SubscriptionEvent,
} from "../models/Commerce.js";
import { Trainer } from "../models/Engagement.js";
import { RoleAssignment, Session } from "../models/Auth.js";
import { TRAINER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { normalizePhone } from "../services/otpService.js";
import { emitDomainEvent } from "../services/domainEventService.js";
import { writeAudit } from "../services/auditService.js";
import { ensurePaymentInvoice } from "../services/invoiceService.js";
import { issueMemberInvitation } from "../services/accountInvitationService.js";
import { transitionMemberAccess } from "../services/membershipLifecycleService.js";
import { AppError } from "../utils/AppError.js";
import { normalizeEmail } from "../utils/accountIdentity.js";
import {
  calendarDate,
  shiftCalendarDate,
  zonedDayStart,
} from "../utils/gymCalendar.js";
import {
  ownerMemberCreateInput,
  ownerMemberUpdateInput,
  ownerTrainerInput,
} from "../routes/memberManagementSchemas.js";

export function offlinePlanQuote(
  plan: {
    priceMinor: number;
    discountMinor?: number;
    taxRateBasisPoints?: number;
    durationDays: number;
  },
  startsAt: Date,
  timezone?: string,
) {
  const discounted =
    plan.priceMinor - Math.min(plan.discountMinor || 0, plan.priceMinor);
  return {
    totalMinor:
      discounted +
      Math.round((discounted * (plan.taxRateBasisPoints || 0)) / 10000),
    endsAt: timezone
      ? zonedDayStart(
          shiftCalendarDate(
            calendarDate(startsAt, timezone),
            plan.durationDays,
          ),
          timezone,
        )
      : new Date(startsAt.getTime() + plan.durationDays * 86_400_000),
  };
}
export function memberInputDate(value: string | Date, timezone: string) {
  return typeof value === "string" ? zonedDayStart(value, timezone) : value;
}
export async function createMemberWithMembership(req: Request, res: Response) {
  const body = ownerMemberCreateInput.parse(req.body),
    gymId = req.auth!.gymId!;
  const now = new Date();
  const result = await mongoose.connection.transaction(async (session) => {
    const gym = await Gym.findOne({ _id: gymId, status: "ACTIVE" }).session(
      session,
    );
    if (!gym)
      throw new AppError(
        409,
        "GYM_NOT_ACTIVE",
        "Activate this gym before creating memberships.",
      );
    const timezone = gym.timezone || "Asia/Kolkata";
    const startsAt = memberInputDate(body.startsAt, timezone);
    const paidAt = memberInputDate(body.payment.paidAt, timezone);
    if (
      Math.abs(startsAt.getTime() - now.getTime()) > 365 * 86_400_000 ||
      paidAt > now
    )
      throw new AppError(
        422,
        "INVALID_MEMBERSHIP_DATE",
        "Choose a start date within one year and a payment date that is not in the future.",
      );
    if (body.avatarAttachmentId)
      await validatedImageAttachment(
        body.avatarAttachmentId,
        req.auth!.userId,
        "MEMBER_AVATAR",
        gymId,
        session,
      );
    const plan = await MembershipPlan.findOne({
      gymId,
      status: "ACTIVE",
      publicId: body.planId,
    }).session(session);
    if (!plan)
      throw new AppError(
        422,
        "PLAN_NOT_AVAILABLE",
        "Select an active membership plan belonging to this gym.",
      );
    const { totalMinor, endsAt } = offlinePlanQuote(
      plan,
      startsAt,
      typeof body.startsAt === "string" ? timezone : undefined,
    );
    if (body.payment.amountMinor !== totalMinor)
      throw new AppError(
        409,
        "PAYMENT_AMOUNT_MISMATCH",
        "The payment amount must match the current plan total. Refresh the plan and try again.",
      );
    if (endsAt <= now)
      throw new AppError(
        422,
        "MEMBERSHIP_ALREADY_EXPIRED",
        "The selected start date would create an expired membership.",
      );
    const email = body.email ? normalizeEmail(body.email) : undefined,
      phone = body.phone ? normalizePhone(body.phone) : undefined;
    const matchingUsers = await User.find({
      $or: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
    }).session(session);
    if (matchingUsers.length > 1)
      throw new AppError(
        409,
        "CONTACT_ACCOUNT_CONFLICT",
        "These contact details cannot be linked. Ask the member to sign in and verify their details.",
      );
    let user = matchingUsers[0];
    if (user && ["BLOCKED", "DISABLED"].includes(user.status))
      throw new AppError(
        409,
        "MEMBER_ACCOUNT_UNAVAILABLE",
        "This account is not available for membership creation.",
      );
    if (!user && !email)
      throw new AppError(
        422,
        "MEMBER_EMAIL_REQUIRED",
        "A new member needs an email address to activate their account securely.",
      );
    if (user && (!user.email || (email && user.email !== email) || (phone && user.phone && user.phone !== phone)))
      throw new AppError(409, "CONTACT_ACCOUNT_CONFLICT", "Verify the member's existing account email before inviting them.");
    if (!user)
      [user] = await User.create(
        [
          {
            publicId: nanoid(18),
            name: body.name,
            email,
            phone,
            roles: ["USER"],
            status: "PENDING_VERIFICATION",
          },
        ],
        { session },
      );
    let member = await MemberProfile.findOne({
      gymId,
      userId: user._id,
    }).session(session);
    if (member?.isDeleted)
      throw new AppError(
        409,
        "MEMBER_RECORD_REMOVED",
        "This member record was removed. Contact an administrator if it must be restored.",
      );
    const needsInvitation = !member || member.invitation?.status === "PENDING";
    if (needsInvitation && !email)
      throw new AppError(422, "MEMBER_EMAIL_REQUIRED", "Enter the member's existing account email to send their secure invitation.");
    if (
      member &&
      (await Subscription.exists({
        gymId,
        memberProfileId: member._id,
        status: { $in: ["ACTIVE", "FROZEN", "GRACE", "PENDING_PAYMENT"] },
      }).session(session))
    )
      throw new AppError(
        409,
        "MEMBERSHIP_EXISTS",
        "This member already has a current membership. Use their membership controls.",
      );
    const details = {
      status: needsInvitation ? "INACTIVE" : "ACTIVE",
      directAccess: false,
      contact: {
        name: body.name,
        email,
        phone,
        avatarAttachmentId:
          body.avatarAttachmentId === undefined
            ? member?.contact?.avatarAttachmentId
            : body.avatarAttachmentId,
        avatarUrl:
          body.avatarAttachmentId === undefined
            ? member?.contact?.avatarUrl
            : undefined,
      },
      fitnessGoal: body.fitnessGoal,
      emergencyContact: body.emergencyContact,
      medicalNotes: body.medicalNotes,
    };
    if (member) {
      Object.assign(member, details);
      await member.save({ session });
    } else
      [member] = await MemberProfile.create(
        [
          {
            publicId: nanoid(18),
            gymId,
            userId: user._id,
            memberCode: "GFU-" + nanoid(8).toUpperCase(),
            ...details,
          },
        ],
        { session },
      );
    const [subscription] = await Subscription.create(
      [
        {
          publicId: nanoid(24),
          type: "GYM_MEMBERSHIP",
          userId: user._id,
          gymId,
          memberProfileId: member._id,
          status: "ACTIVE",
          startsAt,
          endsAt,
          renewalAt: endsAt,
          planSnapshot: {
            planId: plan.publicId,
            name: plan.name,
            code: plan.code,
            version: plan.version,
            durationDays: plan.durationDays,
            priceMinor: plan.priceMinor,
            totalMinor,
            discountMinor: plan.discountMinor,
            taxRateBasisPoints: plan.taxRateBasisPoints,
            freezeDaysAllowed: plan.freezeDaysAllowed,
            benefits: plan.benefits,
          },
        },
      ],
      { session },
    );
    const [payment] = await Payment.create(
      [
        {
          publicId: nanoid(24),
          purpose: "MEMBERSHIP",
          payerId: user._id,
          gymId,
          subscriptionId: subscription._id,
          amountMinor: totalMinor,
          currency: plan.currency,
          provider: "OFFLINE",
          methodCategory: body.payment.method,
          status: "CAPTURED",
          capturedAt: paidAt,
          metadata: {
            collectorId: req.auth!.userId,
            reference: body.payment.reference,
            notes: body.payment.notes,
          },
        },
      ],
      { session },
    );
    subscription.latestPaymentId = payment._id;
    await subscription.save({ session });
    member.currentSubscriptionId = subscription._id;
    await member.save({ session });
    if (needsInvitation) await issueMemberInvitation(member, user, gym, session);
    await ensurePaymentInvoice(payment, { session, subscription });
    await SubscriptionEvent.create(
      [
        {
          subscriptionId: subscription._id,
          type: "OFFLINE_ACTIVATION",
          actorId: req.auth!.userId,
          payload: { paymentId: payment.publicId, amountMinor: totalMinor },
        },
      ],
      { session },
    );
    await emitDomainEvent({
      event: "membership.created",
      userId: user._id,
      gymId,
      entityId: subscription.publicId,
      actionUrl: "/app/subscriptions",
      session,
    });
    await emitDomainEvent({
      event: "membership.activated",
      userId: user._id,
      gymId,
      entityId: subscription.publicId,
      actionUrl: "/app/subscriptions",
      session,
    });
    await emitDomainEvent({
      event: "payment.offline",
      userId: user._id,
      gymId,
      entityId: payment.publicId,
      actionUrl: "/app/payments",
      session,
    });
    return { member, subscription, payment };
  });
  await writeAudit(req, {
    action: "member.offline.created",
    entityType: "MemberProfile",
    entityId: result.member.publicId,
  });
  res.status(201).json({ success: true, data: result });
}
export async function updateMember(req: Request, res: Response) {
  const body = ownerMemberUpdateInput.parse(req.body);
  const data = await mongoose.connection.transaction(async (session) => {
    const member = await MemberProfile.findOne({
      gymId: req.auth!.gymId,
      publicId: req.params.id,
      isDeleted: { $ne: true },
    }).session(session);
    if (!member)
      throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
    if (member.status === "JOIN_REQUESTED" && body.status === "ACTIVE")
      throw new AppError(
        409,
        "JOIN_APPROVAL_REQUIRED",
        "Use Approve join request to grant gym access.",
      );
    if (
      body.assignedTrainerId &&
      !(await Trainer.exists({
        _id: body.assignedTrainerId,
        gymId: req.auth!.gymId,
        status: "ACTIVE",
      }).session(session))
    )
      throw new AppError(
        422,
        "TRAINER_INVALID",
        "Select an active trainer from this gym.",
      );
    const previousTrainer = member.assignedTrainerId?.toString();
    if (
      body.assignedTrainerId !== undefined &&
      (body.assignedTrainerId || undefined) !== previousTrainer
    )
      member.trainerAssignedAt = body.assignedTrainerId
        ? new Date()
        : undefined;
    if (body.avatarAttachmentId !== undefined) {
      if (
        body.avatarAttachmentId &&
        String(member.contact?.avatarAttachmentId || "") !==
          body.avatarAttachmentId
      )
        await validatedImageAttachment(
          body.avatarAttachmentId,
          req.auth!.userId,
          "MEMBER_AVATAR",
          req.auth!.gymId,
          session,
        );
      member.set("contact.avatarAttachmentId", body.avatarAttachmentId);
      member.set("contact.avatarUrl", undefined);
    }
    for (const key of ["name", "email", "phone"] as const)
      if (body[key] !== undefined)
        member.set(
          "contact." + key,
          key === "phone" ? normalizePhone(body[key]!) : key === "email" ? normalizeEmail(body[key]!) : body[key],
        );
    for (const key of [
      "fitnessGoal",
      "emergencyContact",
      "medicalNotes",
      "assignedTrainerId",
    ] as const)
      if (body[key] !== undefined) member.set(key, body[key]);
    if (body.note?.trim())
      member.ownerNotes.push({
        text: body.note.trim(),
        authorId: req.auth!.userId,
        createdAt: new Date(),
      });
    if (body.status !== undefined)
      await transitionMemberAccess(member, body.status, {
        actorId: req.auth!.userId, actorRole: req.auth!.role,
        reason: body.note || (body.status === "ACTIVE" ? "Access restored by gym management" : "Access deactivated by gym management"),
      }, session);
    await member.save({ session });
    if (body.assignedTrainerId && body.assignedTrainerId !== previousTrainer)
      await emitDomainEvent({
        event: "trainer.assigned",
        userId: member.userId,
        gymId: member.gymId,
        entityId: member.publicId,
        occurrenceId: String(member.version),
        actionUrl: "/app/subscriptions",
        session,
      });
    return member;
  });
  await writeAudit(req, {
    action: "member.updated",
    entityType: "MemberProfile",
    entityId: data.publicId,
  });
  res.json({ success: true, data });
}

export async function deleteMember(req: Request, res: Response) {
  const now = new Date();
  const data = await mongoose.connection.transaction(async (session) => {
    const member = await MemberProfile.findOne({
      gymId: req.auth!.gymId,
      publicId: req.params.id,
      isDeleted: { $ne: true },
    }).session(session);
    if (!member)
      throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
    if (!["INACTIVE", "SUSPENDED", "ARCHIVED"].includes(member.status))
      throw new AppError(
        409,
        "MEMBER_DEACTIVATION_REQUIRED",
        "Deactivate this member before removing their gym record.",
      );
    if (
      member.currentSubscriptionId &&
      (await Subscription.exists({
        _id: member.currentSubscriptionId,
        gymId: req.auth!.gymId,
        memberProfileId: member._id,
        status: { $in: ["ACTIVE", "FROZEN", "GRACE", "PENDING_PAYMENT"] },
      }).session(session))
    )
      throw new AppError(
        409,
        "MEMBERSHIP_DEACTIVATION_REQUIRED",
        "Deactivate or cancel the current membership before removing this member.",
      );
    const before = {
      status: member.status,
      directAccess: member.directAccess,
      currentSubscriptionId: member.currentSubscriptionId,
    };
    member.status = "ARCHIVED";
    member.directAccess = false;
    member.isDeleted = true;
    member.deletedAt = now;
    member.deletedBy = new mongoose.Types.ObjectId(req.auth!.userId);
    await member.save({ session });
    return { member, before };
  });
  await writeAudit(req, {
    action: "member.soft_deleted",
    entityType: "MemberProfile",
    entityId: data.member.publicId,
    before: data.before,
    after: {
      status: data.member.status,
      isDeleted: data.member.isDeleted,
      deletedAt: data.member.deletedAt,
      deletedBy: data.member.deletedBy,
    },
  });
  res.json({
    success: true,
    data: { publicId: data.member.publicId, deletedAt: data.member.deletedAt },
  });
}
export async function requestGymJoin(req: Request, res: Response) {
  const gymId = typeof req.body.gymId === "string" ? req.body.gymId : "";
  const gym = await Gym.findOne({
    publicId: gymId,
    status: "ACTIVE",
    platformSubscriptionStatus: "ACTIVE",
  });
  if (!gym)
    throw new AppError(404, "GYM_NOT_FOUND", "This gym is unavailable.");
  const data = await mongoose.connection.transaction(async (session) => {
    if (
      await MembershipPlan.exists({ gymId: gym._id, status: "ACTIVE" }).session(
        session,
      )
    )
      throw new AppError(
        409,
        "PLAN_SELECTION_REQUIRED",
        "This gym now offers plans. Select a plan to join.",
      );
    const member = await MemberProfile.findOneAndUpdate(
      { gymId: gym._id, userId: req.auth!.userId },
      {
        $setOnInsert: {
          publicId: nanoid(18),
          memberCode: "GFU-" + nanoid(8).toUpperCase(),
          status: "JOIN_REQUESTED",
          directAccess: false,
        },
      },
      { returnDocument: "after", upsert: true, session },
    );
    if (member.status !== "JOIN_REQUESTED")
      throw new AppError(
        409,
        "GYM_RELATIONSHIP_EXISTS",
        "You already have a member record at this gym. Contact the gym to restore access.",
      );
    await emitDomainEvent({
      event: "membership.requested",
      userId: gym.ownerId,
      gymId: gym._id,
      entityId: member.publicId,
      actionUrl: "/owner/members",
      session,
    });
    return member;
  });
  res.status(201).json({ success: true, data });
}
export async function decideGymJoin(req: Request, res: Response) {
  if (!["approve", "reject"].includes(String(req.params.decision)))
    throw new AppError(422, "INVALID_DECISION", "Choose approve or reject.");
  const data = await mongoose.connection.transaction(async (session) => {
    const member = await MemberProfile.findOne({
      gymId: req.auth!.gymId,
      publicId: req.params.id,
      status: "JOIN_REQUESTED",
    }).session(session);
    if (!member)
      throw new AppError(
        404,
        "REQUEST_NOT_FOUND",
        "Pending join request not found.",
      );
    const approve = req.params.decision === "approve";
    if (
      approve &&
      (await MembershipPlan.exists({
        gymId: member.gymId,
        status: "ACTIVE",
      }).session(session))
    )
      throw new AppError(
        409,
        "PLAN_SELECTION_REQUIRED",
        "This gym has active plans. Create a paid membership for this member instead.",
      );
    member.status = approve ? "ACTIVE" : "INACTIVE";
    member.directAccess = approve;
    member.approvedAt = new Date();
    member.approvedBy = req.auth!.userId;
    await member.save({ session });
    await emitDomainEvent({
      event: approve ? "membership.activated" : "membership.cancelled",
      userId: member.userId,
      gymId: member.gymId,
      entityId: member.publicId,
      actionUrl: "/app/attendance",
      session,
    });
    return member;
  });
  await writeAudit(req, {
    action: "member.join." + req.params.decision,
    entityType: "MemberProfile",
    entityId: data.publicId,
  });
  res.json({ success: true, data });
}
export async function saveTrainer(req: Request, res: Response) {
  const update = req.method === "PATCH";
  const body = (update ? ownerTrainerInput.partial() : ownerTrainerInput).parse(
    req.body,
  );
  const data = await mongoose.connection.transaction(async (session) => {
    if (body.photoAttachmentId)
      await validatedImageAttachment(
        body.photoAttachmentId,
        req.auth!.userId,
        "TRAINER_IMAGE",
        req.auth!.gymId,
        session,
      );
    let trainer = update
      ? await Trainer.findOne({
          gymId: req.auth!.gymId,
          publicId: req.params.id,
        }).session(session)
      : null;
    if (update && !trainer)
      throw new AppError(404, "TRAINER_NOT_FOUND", "Trainer not found.");
    const user = trainer
      ? await User.findById(trainer.userId).session(session)
      : await User.findOne({
          email: normalizeEmail(body.email!),
          status: "ACTIVE",
        }).session(session);
    if (!user)
      throw new AppError(
        422,
        "TRAINER_ACCOUNT_REQUIRED",
        "The trainer must verify an account with this email first.",
      );
    if (
      !trainer &&
      (await Trainer.exists({
        gymId: req.auth!.gymId,
        userId: user._id,
      }).session(session))
    )
      throw new AppError(
        409,
        "TRAINER_EXISTS",
        "This trainer is already registered at this gym.",
      );
    if (body.email && normalizeEmail(body.email) !== user.email)
      throw new AppError(
        422,
        "TRAINER_IDENTITY_IMMUTABLE",
        "Account email cannot be changed from a gym profile.",
      );
    const activating =
      (body.status || trainer?.status || "ACTIVE") === "ACTIVE";
    if (activating && user.status !== "ACTIVE")
      throw new AppError(
        409,
        "ACCOUNT_DISABLED",
        "The linked account must be active before enabling trainer access.",
      );
    const fields = {
      ...body,
      ...(body.photoAttachmentId !== undefined ? { photoUrl: undefined } : {}),
      ...(body.phone ? { phone: normalizePhone(body.phone) } : {}),
    };
    if (trainer) {
      Object.assign(trainer, fields);
      await trainer.save({ session });
    } else
      [trainer] = await Trainer.create(
        [
          {
            ...fields,
            publicId: nanoid(18),
            gymId: req.auth!.gymId,
            userId: user._id,
          },
        ],
        { session },
      );
    await RoleAssignment.findOneAndUpdate(
      { userId: user._id, gymId: req.auth!.gymId, role: "TRAINER" },
      {
        $set: {
          permissions: TRAINER_DEFAULT_PERMISSIONS,
          status: activating ? "ACTIVE" : "REVOKED",
        },
      },
      { upsert: activating, session, runValidators: true },
    );
    const roles = new Set<string>(user.roles || []);
    roles.add("USER");
    if (activating) roles.add("TRAINER");
    else if (
      !(await RoleAssignment.exists({
        userId: user._id,
        role: "TRAINER",
        status: "ACTIVE",
      }).session(session))
    )
      roles.delete("TRAINER");
    // Always write the shared user within this transaction. Concurrent updates
    // at different gyms must conflict/retry before deciding the final role set.
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          roles: [...roles],
          activeRole: roles.has(user.activeRole) ? user.activeRole : "USER",
        },
        $inc: { version: 1 },
      },
      { session, runValidators: true },
    );
    if (!activating)
      await Session.updateMany(
        {
          userId: user._id,
          activeGymId: req.auth!.gymId,
          activeRole: "TRAINER",
          revokedAt: null,
        },
        {
          $set: {
            revokedAt: new Date(),
            revokeReason: "TRAINER_STATUS_CHANGED",
          },
        },
        { session },
      );
    return trainer;
  });
  await writeAudit(req, {
    action: update ? "trainer.updated" : "trainer.created",
    entityType: "Trainer",
    entityId: data.publicId,
  });
  res.status(update ? 200 : 201).json({ success: true, data });
}

// These adapters require an authenticated admin even when called outside the
// admin router. The management implementation remains shared and transactional.
export async function adminCreateMember(req: Request, res: Response) {
  if (req.auth?.role !== "ADMIN")
    throw new AppError(
      403,
      "ROLE_FORBIDDEN",
      "Administrator access is required.",
    );
  const gym = await Gym.findOne({
    publicId: req.params.gymId,
    status: "ACTIVE",
  }).select("_id");
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Active gym not found.");
  req.auth.gymId = String(gym._id);
  return createMemberWithMembership(req, res);
}
export async function adminMemberDetails(req: Request, res: Response) {
  if (req.auth?.role !== "ADMIN")
    throw new AppError(
      403,
      "ROLE_FORBIDDEN",
      "Administrator access is required.",
    );
  const member = await MemberProfile.findOne({
    publicId: req.params.id,
  }).select("gymId");
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  req.auth.gymId = String(member.gymId);
  const { getMember } = await import("./ownerController.js");
  return getMember(req, res);
}

async function resolveAdminMemberGym(req: Request) {
  if (req.auth?.role !== "ADMIN")
    throw new AppError(
      403,
      "ROLE_FORBIDDEN",
      "Administrator access is required.",
    );
  const member = await MemberProfile.findOne({
    publicId: req.params.id,
  }).select("gymId");
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  req.auth.gymId = String(member.gymId);
}
export async function adminUpdateMember(req: Request, res: Response) {
  await resolveAdminMemberGym(req);
  return updateMember(req, res);
}
export async function adminDecideJoin(req: Request, res: Response) {
  await resolveAdminMemberGym(req);
  return decideGymJoin(req, res);
}
