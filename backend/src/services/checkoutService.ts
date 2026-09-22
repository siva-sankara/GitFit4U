import mongoose from "mongoose";
import { env } from "../config/env.js";
import { nanoid } from "nanoid";
import { MembershipPlan, Payment, PlanQuote } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { AppError } from "../utils/AppError.js";
import {
  editableRegistrationStates,
  payableGym,
} from "./registrationService.js";
import { paymentProvider } from "../integrations/payments/index.js";

export async function createMembershipQuote(input: {
  userId: string;
  gymId: string;
  planId: string;
  couponCode?: string;
}) {
  if (input.couponCode)
    throw new AppError(
      422,
      "COUPON_UNAVAILABLE",
      "Coupon redemption is not available for this checkout.",
    );
  const [gym, plan] = await Promise.all([
    Gym.findOne({
      _id: input.gymId,
      status: "ACTIVE",
      platformSubscriptionStatus: "ACTIVE",
    }),
    MembershipPlan.findOne({
      _id: input.planId,
      gymId: input.gymId,
      status: "ACTIVE",
    }),
  ]);
  if (!gym || !plan)
    throw new AppError(
      404,
      "PLAN_NOT_AVAILABLE",
      "This membership plan is not available.",
    );

  const subtotalMinor = plan.priceMinor;
  const discountMinor = Math.min(plan.discountMinor || 0, subtotalMinor);
  const taxableMinor = subtotalMinor - discountMinor;
  const taxMinor = Math.round(
    (taxableMinor * (plan.taxRateBasisPoints || 0)) / 10_000,
  );
  const totalMinor = taxableMinor + taxMinor;
  const quote = await PlanQuote.create({
    publicId: nanoid(24),
    purchaserId: input.userId,
    gymId: gym._id,
    planId: plan._id,
    planSnapshot: {
      planId: plan.publicId,
      code: plan.code,
      version: plan.version,
      name: plan.name,
      durationDays: plan.durationDays,
      benefits: plan.benefits,
      freezeDaysAllowed: plan.freezeDaysAllowed,
      priceMinor: plan.priceMinor,
      taxRateBasisPoints: plan.taxRateBasisPoints,
      discountMinor: plan.discountMinor,
      totalMinor,
    },
    subtotalMinor,
    discountMinor,
    taxMinor,
    totalMinor,
    currency: plan.currency,
    couponCode: input.couponCode,
    expiresAt: new Date(Date.now() + 15 * 60_000),
  });
  return quote;
}

export async function createCheckoutOrder(input: {
  userId: string;
  quoteId: string;
}) {
  if (!env.RAZORPAY_WEBHOOK_SECRET?.trim())
    throw new AppError(
      503,
      "PAYMENT_CAPTURE_NOT_CONFIGURED",
      "Online payment is unavailable until payment capture verification is configured.",
    );
  const reservation = await mongoose.connection.transaction(async (session) => {
    const quote = await PlanQuote.findOneAndUpdate(
      {
        publicId: input.quoteId,
        purchaserId: input.userId,
        expiresAt: { $gt: new Date() },
      },
      { $inc: { orderRevision: 1 } },
      { session, returnDocument: "after" },
    );
    if (!quote)
      throw new AppError(
        410,
        "QUOTE_EXPIRED",
        "This quote has expired. Refresh the price.",
      );
    let registration: any;
    if (quote.planSnapshot?.type === "PLATFORM") {
      registration = await GymRegistration.findOne({
        publicId: quote.planSnapshot.registrationId,
        ownerId: input.userId,
        gymId: quote.gymId,
        selectedPlatformPlanId: quote.planId,
        status: { $in: editableRegistrationStates },
      }).session(session);
      if (!registration)
        throw new AppError(
          409,
          "REGISTRATION_PAYMENT_CONFLICT",
          "Refresh the registration and select its current plan.",
        );
      await payableGym(registration, session);
    }
    if (
      await Payment.exists({
        quoteId: quote._id,
        payerId: input.userId,
        status: { $in: ["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED"] },
      }).session(session)
    )
      throw new AppError(
        409,
        "QUOTE_ALREADY_PAID",
        "This purchase is already recorded. Refresh its status.",
      );
    const existing = await Payment.findOne({
      quoteId: quote._id,
      payerId: input.userId,
      $or: [
        { status: { $in: ["CREATED", "PENDING", "AUTHORIZED"] } },
        {
          status: { $in: ["FAILED", "CANCELLED"] },
          providerOrderId: { $exists: true, $ne: null },
        },
      ],
    }).session(session);
    if (existing) {
      if (registration) {
        registration.latestPaymentId = existing._id;
        registration.status = "PAYMENT_PENDING";
        registration.currentStep = "PAYMENT";
        await registration.save({ session });
      }
      if (["FAILED", "CANCELLED"].includes(existing.status)) {
        existing.status = "PENDING";
        await existing.save({ session });
      }
      return { payment: existing, created: false };
    }
    const [payment] = await Payment.create(
      [
        {
          publicId: nanoid(24),
          purpose:
            quote.planSnapshot?.type === "PLATFORM"
              ? "PLATFORM_PLAN"
              : "MEMBERSHIP",
          payerId: input.userId,
          gymId: quote.gymId,
          quoteId: quote._id,
          amountMinor: quote.totalMinor,
          currency: quote.currency,
          status: "CREATED",
          metadata: { quoteSnapshot: quote.toObject() },
        },
      ],
      { session },
    );
    if (registration) {
      registration.latestPaymentId = payment._id;
      registration.status = "PAYMENT_PENDING";
      registration.currentStep = "PAYMENT";
      await registration.save({ session });
    }
    return { payment, created: true };
  });
  const payment = reservation.payment;
  if (!reservation.created) {
    if (payment.providerOrderId) return payment;
    throw new AppError(
      409,
      "ORDER_IN_PROGRESS",
      "Your payment order is being prepared. Please retry shortly.",
    );
  }
  try {
    const providerOrder = await paymentProvider.createPayment({
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      receipt: payment.publicId,
      notes: { gymId: String(payment.gymId) },
    });
    payment.providerOrderId = providerOrder.id;
    payment.status = "PENDING";
    await payment.save();
    return payment;
  } catch (error) {
    await Payment.updateOne(
      { _id: payment._id, status: "CREATED" },
      {
        $set: {
          status: "FAILED",
          failureDescription:
            "Payment order could not be created. Please retry.",
        },
      },
    );
    if (payment.purpose === "PLATFORM_PLAN")
      await GymRegistration.updateOne(
        {
          gymId: payment.gymId,
          latestPaymentId: payment._id,
          status: "PAYMENT_PENDING",
        },
        { $set: { status: "PAYMENT_FAILED" } },
      );
    throw error;
  }
}
