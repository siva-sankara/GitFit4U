import mongoose, { type ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { Payment, PlatformPlan, Subscription, SubscriptionEvent } from "../models/Commerce.js";
import { MemberProfile } from "../models/Member.js";
import { RoleAssignment } from "../models/Auth.js";
import { AuditLog, IdempotencyRecord } from "../models/Operations.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import { validateRegistrationGym, registrationPayment } from "./registrationService.js";
import { ensurePaymentInvoice } from "./invoiceService.js";
import { emitDomainEvent } from "./domainEventService.js";

export const offlinePlatformPaymentInput = z.object({
  method: z.enum(["CASH", "UPI"]),
  amountMinor: z.number().int().positive(),
  currency: z.literal("INR"),
  paidAt: z.coerce.date(),
  reference: z.string().trim().max(120).optional(),
  receiptReference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
  confirmedReceived: z.literal(true),
}).strict().refine(value => value.method !== "UPI" || Boolean(value.reference && value.reference.length >= 6), {
  message: "Enter the UPI UTR/reference and confirm receipt of funds.", path: ["reference"],
});
export const adminActivationInput = z.object({
  mode: z.enum(["OFFLINE_PAYMENT", "PAYMENT_PENDING"]),
  planId: z.string().regex(/^[a-f\d]{24}$/i),
  startsAt: z.coerce.date(),
  endsAt: z.coerce.date(),
  dueAt: z.coerce.date().optional(),
  reason: z.string().trim().min(5).max(1000),
  payment: offlinePlatformPaymentInput.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.mode === "OFFLINE_PAYMENT" && !value.payment)
    ctx.addIssue({ code: "custom", path: ["payment"], message: "Confirm the cash/UPI payment received." });
  if (value.mode === "PAYMENT_PENDING" && (value.payment || !value.dueAt))
    ctx.addIssue({ code: "custom", path: ["dueAt"], message: "Payment-pending activation requires a due date and must not claim payment receipt." });
});

export function validateActivationTerm(input: z.infer<typeof adminActivationInput>, plan: any, now = new Date()) {
  const duration = plan.billingPeriod === "YEARLY" ? 365 : 30;
  if (input.startsAt > now || input.endsAt <= now || input.endsAt <= input.startsAt ||
      input.endsAt.getTime() - input.startsAt.getTime() > duration * 86400000)
    throw new AppError(422, "ACTIVATION_TERM_INVALID", `Choose a current access period of at most ${duration} days for this plan.`);
  if (input.dueAt && (input.dueAt < now || input.dueAt > input.endsAt))
    throw new AppError(422, "PAYMENT_DUE_DATE_INVALID", "Payment due date must fall within the remaining access period.");
  if (!Number.isInteger(plan.memberLimit) || plan.memberLimit < 1 || !Number.isInteger(plan.staffLimit) || plan.staffLimit < 0)
    throw new AppError(422, "PLAN_LIMITS_REQUIRED", "Configure explicit member and staff limits on this platform plan before authorizing access.");
  if (input.payment && (input.payment.amountMinor !== plan.priceMinor || input.payment.currency !== plan.currency || input.payment.paidAt > now))
    throw new AppError(422, "PAYMENT_DETAILS_INVALID", "Record the selected plan's full amount/currency and an actual payment date, not a future date.");
}

/** Paid registration and a current, audited payment exception grant the same bounded entitlement. */
export async function registrationActivationEligibility(registration: any, session?: ClientSession) {
  const paid = await registrationPayment(registration, session);
  if (paid) return paid.subscription;
  return Subscription.findOne({
    type: "PLATFORM", gymId: registration.gymId, userId: registration.ownerId,
    status: "ACTIVE", startsAt: { $lte: new Date() }, endsAt: { $gt: new Date() },
    "adminAuthorization.authorizedBy": { $exists: true },
    "adminAuthorization.paymentStatus": { $in: ["PENDING", "PAID_OFFLINE", "PAID_ONLINE"] },
  }).session(session || null);
}

