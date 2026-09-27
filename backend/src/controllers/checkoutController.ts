import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { redeemPaymentOffer } from "../services/promotionService.js";
import { env } from "../config/env.js";
import { platformRenewalQuote, activatePlatformRenewal } from "../services/platformRenewalService.js";
import {
  Payment,
  PlanQuote,
  ProviderEvent,
  Subscription,
  SubscriptionEvent,
} from "../models/Commerce.js";
import { MemberProfile } from "../models/Member.js";
import { Notification } from "../models/Engagement.js";
import { emitDomainEvent } from "../services/domainEventService.js";
import {
  createCheckoutOrder,
  createMembershipQuote,
} from "../services/checkoutService.js";
import { sha256 } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";
import { paymentProvider } from "../integrations/payments/index.js";
import { Refund } from "../models/Business.js";
import { ensurePaymentInvoice } from "../services/invoiceService.js";
import {
  submitRefund,
  reconcileRefundEvent,
} from "../services/refundService.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { PlatformPlan } from "../models/Commerce.js";
import {
  registrationPayment,
  editableRegistrationStates,
  payableGym,
  activatePaidRegistration,
} from "../services/registrationService.js";

export async function createPlatformQuote(req: Request, res: Response) {
  if (req.body.renewal === true) {
    if (req.auth?.role !== "GYM_OWNER" || !req.auth.gymId) throw new AppError(403, "RENEWAL_FORBIDDEN", "Select a gym you own before renewing.");
    if (req.body.expectedGymId && req.body.expectedGymId !== req.auth.gymId) throw new AppError(409, "GYM_CONTEXT_CHANGED", "Your selected gym changed. Confirm the intended gym before renewing.");
    return res.status(201).json({ success: true, data: await platformRenewalQuote(req.auth.userId, req.auth.gymId, req.body.planId) });
  }
  const quote = await mongoose.connection.transaction(async (session) => {
    const registration = await GymRegistration.findOne({
      publicId: req.body.registrationId,
      ownerId: req.auth!.userId,
      status: { $in: editableRegistrationStates },
    }).session(session);
    const plan = await PlatformPlan.findOne({
      _id: req.body.planId,
    }).session(session);
    if (!registration || !plan)
      throw new AppError(
        409,
        "PLATFORM_CHECKOUT_UNAVAILABLE",
        "Complete your gym details and select an available registration plan.",
      );
    await payableGym(registration, session);
    if (plan.priceMinor < 100)
      throw new AppError(
        422,
        "PLAN_PRICE_INVALID",
        "Registration plans must cost at least 1 unit of currency.",
      );
    if (await registrationPayment(registration, session))
      throw new AppError(
        409,
        "PLATFORM_ALREADY_PAID",
        "Payment is already recorded. Refresh the registration status.",
      );
    const outstanding = await Payment.findOne({
      gymId: registration.gymId,
      payerId: req.auth!.userId,
      purpose: "PLATFORM_PLAN",
      status: {
        $in: ["CREATED", "PENDING", "AUTHORIZED", "FAILED", "CANCELLED"],
      },
      providerOrderId: { $exists: true, $ne: null },
    }).session(session);
    if (outstanding) {
      const previous =
        (await PlanQuote.findById(outstanding.quoteId).session(session)) ||
        new PlanQuote(outstanding.metadata?.quoteSnapshot);
      if (!previous.planId || String(previous.planId) !== String(plan._id))
        throw new AppError(
          409,
          "PAYMENT_IN_PROGRESS",
          "Resume the plan already linked to this payment order. Reusing that order prevents a second charge.",
        );
      previous.expiresAt = new Date(Date.now() + 15 * 60000);
      await previous.save({ session });
      return previous;
    }
    if (!plan.active)
      throw new AppError(
        409,
        "PLAN_UNAVAILABLE",
        "This registration plan is no longer available. Select another plan.",
      );
    const cached = await PlanQuote.findOne({
      gymId: registration.gymId,
      purchaserId: req.auth!.userId,
      planId: plan._id,
      "planSnapshot.version": plan.version,
      expiresAt: { $gt: new Date() },
    }).session(session);
    registration.selectedPlatformPlanId = plan._id;
    registration.status = "PAYMENT_PENDING";
    registration.currentStep = "PAYMENT";
    await registration.save({ session });
    if (cached) return cached;
    const [result] = await PlanQuote.create(
      [
        {
          publicId: nanoid(24),
          purchaserId: req.auth!.userId,
          gymId: registration.gymId,
          planId: plan._id,
          planSnapshot: {
            type: "PLATFORM",
            registrationId: registration.publicId,
            name: plan.name,
            code: plan.code,
            version: plan.version,
            durationDays: plan.billingPeriod === "YEARLY" ? 365 : 30,
            priceMinor: plan.priceMinor,
            billingPeriod: plan.billingPeriod,
            features: plan.features,
            memberLimit: plan.memberLimit,
            staffLimit: plan.staffLimit,
          },
          subtotalMinor: plan.priceMinor,
          discountMinor: 0,
          taxMinor: 0,
          totalMinor: plan.priceMinor,
          currency: plan.currency,
          expiresAt: new Date(Date.now() + 15 * 60000),
        },
      ],
      { session },
    );
    return result;
  });
  res.status(201).json({ success: true, data: quote });
}

