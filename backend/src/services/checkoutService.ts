import mongoose from "mongoose";
import { env } from "../config/env.js";
import { nanoid } from "nanoid";
import { MembershipPlan, Payment, PlanQuote } from "../models/Commerce.js";
import { RouteTransfer } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { AppError } from "../utils/AppError.js";
import {
  editableRegistrationStates,
  payableGym,
} from "./registrationService.js";
import { paymentProvider } from "../integrations/payments/index.js";
import { validatePlatformRenewalOrder } from "./platformRenewalService.js";
import { calculateMembershipPricing, findEligibleOffer, reserveQuoteOffer } from "./promotionService.js";
import { requireMembershipBeneficiary } from "./paymentConnectionService.js";

export async function createMembershipQuote(input: {
  userId: string;
  gymId: string;
  planId: string;
  couponCode?: string;
  offerId?: string;
}) {
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

  const offer = await findEligibleOffer({ ...input, plan });
  const pricingSnapshot = calculateMembershipPricing(plan, offer);
  const { subtotalMinor, discountMinor, taxMinor, totalMinor } = pricingSnapshot;
  if (totalMinor < 100)
    throw new AppError(422, "MINIMUM_ONLINE_PAYMENT", "Online checkout requires a final amount of at least INR 1. Contact the gym for a free membership.");
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
    couponCode: offer?.code || offer?.publicId,
    offerId: offer?._id,
    pricingSnapshot,
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
    let beneficiary: any;
    if (quote.planSnapshot?.type === "PLATFORM" && quote.planSnapshot?.renewal) {
      await validatePlatformRenewalOrder(quote, input.userId, session);
    } else if (quote.planSnapshot?.type === "PLATFORM") {
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
    } else {
      beneficiary = await requireMembershipBeneficiary(String(quote.gymId));
    }
    if (
      await Payment.exists({
        quoteId: quote._id,
        payerId: input.userId,
        status: {
          $in: ["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"],
        },
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
        { offerId: { $exists: true }, offerReservationStatus: "RESERVED" },
      ],
    }).session(session);
    if (existing) {
      if (
        existing.purpose === "MEMBERSHIP" &&
        existing.allocationStatus === "FAILED"
      )
        throw new AppError(
          409,
          "ROUTE_ORDER_RECONCILIATION_REQUIRED",
          "This Razorpay order has an unresolved beneficiary allocation. Contact support before retrying.",
        );
      if (existing.offerId && !existing.providerOrderId && ["FAILED", "CANCELLED"].includes(existing.status))
        throw new AppError(409, "PROMOTION_ORDER_RECONCILIATION_REQUIRED", "This offer is reserved for a payment whose order could not be confirmed. Contact support with the payment reference before starting another payment.");
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
    await reserveQuoteOffer(quote, input.userId, session);
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
          pricingSnapshot: quote.pricingSnapshot,
          ...(quote.offerId ? { offerId: quote.offerId, offerReservationStatus: "RESERVED" } : {}),
          currency: quote.currency,
          provider: "RAZORPAY",
          providerEnvironment: env.RAZORPAY_MODE.toUpperCase(),
          allocationStatus:
            quote.planSnapshot?.type === "PLATFORM"
              ? "NOT_APPLICABLE"
              : "PLANNED",
          beneficiarySnapshot: beneficiary
            ? {
                paymentConnectionId: beneficiary._id,
                paymentConnectionPublicId: beneficiary.publicId,
                linkedAccountId: beneficiary.linkedAccountId,
                mappingVersion: beneficiary.mappingVersion,
                businessLegalName: beneficiary.businessLegalName,
                maskedSettlementAccount: beneficiary.maskedSettlementAccount,
                feeBearerPolicy: beneficiary.feeBearerPolicy,
                customerPaidMinor: quote.totalMinor,
                gatewayFeeMinor: null,
                routeFeeMinor: null,
                providerTaxMinor: null,
                commissionMinor: 0,
                transferAmountMinor: quote.totalMinor,
              }
            : undefined,
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
    const beneficiary = payment.beneficiarySnapshot;
    const providerOrder = await paymentProvider.createPayment({
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      receipt: payment.publicId,
      notes: {
        purchase_reference: payment.publicId,
        purpose:
          payment.purpose === "PLATFORM_PLAN"
            ? "PLATFORM_SUBSCRIPTION"
            : "GYM_MEMBERSHIP",
      },
      ...(payment.purpose === "MEMBERSHIP"
        ? {
            transfers: [
              {
                account: beneficiary.linkedAccountId,
                amount: beneficiary.transferAmountMinor,
                currency: "INR" as const,
                on_hold: false,
                notes: { purchase_reference: payment.publicId },
                linked_account_notes: ["purchase_reference"],
              },
            ],
          }
        : {}),
    });
    payment.providerOrderId = providerOrder.id;
    // Persist the provider identity before any follow-up inspection. A timeout
    // or database error after order creation is an uncertain financial state,
    // so a retry must reconcile this exact order instead of creating another.
    await payment.save();
    if (payment.purpose === "PLATFORM_PLAN" && providerOrder.transfers?.length)
      throw new AppError(
        409,
        "PLATFORM_ORDER_TRANSFER_CONFLICT",
        "The platform order unexpectedly contains a gym transfer and was blocked.",
      );
    if (payment.purpose === "MEMBERSHIP") {
      const transfers =
        providerOrder.transfers?.length
          ? providerOrder.transfers
          : await paymentProvider.getOrderTransfers(providerOrder.id);
      const transfer = transfers.find(
        (entry) =>
          entry.recipient === beneficiary.linkedAccountId &&
          entry.amount === beneficiary.transferAmountMinor &&
          entry.currency === payment.currency,
      );
      if (transfers.length !== 1 || !transfer?.id) {
        payment.status = "FAILED";
        payment.allocationStatus = "FAILED";
        payment.failureCode = "ROUTE_TRANSFER_MISMATCH";
        payment.failureDescription =
          "Razorpay did not confirm the exact gym beneficiary transfer.";
        await payment.save();
        throw new AppError(
          409,
          "ROUTE_TRANSFER_MISMATCH",
          "Razorpay did not confirm the exact gym beneficiary transfer. This order requires reconciliation.",
        );
      }
      await RouteTransfer.create({
        publicId: nanoid(24),
        paymentId: payment._id,
        gymId: payment.gymId,
        paymentConnectionId: beneficiary.paymentConnectionId,
        environment: env.RAZORPAY_MODE.toUpperCase(),
        providerOrderId: providerOrder.id,
        providerTransferId: transfer.id,
        linkedAccountId: beneficiary.linkedAccountId,
        beneficiaryMappingVersion: beneficiary.mappingVersion,
        amountMinor: transfer.amount,
        amountReversedMinor: transfer.amount_reversed || 0,
        providerFeeMinor: transfer.fees || 0,
        providerTaxMinor: transfer.tax || 0,
        currency: transfer.currency,
        status: String(transfer.status || "CREATED").toUpperCase(),
        settlementStatus:
          String(transfer.settlement_status || "PENDING").toUpperCase() ===
          "ON_HOLD"
            ? "ON_HOLD"
            : String(transfer.settlement_status || "PENDING").toUpperCase(),
        providerSettlementId: transfer.recipient_settlement_id || undefined,
        beneficiarySnapshot: beneficiary,
      });
      payment.allocationStatus = String(
        transfer.status || "CREATED",
      ).toUpperCase();
    }
    payment.status = "PENDING";
    await payment.save();
    return payment;
  } catch (error) {
    const providerOrderWasCreated = Boolean(payment.providerOrderId);
    await Payment.updateOne(
      { _id: payment._id, status: "CREATED" },
      {
        $set: {
          status: "FAILED",
          ...(payment.purpose === "MEMBERSHIP" && providerOrderWasCreated
            ? {
                allocationStatus: "FAILED",
                failureCode: "ROUTE_ORDER_RECONCILIATION_REQUIRED",
              }
            : {}),
          failureDescription:
            payment.purpose === "MEMBERSHIP" && providerOrderWasCreated
              ? "Razorpay created the order, but its beneficiary allocation requires reconciliation before checkout can resume."
              : "Payment order could not be created. Please retry.",
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