async function audit(session: ClientSession, actorId: string, gym: any, action: string, reason: string, after: object) {
  await AuditLog.create([{ actorId, actorRole: "ADMIN", gymId: gym._id, action,
    entityType: "Gym", entityId: gym.publicId, outcome: "SUCCESS", reason, after }], { session });
}
async function recordedPayment(payment: any, subscription: any, session: ClientSession) {
  await ensurePaymentInvoice(payment, { session, subscription });
  await emitDomainEvent({ event: "payment.offline", userId: payment.payerId, gymId: payment.gymId,
    entityId: payment.publicId, actionUrl: `/owner/payments?payment=${encodeURIComponent(payment.publicId)}`, session });
}
function requireAdmin(actor: { userId: string; role: string; permissions: string[] }) {
  if (actor.role !== "ADMIN" || !actor.permissions.includes("admin:platform"))
    throw new AppError(403, "ADMIN_REQUIRED", "Only an authorized platform administrator can approve this activation.");
}

export async function authorizeGymActivation(actor: { userId: string; role: string; permissions: string[] }, publicId: string, body: unknown, key: string) {
  requireAdmin(actor);
  const input = adminActivationInput.parse(body);
  if (!key || key.length < 8 || key.length > 128) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A request key is required.");
  const scope = `gym.activation:${actor.userId}:${publicId}`, requestHash = sha256(JSON.stringify(input));
  return mongoose.connection.transaction(async session => {
    // Serialize manual authorizations and normal status actions on the gym.
    const gym = await Gym.findOneAndUpdate({ publicId, deletedAt: null }, { $inc: { version: 1 } }, { session, returnDocument: "after" });
    if (!gym) throw new AppError(404, "GYM_NOT_FOUND", "Gym not found.");
    const replay = await IdempotencyRecord.findOne({ scope, key }).session(session);
    if (replay) {
      if (replay.requestHash !== requestHash) throw new AppError(409, "IDEMPOTENCY_CONFLICT", "This request key belongs to different activation details.");
      return { ...replay.responseBody, duplicate: true };
    }
    if (["SUSPENDED", "ARCHIVED"].includes(gym.status) || gym.verificationStatus === "REJECTED")
      throw new AppError(409, "GYM_MODERATION_REQUIRED", "Resolve the gym's suspension, archive or rejected verification separately before authorizing payment access.");
    validateRegistrationGym(gym);
    const registration = await GymRegistration.findOne({ gymId: gym._id, ownerId: gym.ownerId }).session(session);
    if (!registration || registration.status === "SUSPENDED") throw new AppError(409, "REGISTRATION_UNAVAILABLE", "An eligible gym registration is required.");
    const current = await Subscription.findOne({ type: "PLATFORM", gymId: gym._id,
      $or: [{ status: "ACTIVE", endsAt: { $gt: new Date() } }, { "adminAuthorization.paymentStatus": "PENDING" }],
    }).session(session);
    if (current) throw new AppError(409, "PLATFORM_TERM_EXISTS", "This gym already has access or an outstanding authorized term. Collect its payment or manage the existing subscription.");
    const plan = await PlatformPlan.findOne({ _id: input.planId, active: true }).session(session);
    if (!plan || plan.currency !== "INR") throw new AppError(422, "PLAN_UNAVAILABLE", "Select an active INR platform plan.");
    const now = new Date();
    validateActivationTerm(input, plan, now);
    const members = await MemberProfile.countDocuments({ gymId: gym._id, status: "ACTIVE" }).session(session);
    const staff = await RoleAssignment.countDocuments({ gymId: gym._id, status: "ACTIVE", role: { $in: ["GYM_STAFF", "TRAINER"] } }).session(session);
    if (members > plan.memberLimit || staff > plan.staffLimit) throw new AppError(409, "PLAN_CAPACITY_TOO_SMALL", "Select a plan that covers the gym's current member and staff usage.");
    const paid = input.mode === "OFFLINE_PAYMENT";
    const [subscription] = await Subscription.create([{
      publicId: nanoid(20), type: "PLATFORM", userId: gym.ownerId, gymId: gym._id, status: "ACTIVE",
      startsAt: input.startsAt, endsAt: input.endsAt, renewalAt: input.endsAt,
      planSnapshot: { type: "PLATFORM", planId: String(plan._id), registrationId: registration.publicId,
        name: plan.name, code: plan.code, version: plan.version, billingPeriod: plan.billingPeriod,
        durationDays: (input.endsAt.getTime() - input.startsAt.getTime()) / 86400000,
        priceMinor: plan.priceMinor, currency: plan.currency, memberLimit: plan.memberLimit, staffLimit: plan.staffLimit, features: plan.features },
      adminAuthorization: { authorizedBy: actor.userId, authorizedAt: now, reason: input.reason,
        paymentStatus: paid ? "PAID_OFFLINE" : "PENDING", dueAt: input.dueAt, settledAt: paid ? now : undefined },
    }], { session });
    const [payment] = await Payment.create([{
      publicId: nanoid(24), purpose: "PLATFORM_PLAN", payerId: gym.ownerId, gymId: gym._id,
      subscriptionId: subscription._id, provider: "OFFLINE", status: paid ? "CAPTURED" : "PENDING",
      amountMinor: plan.priceMinor, currency: plan.currency,
      ...(paid ? { methodCategory: input.payment!.method, capturedAt: input.payment!.paidAt } : {}),
      metadata: { adminAuthorized: true, authorizedBy: actor.userId, reason: input.reason,
        ...(paid ? { collectorId: actor.userId, manuallyConfirmed: true, reference: input.payment!.reference,
          receiptReference: input.payment!.receiptReference, notes: input.payment!.notes } : { dueAt: input.dueAt }) },
    }], { session });
    subscription.latestPaymentId = payment._id;
    await subscription.save({ session });
    registration.status = "ACTIVE"; registration.currentStep = "COMPLETE";
    registration.activatedAt ||= now; registration.selectedPlatformPlanId = plan._id; registration.latestPaymentId = payment._id;
    await registration.save({ session });
    gym.status = "ACTIVE"; gym.platformSubscriptionStatus = "ACTIVE"; gym.publishedAt ||= now;
    await gym.save({ session });
    await SubscriptionEvent.create([{ subscriptionId: subscription._id, actorId: actor.userId,
      type: paid ? "ADMIN_OFFLINE_ACTIVATION" : "ADMIN_PAYMENT_PENDING_ACTIVATION",
      payload: { reason: input.reason, paymentId: payment.publicId, dueAt: input.dueAt } }], { session });
    if (paid) await recordedPayment(payment, subscription, session);
    await emitDomainEvent({ event: "gym.activated", userId: gym.ownerId, gymId: gym._id,
      entityId: gym.publicId, occurrenceId: subscription.publicId, actionUrl: "/owner/dashboard", session });
    await audit(session, actor.userId, gym, "gym.activation.authorized", input.reason, {
      subscriptionId: subscription.publicId, paymentId: payment.publicId, paymentStatus: payment.status, startsAt: input.startsAt, endsAt: input.endsAt,
    });
    const result = { gym: gym.toObject(), subscription: subscription.toObject(), payment: payment.toObject(), duplicate: false };
    await IdempotencyRecord.create([{ scope, key, requestHash, status: "COMPLETED", statusCode: 200,
      responseBody: result, expiresAt: new Date(now.getTime() + 30 * 86400000) }], { session });
    return result;
  });
}

