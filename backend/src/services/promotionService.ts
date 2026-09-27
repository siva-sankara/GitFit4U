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
      discount: structuredClone(offer.discount), terms: offer.terms || "",
      startsAt: new Date(offer.startsAt), endsAt: new Date(offer.endsAt),
    } } : {}),
  };
}
export function validateOfferApplicability(offer: any, plan: any, gymId: unknown, now = new Date()) {
  if (!offer || effectivePromotionStatus(offer, now) !== "ACTIVE")
    throw new AppError(422, "OFFER_UNAVAILABLE", "This offer is inactive, has not started, or has expired.");
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
  const key = input.couponCode?.trim();
  const offer = await Offer.findOne({ gymId: input.gymId, ...(input.offerId ? { publicId: input.offerId } : { $or: [{ code: key!.toUpperCase() }, { publicId: key }] }) });
  await eligibility(offer, input.plan, input.userId, input.gymId);
  return offer;
}
export async function reserveQuoteOffer(quote: any, userId: string, session: ClientSession) {
  if (!quote.offerId) return;
  const offer = await Offer.findOneAndUpdate({ _id: quote.offerId, gymId: quote.gymId }, { $inc: { reservationVersion: 1 } }, { session, returnDocument: "after" });
  const plan = { ...quote.planSnapshot, _id: quote.planId, currency: quote.currency };
  await eligibility(offer, plan, userId, quote.gymId, session);
  const current = calculateMembershipPricing(plan, offer);
  if (current.totalMinor !== quote.totalMinor || current.offerDiscountMinor !== quote.pricingSnapshot?.offerDiscountMinor)
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