export async function createQuote(req: Request, res: Response) {
  const quote = await createMembershipQuote({
    userId: req.auth!.userId,
    ...req.body,
  });
  res.status(201).json({ success: true, data: quote });
}

export async function createOrder(req: Request, res: Response) {
  const payment = await createCheckoutOrder({
    userId: req.auth!.userId,
    quoteId: req.body.quoteId,
  });
  const purchaser = await User.findById(req.auth!.userId)
    .select("name email phone")
    .lean();
  res.status(201).json({
    success: true,
    data: {
      paymentId: payment.publicId,
      providerOrderId: payment.providerOrderId,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      status: payment.status,
      razorpayKeyId: env.RAZORPAY_KEY_ID,
      prefill: {
        name: purchaser?.name,
        email: purchaser?.email,
        contact: purchaser?.phone,
      },
    },
  });
}

export async function paymentStatus(req: Request, res: Response) {
  let payment = await Payment.findOne({
    publicId: req.params.id,
    payerId: req.auth!.userId,
  }).lean();
  if (!payment)
    throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
  // Only reconcile IDs obtained from a signed checkout callback or gateway event.
  // An atomic cooldown also bounds provider requests across multiple browser tabs.
  if (
    payment.providerPaymentId &&
    ["PENDING", "AUTHORIZED"].includes(payment.status)
  ) {
    const claimed = await Payment.findOneAndUpdate(
      {
        _id: payment._id,
        status: { $in: ["PENDING", "AUTHORIZED"] },
        $or: [
          { lastGatewayCheckAt: { $exists: false } },
          { lastGatewayCheckAt: { $lt: new Date(Date.now() - 15000) } },
        ],
      },
      { $set: { lastGatewayCheckAt: new Date() } },
      { returnDocument: "after" },
    );
    if (claimed)
      await reconcileGatewayPayment(claimed, claimed.providerPaymentId);
    payment = await Payment.findById(payment._id).lean();
  }
  res.json({ success: true, data: payment });
}

async function reconcileGatewayPayment(
  payment: any,
  providerPaymentId: string,
) {
  const entity = await paymentProvider.getPaymentStatus(providerPaymentId);
  if (
    entity.id !== providerPaymentId ||
    entity.order_id !== payment.providerOrderId ||
    Number(entity.amount) !== payment.amountMinor ||
    entity.currency !== payment.currency
  )
    throw new AppError(
      409,
      "PAYMENT_DETAILS_MISMATCH",
      "The gateway payment does not match this checkout.",
    );
  if (entity.status === "captured" || entity.status === "failed") {
    await acceptProviderEvent(
      { event: `payment.${entity.status}`, payload: { payment: { entity } } },
      `query:${entity.id}:${entity.status}`,
    );
  }
}

export async function verifyCheckout(req: Request, res: Response) {
  const payment = await Payment.findOne({
    publicId: req.body.paymentId,
    payerId: req.auth!.userId,
  });
  if (!payment || payment.providerOrderId !== req.body.providerOrderId)
    throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
  if (
    !paymentProvider.verifyCheckout({
      orderId: req.body.providerOrderId,
      paymentId: req.body.providerPaymentId,
      signature: req.body.signature,
    })
  )
    throw new AppError(
      401,
      "PAYMENT_SIGNATURE_INVALID",
      "Payment verification failed.",
    );
  if (
    ["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(
      payment.status,
    ) &&
    payment.providerPaymentId === req.body.providerPaymentId
  )
    return res.json({
      success: true,
      data: { paymentId: payment.publicId, status: payment.status },
    });
  await Payment.updateOne(
    {
      _id: payment._id,
      status: {
        $nin: ["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"],
      },
    },
    { $set: { providerPaymentId: req.body.providerPaymentId } },
  );
  // The signed client result proves authenticity, but only the gateway can prove capture.
  await reconcileGatewayPayment(payment, req.body.providerPaymentId);
  const current = await Payment.findById(payment._id).lean();
  res.json({
    success: true,
    data: { paymentId: payment.publicId, status: current!.status },
    message:
      current!.status === "CAPTURED"
        ? "Payment verified and purchase activated."
        : "Payment is awaiting confirmed capture.",
  });
}