export async function settleAuthorizedPlatformPayment(actor: { userId: string; role: string; permissions: string[] }, paymentId: string, body: unknown) {
  requireAdmin(actor);
  const input = offlinePlatformPaymentInput.parse(body);
  return mongoose.connection.transaction(async session => {
    const payment = await Payment.findOne({ publicId: paymentId, purpose: "PLATFORM_PLAN", provider: "OFFLINE", "metadata.adminAuthorized": true }).session(session);
    if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Authorized platform payment not found.");
    const gym = await Gym.findOneAndUpdate({ _id: payment.gymId, deletedAt: null }, { $inc: { version: 1 } }, { session, returnDocument: "after" });
    const subscription = await Subscription.findOne({ _id: payment.subscriptionId, gymId: payment.gymId, type: "PLATFORM" }).session(session);
    if (!gym || !subscription || !subscription.adminAuthorization?.authorizedBy) throw new AppError(409, "PAYMENT_CONTEXT_CHANGED", "Review the original authorization before collecting payment.");
    if (input.amountMinor !== payment.amountMinor || input.currency !== payment.currency || input.paidAt > new Date())
      throw new AppError(422, "PAYMENT_DETAILS_INVALID", "Confirm the full outstanding amount and actual payment date.");
    const collectionHash = sha256(JSON.stringify(input));
    if (payment.status === "CAPTURED") {
      if (payment.metadata?.collectionHash && payment.metadata.collectionHash !== collectionHash)
        throw new AppError(409, "COLLECTION_ALREADY_RECORDED", "This payment was collected with different details. Review its existing receipt.");
      return { payment, subscription, duplicate: true };
    }
    if (payment.status !== "PENDING" || subscription.adminAuthorization.paymentStatus !== "PENDING")
      throw new AppError(409, "PAYMENT_NOT_COLLECTABLE", "This authorization has already been settled or cancelled.");
    payment.status = "CAPTURED"; payment.methodCategory = input.method; payment.capturedAt = input.paidAt;
    payment.metadata = { ...payment.metadata, collectionHash, collectorId: actor.userId, manuallyConfirmed: true,
      reference: input.reference, receiptReference: input.receiptReference, notes: input.notes };
    subscription.adminAuthorization.paymentStatus = "PAID_OFFLINE"; subscription.adminAuthorization.settledAt = new Date();
    // Collecting arrears does not extend entitlement or undo moderation/expiry.
    await payment.save({ session }); await subscription.save({ session });
    await recordedPayment(payment, subscription, session);
    await audit(session, actor.userId, gym, "platform.payment.collected", input.notes || "Manual payment receipt confirmed", { paymentId, amountMinor: payment.amountMinor, method: input.method });
    return { payment, subscription, duplicate: false };
  });
}

