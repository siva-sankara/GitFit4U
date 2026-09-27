import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { z } from "zod";
import { User } from "../models/User.js";
import {
  AuthIdentity,
  PasswordResetGrant,
  RoleAssignment,
  Session,
} from "../models/Auth.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { Trainer, Notification } from "../models/Engagement.js";
import { MembershipPlan } from "../models/Commerce.js";
import { PlatformSettings } from "../models/Operations.js";
import {
  OWNER_DEFAULT_PERMISSIONS,
  TRAINER_DEFAULT_PERMISSIONS,
} from "../constants/domain.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";
import { transitionMembership } from "../services/membershipLifecycleService.js";
import { emitDomainEvent } from "../services/domainEventService.js";
import { gymInput, planInput } from "../routes/inputSchemas.js";
import { refreshGymPrice } from "../services/gymProjectionService.js";

const accountInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.string().trim().email().toLowerCase().optional(),
    phone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
  })
  .strict();
export const accountUpdate = accountInput
  .partial()
  .extend({ status: z.enum(["ACTIVE", "DISABLED", "BLOCKED"]).optional() })
  .strict();
const safeUser = (user: any) => ({
  publicId: user.publicId,
  name: user.name,
  email: user.email,
  phone: user.phone,
  roles: user.roles,
  status: user.status,
});
export async function createAccount(req: Request, res: Response) {
  const body = accountInput
    .refine((v) => !!v.phone, "A phone number is required for OTP sign-in")
    .parse(req.body);
  const user = await User.create({
    ...body,
    publicId: nanoid(20),
    roles: ["USER"],
    activeRole: "USER",
    status: "PENDING_VERIFICATION",
  });
  await writeAudit(req, {
    action: "account.created",
    entityType: "User",
    entityId: user.publicId,
  });
  res.status(201).json({ success: true, data: safeUser(user) });
}
export async function updateAccount(req: Request, res: Response) {
  const body = accountUpdate.parse(req.body);
  const user = await mongoose.connection.transaction(async (session) => {
    const target = await User.findOne({ publicId: req.params.id }).session(
      session,
    );
    if (!target)
      throw new AppError(404, "ACCOUNT_NOT_FOUND", "Account not found.");
    const changedContacts = (["email", "phone"] as const).filter(
      (key) => body[key] !== undefined && body[key] !== target[key],
    );
    const statusChanged =
      body.status !== undefined && body.status !== target.status;
    const disabling = statusChanged && body.status !== "ACTIVE";
    // Administrator identities are managed through their own security flow.
    if (target.roles.includes("ADMIN") && (disabling || changedContacts.length))
      throw new AppError(
        409,
        "ADMIN_ACCOUNT_PROTECTED",
        "An administrator's access and sign-in identities cannot be changed here.",
      );
    for (const key of changedContacts) {
      const provider = key === "email" ? "PASSWORD" : "PHONE";
      if (
        await User.exists({
          _id: { $ne: target._id },
          [key]: body[key],
        }).session(session)
      )
        throw new AppError(
          409,
          "IDENTITY_IN_USE",
          "This contact is already registered.",
        );
      if (
        key === "email" &&
        (await AuthIdentity.exists({
          userId: target._id,
          provider: "GOOGLE",
        }).session(session))
      )
        throw new AppError(
          409,
          "GOOGLE_IDENTITY_MANAGED",
          "Google-linked email must be changed through account verification.",
        );
      await AuthIdentity.updateMany(
        { userId: target._id, provider },
        { $set: { providerSubject: body[key] } },
        { session },
      );
    }
    Object.assign(target, body);
    await target.save({ session });
    if (disabling || changedContacts.length)
      await Session.updateMany(
        { userId: target._id, revokedAt: null },
        {
          $set: { revokedAt: new Date(), revokeReason: "ADMIN_ACCOUNT_UPDATE" },
        },
        { session },
      );
    if (statusChanged || changedContacts.length)
      await PasswordResetGrant.updateMany(
        { userId: target._id, consumedAt: null },
        { $set: { consumedAt: new Date() } },
        { session },
      );
    return target;
  });
  await writeAudit(req, {
    action: "account.updated",
    entityType: "User",
    entityId: user.publicId,
    after: body,
  });
  res.json({ success: true, data: safeUser(user) });
}
export async function assignRole(req: Request, res: Response) {
  const body = z
    .object({
      role: z.enum(["GYM_OWNER", "GYM_STAFF", "TRAINER"]),
      gymId: z.string(),
      active: z.boolean(),
    })
    .strict()
    .parse(req.body);
  await mongoose.connection.transaction(async (session) => {
    const user = await User.findOne({ publicId: req.params.id }).session(
      session,
    );
    const gym = await Gym.findOne({
      publicId: body.gymId,
      deletedAt: null,
    }).session(session);
    if (!user || !gym)
      throw new AppError(404, "RECORD_NOT_FOUND", "Account or gym not found.");
    if (body.active && user.status !== "ACTIVE")
      throw new AppError(
        409,
        "ACCOUNT_NOT_ACTIVE",
        "The account holder must complete verification and have an active account before gym access can be enabled.",
      );
    if (body.role === "GYM_OWNER" && String(gym.ownerId) !== String(user._id))
      throw new AppError(
        409,
        "OWNER_MISMATCH",
        "Gym ownership must match the existing registered owner.",
      );
    if (
      body.active &&
      (gym.status !== "ACTIVE" || gym.platformSubscriptionStatus !== "ACTIVE")
    )
      throw new AppError(
        409,
        "GYM_INACTIVE",
        "An active gym subscription is required.",
      );
    const permissions =
      body.role === "GYM_OWNER"
        ? OWNER_DEFAULT_PERMISSIONS
        : body.role === "TRAINER"
          ? TRAINER_DEFAULT_PERMISSIONS
          : ["gym:read", "member:read"];
    await RoleAssignment.findOneAndUpdate(
      { userId: user._id, gymId: gym._id, role: body.role },
      { $set: { permissions, status: body.active ? "ACTIVE" : "REVOKED" } },
      { session, upsert: true, runValidators: true },
    );
    if (body.active)
      user.roles = [...new Set([...(user.roles || []), "USER", body.role])];
    if (body.role === "TRAINER")
      await Trainer.findOneAndUpdate(
        { userId: user._id, gymId: gym._id },
        {
          $set: {
            name: user.name,
            status: body.active ? "ACTIVE" : "INACTIVE",
          },
          $setOnInsert: { publicId: nanoid(20) },
        },
        { upsert: body.active, session },
      );
    if (
      !body.active &&
      !(await RoleAssignment.exists({
        userId: user._id,
        role: body.role,
        status: "ACTIVE",
      }).session(session))
    )
      user.roles = user.roles.filter((r: string) => r !== body.role);
    if (!user.roles.includes(user.activeRole)) user.activeRole = "USER";
    // A shared account write serializes role changes made at different gyms.
    await User.updateOne(
      { _id: user._id },
      {
        $set: { roles: user.roles, activeRole: user.activeRole },
        $inc: { version: 1 },
      },
      { session, runValidators: true },
    );
    await Session.updateMany(
      {
        userId: user._id,
        activeRole: body.role,
        activeGymId: gym._id,
        revokedAt: null,
      },
      { $set: { revokedAt: new Date(), revokeReason: "ROLE_UPDATED" } },
      { session },
    );
  });
  await writeAudit(req, {
    action: "role.updated",
    entityType: "User",
    entityId: String(req.params.id),
    after: body,
  });
  res.json({ success: true });
}
export async function editGym(req: Request, res: Response) {
  const body = gymInput.partial().parse(req.body);
  // Media can only be published after tenant-scoped upload validation.
  for (const key of [
    "logoUrl",
    "coverImageUrl",
    "gallery",
    "mediaAttachmentIds",
    "coverAttachmentId",
    "logoAttachmentId",
  ])
    delete (body as any)[key];
  const update: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (
      ["address", "contact", "location"].includes(key) &&
      value &&
      typeof value === "object"
    )
      for (const [child, entry] of Object.entries(value))
        update[`${key}.${child}`] = entry;
    else update[key] = value;
  }
  const gym = await Gym.findOneAndUpdate(
    { publicId: req.params.id, deletedAt: null },
    { $set: update },
    { returnDocument: "after", runValidators: true },
  );
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  await writeAudit(req, {
    action: "gym.updated",
    entityType: "Gym",
    entityId: gym.publicId,
    after: body,
  });
  res.json({ success: true, data: gym });
}
export async function savePlan(req: Request, res: Response) {
  if (req.params.id && req.body.gymId !== undefined)
    throw new AppError(
      409,
      "PLAN_GYM_IMMUTABLE",
      "An existing plan cannot be moved to another gym. Create a plan for that gym instead.",
    );
  const body = (req.params.id ? planInput.partial() : planInput).parse(
    req.body,
  );
  let plan;
  if (req.params.id)
    plan = await MembershipPlan.findOneAndUpdate(
      { publicId: req.params.id },
      { $set: body },
      { returnDocument: "after", runValidators: true },
    );
  else {
    const gym = await Gym.findOne({
      publicId: z.string().parse(req.body.gymId),
      deletedAt: null,
    });
    if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
    plan = await MembershipPlan.create({
      ...body,
      gymId: gym._id,
      publicId: nanoid(20),
    });
  }
  if (!plan) throw new AppError(404, "PLAN_NOT_FOUND", "Plan not found.");
  await refreshGymPrice(plan.gymId);
  await writeAudit(req, {
    action: "plan.saved",
    entityType: "MembershipPlan",
    entityId: plan.publicId,
    after: body,
  });
  res.status(req.params.id ? 200 : 201).json({ success: true, data: plan });
}
export async function membershipAction(req: Request, res: Response) {
  const body = z
    .object({
      action: z.enum([
        "activate",
        "freeze",
        "reactivate",
        "cancel",
        "deactivate",
      ]),
      endsAt: z.coerce.date().optional(),
      reason: z.string().trim().min(3).max(1000),
    })
    .parse(req.body);
  const data = await transitionMembership({
    publicId: String(req.params.id),
    actorId: req.auth!.userId,
    actorRole: req.auth!.role,
    ...body,
  });
  await writeAudit(req, {
    action: `membership.${body.action}`,
    entityType: "Subscription",
    entityId: String(req.params.id),
    reason: body.reason,
  });
  res.json({ success: true, data });
}
export async function updateMember(req: Request, res: Response) {
  const body = z
    .object({
      status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]),
      fitnessGoal: z.string().max(200).optional(),
    })
    .strict()
    .parse(req.body);
  const data = await MemberProfile.findOneAndUpdate(
    { publicId: req.params.id, status: { $ne: "JOIN_REQUESTED" } },
    { $set: body },
    { returnDocument: "after", runValidators: true },
  );
  if (!data) {
    if (
      await MemberProfile.exists({
        publicId: req.params.id,
        status: "JOIN_REQUESTED",
      })
    )
      throw new AppError(
        409,
        "JOIN_REVIEW_REQUIRED",
        "Review this join request using the approve or reject action before editing membership status.",
      );
    throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  }
  await writeAudit(req, {
    action: "member.updated",
    entityType: "MemberProfile",
    entityId: data.publicId,
    after: body,
  });
  res.json({ success: true, data });
}
export async function archiveNotification(req: Request, res: Response) {
  const data = await Notification.findByIdAndUpdate(
    req.params.id,
    { $set: { archivedAt: new Date(), pushStatus: "SKIPPED" } },
    { returnDocument: "after" },
  );
  if (!data)
    throw new AppError(
      404,
      "NOTIFICATION_NOT_FOUND",
      "Notification not found.",
    );
  await writeAudit(req, {
    action: "notification.archived",
    entityType: "Notification",
    entityId: String(data._id),
  });
  res.json({ success: true, data });
}
export async function updateTrainer(req: Request, res: Response) {
  const body = z
    .object({
      name: z.string().trim().min(2).max(120),
      bio: z.string().max(3000).optional(),
      specializations: z.array(z.string().max(100)).max(30).optional(),
      qualifications: z.array(z.string().max(200)).max(30).optional(),
      status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]),
    })
    .strict()
    .parse(req.body);
  const trainer = await mongoose.connection.transaction(async (session) => {
    const target = await Trainer.findOne({ publicId: req.params.id }).session(
      session,
    );
    if (!target)
      throw new AppError(404, "TRAINER_NOT_FOUND", "Trainer not found.");
    const activating = body.status === "ACTIVE";
    if (activating) {
      const gym = await Gym.findOne({
        _id: target.gymId,
        status: "ACTIVE",
        platformSubscriptionStatus: "ACTIVE",
        deletedAt: null,
      }).session(session);
      if (!gym)
        throw new AppError(
          409,
          "GYM_INACTIVE",
          "An active gym subscription is required before activating a trainer.",
        );
      if (!target.userId)
        throw new AppError(
          409,
          "TRAINER_ACCOUNT_REQUIRED",
          "Assign this trainer a verified sign-in account through Accounts before enabling access.",
        );
    }
    if (target.userId) {
      const user = await User.findById(target.userId).session(session);
      if (!user)
        throw new AppError(
          409,
          "TRAINER_ACCOUNT_MISSING",
          "The trainer's linked account is unavailable. Repair the account assignment before changing access.",
        );
      if (activating && user.status !== "ACTIVE")
        throw new AppError(
          409,
          "ACCOUNT_NOT_ACTIVE",
          "The linked account must complete verification and be active before trainer access can be enabled.",
        );
      await RoleAssignment.findOneAndUpdate(
        { userId: user._id, gymId: target.gymId, role: "TRAINER" },
        {
          $set: {
            status: activating ? "ACTIVE" : "REVOKED",
            permissions: TRAINER_DEFAULT_PERMISSIONS,
          },
        },
        { session, upsert: activating, runValidators: true },
      );
      if (activating)
        user.roles = [...new Set([...(user.roles || []), "USER", "TRAINER"])];
      else if (
        !(await RoleAssignment.exists({
          userId: user._id,
          role: "TRAINER",
          status: "ACTIVE",
        }).session(session))
      )
        user.roles = user.roles.filter((role: string) => role !== "TRAINER");
      if (!user.roles.includes(user.activeRole)) user.activeRole = "USER";
      await User.updateOne(
        { _id: user._id },
        {
          $set: { roles: user.roles, activeRole: user.activeRole },
          $inc: { version: 1 },
        },
        { session, runValidators: true },
      );
      if (!activating)
        await Session.updateMany(
          {
            userId: user._id,
            activeGymId: target.gymId,
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
    }
    Object.assign(target, body);
    await target.save({ session });
    return target;
  });
  await writeAudit(req, {
    action: "trainer.updated",
    entityType: "Trainer",
    entityId: trainer.publicId,
    after: body,
  });
  res.json({ success: true, data: trainer });
}
export const settingsInput = z
  .object({
    supportEmail: z.string().email().optional(),
    supportPhone: z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/)
      .optional(),
    maintenanceNotice: z.string().max(500).optional(),
  })
  .strict();
export async function settings(req: Request, res: Response) {
  if (req.method === "GET")
    return res.json({
      success: true,
      data:
        (await PlatformSettings.findOne({ key: "platform" }).lean())?.values ||
        {},
    });
  const values = settingsInput.parse(req.body);
  const data = await PlatformSettings.findOneAndUpdate(
    { key: "platform" },
    { $set: { values, updatedBy: req.auth!.userId } },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  await writeAudit(req, {
    action: "platform.settings.updated",
    entityType: "PlatformSettings",
    entityId: "platform",
    after: values,
  });
  res.json({ success: true, data: data.values });
}