export async function cancelCheckout(req: Request, res: Response) {
  const data = await mongoose.connection.transaction(async (session) => {
    const payment = await Payment.findOne({
      publicId: req.params.id,
      payerId: req.auth!.userId,
    }).session(session);
    if (!payment)
      throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
    if (
      !["CREATED", "PENDING", "AUTHORIZED", "FAILED", "CANCELLED"].includes(
        payment.status,
      )
    )
      return payment;
    payment.status = "CANCELLED";
    await payment.save({ session });
    if (payment.purpose === "PLATFORM_PLAN")
      await GymRegistration.updateOne(
        {
          gymId: payment.gymId,
          ownerId: payment.payerId,
          latestPaymentId: payment._id,
          status: { $in: editableRegistrationStates },
        },
        { $set: { status: "PAYMENT_CANCELLED", currentStep: "PAYMENT" } },
        { session },
      );
    return payment;
  });
  res.json({
    success: true,
    data: { paymentId: data.publicId, status: data.status },
  });
}

export async function refundPayment(req: Request, res: Response) {
  const refund = await submitRefund(req);
  res.status(refund.status === "PROCESSING" ? 202 : 200).json({
    success: true,
    data: refund,
    ...(refund.reconciliationRequired
      ? {
          message:
            "Refund reserved; provider confirmation is pending. Do not initiate another refund for this amount.",
        }
      : {}),
  });
}

