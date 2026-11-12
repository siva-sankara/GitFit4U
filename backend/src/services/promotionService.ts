import mongoose, { type ClientSession } from "mongoose";
import { Offer, Referral } from "../models/Business.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { AppError } from "../utils/AppError.js";

export function effectivePromotionStatus(value: any, now = new Date()) {
  if (!["ACTIVE", "SCHEDULED"].includes(value.status)) return value.status;
  if (new Date(value.endsAt) <= now) return "EXPIRED";
  if (new Date(value.startsAt) > now) return "SCHEDULED";
  return "ACTIVE";
}
export function activePromotionFilter(now = new Date()) {
  return { status: { $in: ["ACTIVE", "SCHEDULED"] }, startsAt: { $lte: now }, endsAt: { $gt: now } };
}
// Unclassified, gym-bound legacy offers remain available until migration. Explicitly
// ambiguous and platform records must never enter member checkout or public listings.
export const gymOfferScopeFilter = { $or: [{ scope: "GYM_MEMBERSHIP" }, { scope: { $exists: false }, gymId: { $type: "objectId" } }] };
export type OfferSelection = { couponCode?: string; offerId?: string };
function selectedOffer(input: OfferSelection) {
  if (input.couponCode && input.offerId)
    throw new AppError(422, "ONE_OFFER_ONLY", "Apply one offer at a time.");
  const key = input.couponCode?.trim();
  return input.offerId ? { publicId: input.offerId } : { $or: [{ code: key?.toUpperCase() }, { publicId: key }] };
}
export function calculateMembershipPricing(plan: any, offer?: any) {
  const subtotalMinor = Number(plan.priceMinor);
  const planDiscountMinor = Math.min(Number(plan.discountMinor || 0), subtotalMinor);
  const taxRateBasisPoints = Number(plan.taxRateBasisPoints || 0);
  if (![subtotalMinor, planDiscountMinor, taxRateBasisPoints].every(n => Number.isSafeInteger(n) && n >= 0))
    throw new AppError(422, "INVALID_PLAN_PRICE", "This plan's price needs administrator review.");
  const remaining = subtotalMinor - planDiscountMinor;
  let offerDiscountMinor = 0;
  if (offer) {
    const discount = offer.discount || {};
    const amount = discount.kind === "PERCENT"
      ? Math.round(remaining * Number(discount.percentageBasisPoints) / 10_000)
      : Number(discount.amountMinor);
    if (!Number.isSafeInteger(amount) || amount < 1 || (discount.kind === "PERCENT" && (discount.percentageBasisPoints < 1 || discount.percentageBasisPoints > 10_000)))
      throw new AppError(422, "OFFER_INVALID", "This offer's discount is not configured correctly.");
    offerDiscountMinor = Math.min(amount, remaining);
  }
  const discountMinor = planDiscountMinor + offerDiscountMinor;
  const taxMinor = Math.round((subtotalMinor - discountMinor) * taxRateBasisPoints / 10_000);
  const totalMinor = subtotalMinor - discountMinor + taxMinor;
  if (![discountMinor, taxMinor, totalMinor].every(Number.isSafeInteger))
    throw new AppError(422, "INVALID_PLAN_PRICE", "This plan's price needs administrator review.");
  return {
    subtotalMinor, planDiscountMinor, offerDiscountMinor, discountMinor,
    taxRateBasisPoints, taxMinor, totalMinor, currency: plan.currency || "INR",
    ...(offer ? { offer: {
      offerId: offer.publicId, name: offer.name, code: offer.code || offer.publicId, type: offer.type,
      scope: offer.scope || "GYM_MEMBERSHIP", version: offer.version || 1,
      ...(offer.scope === "PLATFORM_SUBSCRIPTION" ? { application: "ONE_TIME" } : {}),
      discount: structuredClone(offer.discount), terms: offer.terms || "",
      startsAt: new Date(offer.startsAt), endsAt: new Date(offer.endsAt),
    } } : {}),
  };
}
export function validateOfferApplicability(offer: any, plan: any, gymId: unknown, now = new Date()) {
  if (!offer || effectivePromotionStatus(offer, now) !== "ACTIVE")
    throw new AppError(422, "OFFER_UNAVAILABLE", "This offer is inactive, has not started, or has expired.");
  if (offer.scope && offer.scope !== "GYM_MEMBERSHIP")
    throw new AppError(422, "OFFER_WRONG_SCOPE", "Only gym membership offers can be used for this purchase.");
  if (String(offer.gymId) !== String(gymId))
    throw new AppError(422, "OFFER_WRONG_GYM", "This offer belongs to another gym.");
  if (offer.applicablePlanIds?.length && !offer.applicablePlanIds.some((id: unknown) => String(id) === String(plan._id || plan.id)))
    throw new AppError(422, "OFFER_WRONG_PLAN", "This offer does not apply to the selected plan.");
  if (Number(plan.priceMinor) < Number(offer.minimumPurchaseMinor || 0))
    throw new AppError(422, "OFFER_MINIMUM_PURCHASE", "The selected plan does not meet this offer's minimum purchase.");
  if (offer.type === "FIRST_MONTH" && Number(plan.durationDays) > 31)
    throw new AppError(422, "OFFER_WRONG_PLAN", "This first-month offer applies only to plans lasting up to 31 days.");
}
async function eligibility(offer: any, plan: any, userId: string, gymId: unknown, session?: ClientSession) {
  validateOfferApplicability(offer, plan, gymId);
  if (["NEW_MEMBER", "FIRST_MONTH"].includes(offer.type) && await Subscription.exists({ gymId, userId, type: "GYM_MEMBERSHIP", status: { $ne: "PENDING_PAYMENT" } }).session(session || null))
    throw new AppError(422, "OFFER_NEW_MEMBERS_ONLY", "This offer is available only for a first membership at this gym.");
  if (offer.type === "REFERRAL" && !await Referral.exists({ referredUserId: userId, status: { $in: ["QUALIFIED", "REWARDED"] } }).session(session || null))
    throw new AppError(422, "OFFER_REFERRAL_REQUIRED", "This offer requires a qualified referral.");
  await validateOfferLimits(offer, userId, session);
}
async function validateOfferLimits(offer: any, userId: string, session?: ClientSession) {
  const reserved = await Payment.countDocuments({ offerId: offer._id, offerReservationStatus: "RESERVED" }).session(session || null);
  const redeemed = await Payment.countDocuments({ offerId: offer._id, offerReservationStatus: "REDEEMED" }).session(session || null);
  const consumed = Math.max(offer.redemptionCount || 0, redeemed) + reserved;
  if (offer.redemptionLimit && consumed >= offer.redemptionLimit)
    throw new AppError(409, "OFFER_LIMIT_REACHED", "This offer's remaining uses have been used or reserved by pending payments.");
  const userUses = await Payment.countDocuments({ offerId: offer._id, payerId: userId, offerReservationStatus: { $in: ["RESERVED", "REDEEMED"] } }).session(session || null);
  if (userUses >= (offer.perUserLimit || 1))
    throw new AppError(409, "OFFER_USER_LIMIT_REACHED", "You have used this offer or already have a payment pending with it.");
}
export async function findEligibleOffer(input: { couponCode?: string; offerId?: string; userId: string; gymId: string; plan: any }) {
  if (!input.couponCode && !input.offerId) return undefined;
  const offer = await Offer.findOne({ gymId: input.gymId, $and: [gymOfferScopeFilter, selectedOffer(input)] });
  await eligibility(offer, input.plan, input.userId, input.gymId);
  return offer;
}
export function validatePlatformOfferApplicability(offer: any, input: { plan: any; userId: string; gymId: unknown; renewal: boolean }, now = new Date()) {
  if (!offer || effectivePromotionStatus(offer, now) !== "ACTIVE")
    throw new AppError(422, "OFFER_UNAVAILABLE", "This platform offer is inactive, has not started, or has expired.");
  if (offer.scope !== "PLATFORM_SUBSCRIPTION" || offer.gymId || offer.application !== "ONE_TIME")
    throw new AppError(422, "OFFER_WRONG_SCOPE", "Only platform subscription offers can be used for this purchase.");
  const allows = (ids: any[], id: unknown) => !ids?.length || ids.some(value => String(value) === String(id));
  if (!allows(offer.ownerAudienceIds, input.userId) || !allows(offer.gymAudienceIds, input.gymId))
    throw new AppError(422, "OFFER_AUDIENCE_FORBIDDEN", "This platform offer is not available for this owner and gym.");
  if (!allows(offer.platformPlanIds, input.plan._id || input.plan.id) || !offer.billingPeriods?.includes(input.plan.billingPeriod))
    throw new AppError(422, "OFFER_WRONG_PLAN", "This offer does not apply to the selected platform plan or billing cycle.");
  if (!offer.purchaseKinds?.includes(input.renewal ? "RENEWAL" : "NEW"))
    throw new AppError(422, "OFFER_WRONG_PURCHASE", "This offer does not apply to this subscription purchase.");
  if (Number(input.plan.priceMinor) < Number(offer.minimumPurchaseMinor || 0))
    throw new AppError(422, "OFFER_MINIMUM_PURCHASE", "The plan does not meet the offer's minimum purchase.");
}
export async function platformOfferEligibility(offer: any, input: { plan: any; userId: string; gymId: unknown; renewal: boolean }, session?: ClientSession) {
  validatePlatformOfferApplicability(offer, input);
  const previous = await Subscription.exists({ gymId: input.gymId, type: "PLATFORM", status: { $ne: "PENDING_PAYMENT" } }).session(session || null);
  if (Boolean(previous) !== input.renewal)
    throw new AppError(422, "OFFER_WRONG_PURCHASE", "Refresh the current subscription before applying this offer.");
  await validateOfferLimits(offer, input.userId, session);
}
export async function platformQuotePricing(input: OfferSelection & { plan: any; userId: string; gymId: unknown; renewal: boolean }, session?: ClientSession) {
  const offer = input.couponCode || input.offerId
    ? await Offer.findOne({ scope: "PLATFORM_SUBSCRIPTION", ...selectedOffer(input) }).session(session || null) : undefined;
  if (input.couponCode || input.offerId) await platformOfferEligibility(offer, input, session);
  // Platform plans currently have no separate tax or built-in discount. Preserve that treatment.
  const pricingSnapshot = calculateMembershipPricing({ priceMinor: input.plan.priceMinor, currency: input.plan.currency }, offer);
  if (pricingSnapshot.totalMinor < 100)
    throw new AppError(422, "MINIMUM_ONLINE_PAYMENT", "Online checkout requires a final amount of at least INR 1.");
  return { pricingSnapshot, subtotalMinor: pricingSnapshot.subtotalMinor, discountMinor: pricingSnapshot.discountMinor,
    taxMinor: pricingSnapshot.taxMinor, totalMinor: pricingSnapshot.totalMinor,
    ...(offer ? { offerId: offer._id, couponCode: offer.code || offer.publicId } : {}) };
}
export async function reserveQuoteOffer(quote: any, userId: string, session: ClientSession) {
  if (!quote.offerId) return;
  const platform = quote.planSnapshot?.type === "PLATFORM";
  const offer = await Offer.findOneAndUpdate({ _id: quote.offerId, ...(platform ? { scope: "PLATFORM_SUBSCRIPTION" } : { gymId: quote.gymId }) }, { $inc: { reservationVersion: 1 } }, { session, returnDocument: "after" });
  const plan = { ...quote.planSnapshot, _id: quote.planId, currency: quote.currency };
  if (platform) await platformOfferEligibility(offer, { plan, userId, gymId: quote.gymId, renewal: Boolean(plan.renewal) }, session);
  else await eligibility(offer, plan, userId, quote.gymId, session);
  const current = calculateMembershipPricing(plan, offer);
  if ((offer?.version || 1) !== (quote.pricingSnapshot?.offer?.version || 1) || current.totalMinor !== quote.totalMinor || current.offerDiscountMinor !== quote.pricingSnapshot?.offerDiscountMinor)
    throw new AppError(409, "OFFER_PRICE_CHANGED", "This offer changed. Refresh the price before paying.");
}
export async function redeemPaymentOffer(payment: any, session: ClientSession) {
  if (!payment.offerId || payment.offerReservationStatus !== "RESERVED") return;
  const claimed = await Payment.findOneAndUpdate({ _id: payment._id, offerReservationStatus: "RESERVED" }, { $set: { offerReservationStatus: "REDEEMED" } }, { session, returnDocument: "after" });
  if (!claimed) return;
  await Offer.updateOne({ _id: payment.offerId }, { $inc: { redemptionCount: 1, reservationVersion: 1 } }, { session });
  payment.offerReservationStatus = "REDEEMED";
}
export function promotionGymFilter(id: string) {
  return mongoose.isValidObjectId(id) ? { _id: id } : { publicId: id };
}
