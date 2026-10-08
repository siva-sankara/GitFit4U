import mongoose, { type ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { RoleAssignment } from "../models/Auth.js";
import {
  Payment,
  PlanQuote,
  PlatformPlan,
  Subscription,
  SubscriptionEvent,
} from "../models/Commerce.js";
import { AppError } from "../utils/AppError.js";
import { emitDomainEvent } from "./domainEventService.js";
import { platformQuotePricing, type OfferSelection } from "./promotionService.js";

async function renewalGym(
  userId: string,
  gymId: string,
  session: ClientSession,
) {
  const gym = await Gym.findOneAndUpdate(
    {
      _id: gymId,
      ownerId: userId,
      deletedAt: null,
      status: { $nin: ["ARCHIVED", "SUSPENDED"] },
    },
    { $inc: { version: 1 } },
    { session, returnDocument: "after" },
  );
  if (!gym)
    throw new AppError(
      403,
      "RENEWAL_FORBIDDEN",
      "Only the gym's owner can renew an eligible gym subscription.",
    );
  const previous = await Subscription.findOne({
    type: "PLATFORM",
    gymId,
    userId,
  })
    .sort({ endsAt: -1 })
    .session(session);
  if (!previous)
    throw new AppError(
      409,
      "REGISTRATION_REQUIRED",
      "Complete the gym registration payment before renewing.",
    );
  return { gym, previous };
}
async function checkLimits(
  gymId: string,
  snapshot: any,
  session: ClientSession,
) {
  const [members, staff] = await Promise.all([
    MemberProfile.countDocuments({ gymId, status: "ACTIVE" }).session(session),
    RoleAssignment.countDocuments({
      gymId,
      role: { $in: ["GYM_STAFF", "TRAINER"] },
      status: "ACTIVE",
    }).session(session),
  ]);
  if (
    (snapshot.memberLimit != null && members > snapshot.memberLimit) ||
    (snapshot.staffLimit != null && staff > snapshot.staffLimit)
  )
    throw new AppError(
      409,
      "PLAN_CAPACITY_TOO_SMALL",
      "Choose a platform plan that supports your current member and staff usage.",
    );
}
export async function platformRenewalQuote(
  userId: string,
  gymId: string,
  planId: string,
  selection: OfferSelection = {},
) {
  return mongoose.connection.transaction(async (session) => {
    const { previous } = await renewalGym(userId, gymId, session);
    const plan = await PlatformPlan.findOne({
      _id: planId,
      active: true,
    }).session(session);
    if (!plan || plan.priceMinor < 100)
      throw new AppError(
        422,
        "PLAN_UNAVAILABLE",
        "Choose an available paid platform plan.",
      );
    await checkLimits(gymId, plan, session);
    const outstanding = await Payment.findOne({
      gymId,
      payerId: userId,
      purpose: "PLATFORM_PLAN",
      "metadata.quoteSnapshot.planSnapshot.renewal": true,
      $or: [
        { status: { $in: ["CREATED", "PENDING", "AUTHORIZED"] } },
        {
          status: { $in: ["FAILED", "CANCELLED"] },
          providerOrderId: { $exists: true, $ne: null },
        },
      ],
    })
      .sort({ createdAt: -1 })
      .session(session);
    if (outstanding) {
      const snapshot = outstanding.metadata?.quoteSnapshot;
      if (String(snapshot?.planId) !== String(plan._id))
        throw new AppError(
          409,
          "PAYMENT_IN_PROGRESS",
          "Resume the existing renewal order before choosing a different plan.",
        );
      let previousQuote = await PlanQuote.findById(outstanding.quoteId).session(
        session,
      );
      if (!previousQuote && snapshot?._id)
        previousQuote = new PlanQuote(snapshot);
      if (!previousQuote)
        throw new AppError(
          409,
          "RENEWAL_ORDER_UNAVAILABLE",
          "Contact support to reconcile the outstanding renewal order.",
        );
      previousQuote.expiresAt = new Date(Date.now() + 15 * 60000);
      await previousQuote.save({ session });
      return { ...previousQuote.toObject(), paymentCommitted: true };
    }
    const pricing = await platformQuotePricing({ ...selection, plan, userId, gymId, renewal: true }, session);
    const cached = await PlanQuote.findOne({
      gymId,
      purchaserId: userId,
      planId,
      "planSnapshot.renewal": true,
      "planSnapshot.previousSubscriptionId": String(previous._id),
      "planSnapshot.version": plan.version,
      offerId: pricing.offerId || null,
      "pricingSnapshot.offer.version": pricing.pricingSnapshot.offer?.version || { $exists: false },
      expiresAt: { $gt: new Date() },
    }).session(session);
    if (
      cached &&
      !(await Payment.exists({
        quoteId: cached._id,
        status: {
          $in: ["CAPTURED", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"],
        },
      }).session(session))
    )
      return cached;
    return (
      await PlanQuote.create(
        [
          {
            publicId: nanoid(24),
            purchaserId: userId,
            gymId,
            planId,
            planSnapshot: {
              type: "PLATFORM",
              renewal: true,
              previousSubscriptionId: String(previous._id),
              name: plan.name,
              code: plan.code,
              version: plan.version,
              billingPeriod: plan.billingPeriod,
              durationDays: plan.billingPeriod === "YEARLY" ? 365 : 30,
              priceMinor: plan.priceMinor,
              features: plan.features,
              memberLimit: plan.memberLimit,
              staffLimit: plan.staffLimit,
            },
            ...pricing,
            currency: plan.currency,
            expiresAt: new Date(Date.now() + 15 * 60000),
          },
        ],
        { session },
      )
    )[0];
  });
}
export async function validatePlatformRenewalOrder(
  quote: any,
  userId: string,
  session: ClientSession,
) {
  const { previous } = await renewalGym(userId, String(quote.gymId), session);
  if (String(previous._id) !== quote.planSnapshot.previousSubscriptionId)
    throw new AppError(
      409,
      "RENEWAL_ALREADY_CHANGED",
      "Your platform subscription changed. Refresh its renewal price.",
    );
  await checkLimits(String(quote.gymId), quote.planSnapshot, session);
}
export function renewalEnd(
  previous: { status: string; endsAt?: Date } | null,
  durationDays: number,
  now = new Date(),
) {
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 366)
    throw new AppError(
      422,
      "DURATION_INVALID",
      "The renewal duration is invalid.",
    );
  const base =
    previous?.status === "ACTIVE" && previous.endsAt && previous.endsAt > now
      ? previous.endsAt
      : now;
  return new Date(base.getTime() + durationDays * 86400000);
}
export async function activatePlatformRenewal(
  payment: any,
  quote: any,
  session: ClientSession,
) {
  // The Payment capture claim is the outer idempotency boundary. The gym write
  // serializes different paid orders and never overrides an admin suspension.
  const gym = await Gym.findOneAndUpdate(
    { _id: quote.gymId, ownerId: payment.payerId },
    { $inc: { version: 1 } },
    { session, returnDocument: "after" },
  );
  if (!gym)
    throw new AppError(
      409,
      "RENEWAL_OWNER_CHANGED",
      "This renewal requires support reconciliation.",
    );
  const previous = await Subscription.findOne({
    gymId: gym._id,
    type: "PLATFORM",
  })
    .sort({ endsAt: -1 })
    .session(session);
  if (!previous)
    throw new AppError(
      409,
      "PREVIOUS_SUBSCRIPTION_MISSING",
      "The original platform subscription is unavailable.",
    );
  const now = new Date(),
    endsAt = renewalEnd(previous, quote.planSnapshot.durationDays, now);
  const subscription = (
    await Subscription.create(
      [
        {
          publicId: nanoid(20),
          type: "PLATFORM",
          userId: payment.payerId,
          gymId: gym._id,
          planSnapshot: quote.planSnapshot,
          status: "ACTIVE",
          startsAt: now,
          endsAt,
          renewalAt: endsAt,
          latestPaymentId: payment._id,
        },
      ],
      { session },
    )
  )[0];
  await Subscription.updateMany(
    {
      gymId: gym._id,
      type: "PLATFORM",
      _id: { $ne: subscription._id },
      status: "ACTIVE",
    },
    {
      $set: {
        status: "CANCELLED",
        cancelledAt: now,
        cancellationReason: "RENEWED",
      },
    },
    { session },
  );
  gym.platformSubscriptionStatus = "ACTIVE";
  if (gym.status === "INACTIVE" && !gym.deletedAt) gym.status = "ACTIVE";
  await gym.save({ session });
  payment.subscriptionId = subscription._id;
  await payment.save({ session });
  await SubscriptionEvent.create(
    [
      {
        subscriptionId: subscription._id,
        type: "RENEWED",
        actorId: payment.payerId,
        payload: {
          paymentId: payment.publicId,
          previousSubscriptionId: previous.publicId,
        },
      },
    ],
    { session },
  );
  await emitDomainEvent({
    event: "membership.renewed",
    userId: payment.payerId,
    gymId: gym._id,
    entityId: subscription.publicId,
    actionUrl: "/owner/platform-subscription",
    session,
  });
  await emitDomainEvent({
    event: "payment.successful",
    userId: payment.payerId,
    gymId: gym._id,
    entityId: payment.publicId,
    actionUrl: "/owner/platform-subscription",
    session,
  });
  return subscription;
}