async function processProviderEvent(
  providerEventId: mongoose.Types.ObjectId,
  payload: Record<string, any>,
) {
  const providerEvent =
    await ProviderEvent.findById(providerEventId).select("+payload");
  if (!providerEvent || providerEvent.status === "PROCESSED") return;
  providerEvent.status = "PROCESSING";
  providerEvent.attempts += 1;
  await providerEvent.save();

  if (
    ["refund.created", "refund.processed", "refund.failed"].includes(
      payload.event,
    )
  ) {
    await reconcileRefundEvent(payload.event, payload.payload?.refund?.entity);
    providerEvent.status = "PROCESSED";
    providerEvent.processedAt = new Date();
    await providerEvent.save();
    return;
  }

  const paymentEntity = payload.payload?.payment?.entity;
  const providerPaymentId = paymentEntity?.id;
  const providerOrderId = paymentEntity?.order_id;
  if (
    !["payment.captured", "order.paid", "payment.failed"].includes(
      payload.event,
    )
  ) {
    providerEvent.status = "PROCESSED";
    await providerEvent.save();
    return;
  }
  if (!providerOrderId || !providerPaymentId)
    throw new AppError(
      422,
      "PAYMENT_EVENT_INVALID",
      "Payment event is missing order or payment details.",
    );
  let payment = await Payment.findOne({ providerOrderId });
  if (!payment) {
    providerEvent.status = "FAILED";
    providerEvent.lastError = "Payment record not found";
    await providerEvent.save();
    return;
  }

  if (payload.event === "payment.captured" || payload.event === "order.paid") {
    if (
      paymentEntity?.status !== "captured" ||
      Number(paymentEntity?.amount) !== payment.amountMinor ||
      paymentEntity?.currency !== payment.currency
    ) {
      providerEvent.status = "FAILED";
      providerEvent.lastError = "Amount or currency mismatch";
      await providerEvent.save();
      return;
    }
    if (
      ![
        "CAPTURED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
        "REFUND_PENDING",
      ].includes(payment.status)
    ) {
      const quote =
        (await PlanQuote.findById(payment.quoteId)) ||
        payment.metadata?.quoteSnapshot;
      if (!quote)
        throw new AppError(
          500,
          "QUOTE_MISSING",
          "Payment quote is unavailable.",
        );
      const dbSession = await mongoose.startSession();
      try {
        await dbSession.withTransaction(async () => {
          const claimed = await Payment.findOneAndUpdate(
            {
              _id: payment._id,
              status: {
                $nin: [
                  "CAPTURED",
                  "REFUNDED",
                  "PARTIALLY_REFUNDED",
                  "REFUND_PENDING",
                ],
              },
            },
            { $set: { status: "CAPTURED" } },
            { session: dbSession, returnDocument: "after" },
          );
          if (!claimed) return;
          payment = claimed;
          payment.status = "CAPTURED";
          payment.providerPaymentId = providerPaymentId;
          payment.capturedAt = new Date();
          payment.methodCategory = paymentEntity?.method;
          await payment.save({ session: dbSession });

          await redeemPaymentOffer(payment, dbSession);

          if (quote.planSnapshot.type === "PLATFORM") {
            if (quote.planSnapshot.renewal === true) {
              const renewed = await activatePlatformRenewal(payment, quote, dbSession);
              await ensurePaymentInvoice(payment, { session: dbSession, quote, subscription: renewed });
              return;
            }
            const registration = await GymRegistration.findOne({
              publicId: quote.planSnapshot.registrationId,
              ownerId: payment.payerId,
            }).session(dbSession);
            if (
              !registration ||
              String(registration.gymId) !== String(payment.gymId)
            )
              throw new AppError(
                409,
                "REGISTRATION_PAYMENT_CONFLICT",
                "Payment does not match this registration.",
              );
            const alreadyActive = await Subscription.findOne({
              type: "PLATFORM",
              gymId: registration.gymId,
              "planSnapshot.registrationId": registration.publicId,
              status: "ACTIVE",
              endsAt: { $gt: new Date() },
            }).session(dbSession);
            if (alreadyActive) {
              payment.metadata = {
                ...payment.metadata,
                duplicateRegistrationPayment: true,
              };
              await payment.save({ session: dbSession });
              return;
            }
            const startsAt = new Date(),
              endsAt = new Date(
                startsAt.getTime() + quote.planSnapshot.durationDays * 86400000,
              );
            const subscription = await Subscription.create(
              [
                {
                  publicId: nanoid(20),
                  type: "PLATFORM",
                  userId: payment.payerId,
                  gymId: quote.gymId,
                  planSnapshot: quote.planSnapshot,
                  status: "ACTIVE",
                  startsAt,
                  endsAt,
                  latestPaymentId: payment._id,
                },
              ],
              { session: dbSession },
            ).then((v) => v[0]);
            payment.subscriptionId = subscription._id;
            await payment.save({ session: dbSession });
            await activatePaidRegistration(
              registration,
              payment,
              subscription,
              dbSession,
            );
            await ensurePaymentInvoice(payment, { session: dbSession, quote, subscription });
            await SubscriptionEvent.create(
              [
                {
                  subscriptionId: subscription._id,
                  type: "ACTIVATED",
                  actorId: payment.payerId,
                  payload: {
                    paymentId: payment.publicId,
                    registrationId: registration.publicId,
                  },
                },
              ],
              { session: dbSession },
            );
            return;
          }

          let member = await MemberProfile.findOne({
            gymId: quote.gymId,
            userId: payment.payerId,
          }).session(dbSession);
          if (!member) {
            member = await MemberProfile.create(
              [
                {
                  publicId: nanoid(18),
                  gymId: quote.gymId,
                  userId: payment.payerId,
                  memberCode: `GFU-${nanoid(8).toUpperCase()}`,
                },
              ],
              { session: dbSession },
            ).then((items) => items[0]);
          }
          const previous = member.currentSubscriptionId
            ? await Subscription.findById(member.currentSubscriptionId).session(
                dbSession,
              )
            : null;
          const startsAt =
            previous?.status === "ACTIVE" && previous.endsAt > new Date()
              ? new Date(previous.endsAt)
              : new Date();
          const durationDays = Number(
            (quote.planSnapshot as { durationDays?: number }).durationDays ||
              30,
          );
          const endsAt = new Date(
            startsAt.getTime() + durationDays * 86_400_000,
          );
          const subscription = await Subscription.create(
            [
              {
                publicId: nanoid(18),
                type: "GYM_MEMBERSHIP",
                userId: payment.payerId,
                gymId: quote.gymId,
                memberProfileId: member._id,
                planSnapshot: quote.planSnapshot,
                status: "ACTIVE",
                startsAt,
                endsAt,
                renewalAt: endsAt,
                latestPaymentId: payment._id,
              },
            ],
            { session: dbSession },
          ).then((items) => items[0]);
          member.currentSubscriptionId = subscription._id;
          member.directAccess = false;
          await member.save({ session: dbSession });
          payment.subscriptionId = subscription._id;
          await payment.save({ session: dbSession });
          await SubscriptionEvent.create(
            [
              {
                subscriptionId: subscription._id,
                type: "ACTIVATED",
                actorId: payment.payerId,
                payload: { paymentId: payment.publicId },
              },
            ],
            { session: dbSession },
          );
          await ensurePaymentInvoice(payment, { session: dbSession, quote, subscription });
          await emitDomainEvent({
            event: previous ? "membership.renewed" : "membership.activated",
            userId: payment.payerId,
            gymId: quote.gymId,
            entityId: subscription.publicId,
            actionUrl: `/app/subscriptions/${subscription.publicId}`,
            session: dbSession,
          });
          await emitDomainEvent({
            event: "payment.successful",
            userId: payment.payerId,
            gymId: quote.gymId,
            entityId: payment.publicId,
            actionUrl: "/app/payments",
            session: dbSession,
          });
        });
      } finally {
        await dbSession.endSession();
      }
    }
  } else if (
    payload.event === "payment.failed" &&
    !["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(
      payment.status,
    )
  ) {
    await mongoose.connection.transaction(async (session) => {
      const failed = await Payment.findOneAndUpdate(
        {
          _id: payment!._id,
          status: {
            $nin: [
              "CAPTURED",
              "REFUNDED",
              "PARTIALLY_REFUNDED",
              "REFUND_PENDING",
            ],
          },
        },
        {
          $set: {
            status: "FAILED",
            providerPaymentId,
            failureCode: paymentEntity?.error_code,
            failureDescription: paymentEntity?.error_description,
          },
        },
        { session, returnDocument: "after" },
      );
      if (failed?.purpose === "PLATFORM_PLAN")
        await GymRegistration.updateOne(
          {
            gymId: failed.gymId,
            ownerId: failed.payerId,
            latestPaymentId: failed._id,
            status: { $in: editableRegistrationStates },
          },
          { $set: { status: "PAYMENT_FAILED", currentStep: "PAYMENT" } },
          { session },
        );
      if (failed)
        await emitDomainEvent({
          event: "payment.failed",
          userId: failed.payerId,
          gymId: failed.gymId,
          entityId: failed.publicId,
          occurrenceId: providerPaymentId,
          actionUrl: "/notifications",
          session,
        });
    });
  }
  providerEvent.status = "PROCESSED";
  providerEvent.processedAt = new Date();
  await providerEvent.save();
}

