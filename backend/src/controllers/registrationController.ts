import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { User } from "../models/User.js";
import { RoleAssignment } from "../models/Auth.js";
import { Payment } from "../models/Commerce.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";
import {
  editableRegistrationStates,
  payableGym,
  registrationStatus,
} from "../services/registrationService.js";

export async function createRegistration(req: Request, res: Response) {
  let created = false;
  const data = await mongoose.connection.transaction(async (session) => {
    // Serialize draft creation for this owner, including simultaneous double-clicks.
    await User.updateOne(
      { _id: req.auth!.userId },
      { $inc: { registrationRevision: 1 } },
      { session },
    );
    const existing = await GymRegistration.findOne({
      ownerId: req.auth!.userId,
      status: { $nin: ["ACTIVE", "SUSPENDED"] },
    }).session(session);
    if (existing) {
      created = false;
      return {
        registration: existing,
        gym: await Gym.findById(existing.gymId).session(session),
      };
    }
    const [gym] = await Gym.create(
      [
        {
          publicId: nanoid(18),
          ownerId: req.auth!.userId,
          name: req.body.name,
          slug: `${
            req.body.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/(^-|-$)/g, "") || "gym"
          }-${nanoid(8).toLowerCase()}`,
          description: req.body.description,
          contact: req.body.contact,
          address: req.body.address,
          location: { type: "Point", coordinates: req.body.coordinates },
          timezone: req.body.timezone || "Asia/Kolkata",
          status: "INACTIVE",
          profileCompleteness: 25,
        },
      ],
      { session },
    );
    const [registration] = await GymRegistration.create(
      [
        {
          publicId: nanoid(18),
          ownerId: req.auth!.userId,
          gymId: gym._id,
          currentStep: "PLAN",
          status: "DRAFT",
        },
      ],
      { session },
    );
    await User.updateOne(
      { _id: req.auth!.userId },
      { $addToSet: { roles: "GYM_OWNER" } },
      { session },
    );
    await RoleAssignment.create(
      [
        {
          userId: req.auth!.userId,
          role: "GYM_OWNER",
          gymId: gym._id,
          permissions: OWNER_DEFAULT_PERMISSIONS,
          status: "ACTIVE",
        },
      ],
      { session },
    );
    created = true;
    return { registration, gym };
  });
  if (created)
    await writeAudit(req, {
      action: "gym.registration.created",
      entityType: "GymRegistration",
      entityId: data.registration.publicId,
    });
  res.status(created ? 201 : 200).json({ success: true, data });
}
export async function getRegistration(req: Request, res: Response) {
  const data = await GymRegistration.findOne({
    publicId: req.params.id,
    ownerId: req.auth!.userId,
  })
    .populate("gymId")
    .lean();
  if (!data)
    throw new AppError(
      404,
      "REGISTRATION_NOT_FOUND",
      "Registration not found.",
    );
  res.json({
    success: true,
    data: { ...data, status: registrationStatus(data) },
  });
}
export async function updateRegistration(req: Request, res: Response) {
  const data = await mongoose.connection.transaction(async (session) => {
    const registration = await GymRegistration.findOne({
      publicId: req.params.id,
      ownerId: req.auth!.userId,
    }).session(session);
    if (!registration)
      throw new AppError(
        404,
        "REGISTRATION_NOT_FOUND",
        "Registration not found.",
      );
    if (!editableRegistrationStates.includes(registration.status))
      throw new AppError(
        409,
        "REGISTRATION_LOCKED",
        "This registration is active or suspended. Manage its profile from the owner workspace.",
      );
    if (
      await Payment.exists({
        gymId: registration.gymId,
        payerId: registration.ownerId,
        purpose: "PLATFORM_PLAN",
        status: { $in: ["CREATED", "PENDING", "AUTHORIZED"] },
      }).session(session)
    )
      throw new AppError(
        409,
        "PAYMENT_IN_PROGRESS",
        "Finish or close the current checkout before changing gym details.",
      );
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.body.gym || {})) {
      if (
        ["address", "contact", "location"].includes(key) &&
        value &&
        typeof value === "object"
      )
        for (const [child, entry] of Object.entries(value))
          update[`${key}.${child}`] = entry;
      else update[key] = value;
    }
    await Gym.updateOne(
      { _id: registration.gymId, ownerId: req.auth!.userId },
      { $set: update },
      { session, runValidators: true },
    );
    registration.markModified("currentStep");
    if (req.body.currentStep) registration.currentStep = req.body.currentStep;
    await registration.save({ session });
    return registration;
  });
  res.json({ success: true, data });
}
// Kept as a compatibility endpoint: validate details and continue to plan selection.
export async function submitRegistration(req: Request, res: Response) {
  const data = await mongoose.connection.transaction(async (session) => {
    const registration = await GymRegistration.findOne({
      publicId: req.params.id,
      ownerId: req.auth!.userId,
    }).session(session);
    if (!registration)
      throw new AppError(
        404,
        "REGISTRATION_NOT_FOUND",
        "Registration not found.",
      );
    if (registration.status === "ACTIVE") return registration;
    await payableGym(registration, session);
    if (
      !["PAYMENT_PENDING", "PAYMENT_FAILED", "PAYMENT_CANCELLED"].includes(
        registration.status,
      )
    )
      registration.status = "DRAFT";
    registration.currentStep = "PLAN";
    await registration.save({ session });
    return registration;
  });
  res.json({ success: true, data });
}
