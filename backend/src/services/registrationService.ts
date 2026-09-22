import type { ClientSession } from "mongoose";
import { z } from "zod";
import { Payment, Subscription } from "../models/Commerce.js";
import { AppError } from "../utils/AppError.js";
import { Gym } from "../models/Gym.js";

// Legacy states remain readable during migration; none grant activation.
export const legacyRegistrationStates = [
  "VERIFICATION_PENDING",
  "CHANGES_REQUIRED",
  "REJECTED",
  "VERIFIED",
  "PAYMENT_SUCCESSFUL",
  "FINAL_APPROVAL",
  "APPROVED",
];
export const editableRegistrationStates = [
  "DRAFT",
  "PAYMENT_PENDING",
  "PAYMENT_FAILED",
  "PAYMENT_CANCELLED",
  ...legacyRegistrationStates,
];
export function registrationStatus(registration: any) {
  if (registration.gymId?.status === "ACTIVE") return "ACTIVE";
  if (["SUSPENDED", "ARCHIVED"].includes(registration.gymId?.status))
    return "SUSPENDED";
  if (
    registration.status === "ACTIVE" &&
    registration.gymId?.status === "INACTIVE"
  )
    return "DRAFT";
  return legacyRegistrationStates.includes(registration.status)
    ? "DRAFT"
    : registration.status;
}
export async function payableGym(registration: any, session?: ClientSession) {
  const gym = await Gym.findOne({
    _id: registration.gymId,
    ownerId: registration.ownerId,
  }).session(session || null);
  if (
    !gym ||
    !editableRegistrationStates.includes(registration.status) ||
    gym.status !== "INACTIVE"
  )
    throw new AppError(
      409,
      "REGISTRATION_PAYMENT_CONFLICT",
      "This gym cannot start a registration payment. Refresh its status.",
    );
  validateRegistrationGym(gym);
  return gym;
}
export async function activatePaidRegistration(
  registration: any,
  payment: any,
  subscription: any,
  session: ClientSession,
) {
  if (
    payment.status !== "CAPTURED" ||
    payment.purpose !== "PLATFORM_PLAN" ||
    String(payment.gymId) !== String(registration.gymId) ||
    String(payment.payerId) !== String(registration.ownerId) ||
    String(subscription.latestPaymentId) !== String(payment._id) ||
    String(subscription.gymId) !== String(registration.gymId) ||
    String(subscription.userId) !== String(registration.ownerId)
  )
    throw new AppError(
      409,
      "PAYMENT_REGISTRATION_MISMATCH",
      "Payment does not belong to this gym registration.",
    );
  const gym = await Gym.findById(registration.gymId).session(session);
  if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
  registration.latestPaymentId = payment._id;
  // Payment never overrides a moderation suspension or archive.
  if (
    ["SUSPENDED", "ARCHIVED"].includes(gym.status) ||
    registration.status === "SUSPENDED"
  ) {
    registration.status = "SUSPENDED";
  } else {
    registration.status = "ACTIVE";
    registration.currentStep = "COMPLETE";
    registration.activatedAt ||= new Date();
    gym.status = "ACTIVE";
    gym.publishedAt ||= registration.activatedAt;
    gym.activationPaymentId ||= payment._id;
  }
  gym.platformSubscriptionStatus = "ACTIVE";
  await registration.save({ session });
  await gym.save({ session });
}
export const coordinatesInput = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
export const registrationContact = z.object({
  phone: z.string().trim().min(8).max(20),
  email: z.string().trim().email(),
  whatsapp: z.string().max(20).optional(),
  website: z.string().url().optional(),
});
export const registrationAddress = z.object({
  line1: z.string().trim().min(1).max(160),
  line2: z.string().max(160).optional(),
  locality: z.string().max(160).optional(),
  city: z.string().trim().min(1).max(160),
  state: z.string().trim().min(1).max(160),
  postalCode: z.string().trim().min(3).max(12),
  country: z.string().length(2).optional(),
});
export function validateRegistrationGym(gym: any) {
  const parsed = z
    .object({
      name: z.string().trim().min(2),
      contact: registrationContact,
      address: registrationAddress,
      location: z.object({ coordinates: coordinatesInput }),
    })
    .safeParse(gym?.toObject ? gym.toObject() : gym);
  if (!parsed.success)
    throw new AppError(
      422,
      "GYM_DETAILS_REQUIRED",
      "Complete the gym name, contact phone/email, full address and valid location before choosing a plan.",
    );
}
export async function registrationPayment(
  registration: any,
  session?: ClientSession,
) {
  if (!registration.latestPaymentId) return null;
  const payment = await Payment.findOne({
    _id: registration.latestPaymentId,
    payerId: registration.ownerId,
    gymId: registration.gymId,
    purpose: "PLATFORM_PLAN",
    status: "CAPTURED",
  }).session(session || null);
  if (!payment) return null;
  const subscription = await Subscription.findOne({
    _id: payment.subscriptionId,
    type: "PLATFORM",
    gymId: registration.gymId,
    userId: registration.ownerId,
    latestPaymentId: payment._id,
    status: "ACTIVE",
    endsAt: { $gt: new Date() },
  }).session(session || null);
  return subscription ? { payment, subscription } : null;
}