export async function razorpayWebhook(req: Request, res: Response) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) {
    throw new AppError(
      503,
      "WEBHOOK_NOT_CONFIGURED",
      "Payment webhook is not configured.",
    );
  }
  const signature = req.header("x-razorpay-signature") || "";
  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !paymentProvider.verifyWebhook(raw, signature)) {
    throw new AppError(
      401,
      "INVALID_WEBHOOK_SIGNATURE",
      "Webhook signature validation failed.",
    );
  }
  const payload = JSON.parse(raw.toString("utf8")) as Record<string, any>;
  const eventKey =
    req.header("x-razorpay-event-id") || sha256(raw.toString("utf8"));
  res.status(200).json(await acceptProviderEvent(payload, eventKey));
}

async function acceptProviderEvent(
  payload: Record<string, any>,
  eventKey: string,
) {
  let event;
  try {
    event = await ProviderEvent.create({
      provider: "RAZORPAY",
      eventKey,
      eventType: payload.event,
      payloadHash: sha256(JSON.stringify(payload)),
      payload,
      status: "RECEIVED",
    });
  } catch (error: any) {
    if (error?.code === 11000) {
      event = await ProviderEvent.findOne({ provider: "RAZORPAY", eventKey });
      if (event?.status === "PROCESSED")
        return { success: true, duplicate: true };
      if (!event) throw error;
    } else throw error;
  }
  await processProviderEvent(event._id, payload);
  const processed = await ProviderEvent.findById(event._id);
  if (processed?.status !== "PROCESSED")
    throw new AppError(
      503,
      "WEBHOOK_RETRY_REQUIRED",
      "Payment event requires reconciliation.",
    );
  return { success: true };
}