/** A previously issued gateway order may capture after manual activation. */
export async function settleAuthorizedGatewayPayment(registration: any, payment: any, quote: any, session: ClientSession) {
  const subscription = await Subscription.findOne({ type: "PLATFORM", gymId: registration.gymId,
    "planSnapshot.registrationId": registration.publicId, "adminAuthorization.authorizedBy": { $exists: true },
  }).sort({ createdAt: -1 }).session(session);
  if (!subscription) return false;
  const pending = await Payment.findOne({ _id: subscription.latestPaymentId, provider: "OFFLINE", status: "PENDING" }).session(session);
  if (subscription.adminAuthorization.paymentStatus !== "PENDING" || !pending || pending.amountMinor !== payment.amountMinor ||
      pending.currency !== payment.currency || String(subscription.planSnapshot.planId) !== String(quote.planId)) {
    // The money is real but cannot silently buy a second term or settle an
    // unrelated authorization. Leave a captured payment for admin reconciliation.
    payment.metadata = { ...payment.metadata, duplicateRegistrationPayment: true, adminReconciliationRequired: true };
    await payment.save({ session });
    await ensurePaymentInvoice(payment, { session, quote });
    return true;
  }
  pending.status = "CANCELLED";
  pending.metadata = { ...pending.metadata, settledByPaymentId: payment.publicId };
  await pending.save({ session });
  subscription.latestPaymentId = payment._id;
  subscription.adminAuthorization.paymentStatus = "PAID_ONLINE";
  subscription.adminAuthorization.settledAt = new Date();
  payment.subscriptionId = subscription._id;
  registration.latestPaymentId = payment._id;
  await subscription.save({ session }); await payment.save({ session }); await registration.save({ session });
  await ensurePaymentInvoice(payment, { session, subscription, quote });
  await emitDomainEvent({ event: "payment.successful", userId: payment.payerId, gymId: payment.gymId,
    entityId: payment.publicId, actionUrl: `/owner/payments?payment=${encodeURIComponent(payment.publicId)}`, session });
  await SubscriptionEvent.create([{ subscriptionId: subscription._id, type: "AUTHORIZED_PAYMENT_SETTLED",
    payload: { paymentId: payment.publicId, source: "VERIFIED_GATEWAY" } }], { session });
  return true;
}
