import { describe, expect, it, vi, afterEach } from "vitest";
import { calculateMembershipPricing, validateOfferApplicability, effectivePromotionStatus, reserveQuoteOffer, redeemPaymentOffer } from "./promotionService.js";
import { Offer } from "../models/Business.js";
import { Payment } from "../models/Commerce.js";
import { offerInput, adInput } from "../routes/promotionSchemas.js";
const now = new Date("2026-09-27T12:00:00Z");
const plan = { _id: "plan-a", priceMinor: 100000, discountMinor: 10000, taxRateBasisPoints: 1800, durationDays: 30, currency: "INR" };
const offer = { _id: "offer-a", publicId: "offer-public", name: "Gym autumn", gymId: "gym-a", type: "DISCOUNT", status: "ACTIVE", startsAt: new Date("2026-09-01"), endsAt: new Date("2099-10-01"), discount: { kind: "PERCENT", percentageBasisPoints: 1500 }, perUserLimit: 1 };
const query = (value: unknown) => ({ session: vi.fn().mockResolvedValue(value) }) as any;
afterEach(() => { vi.restoreAllMocks(); });
describe("authoritative membership offer pricing", () => {
  it("applies percentage after plan discount, then taxes the discounted amount", () => {
    expect(calculateMembershipPricing(plan, offer)).toMatchObject({ subtotalMinor: 100000, planDiscountMinor: 10000, offerDiscountMinor: 13500, discountMinor: 23500, taxMinor: 13770, totalMinor: 90270, currency: "INR" });
  });
  it("calculates a fixed discount and caps it at the remaining plan amount", () => {
    expect(calculateMembershipPricing(plan, { ...offer, discount: { amountMinor: 5000 } })).toMatchObject({ offerDiscountMinor: 5000, discountMinor: 15000, taxMinor: 15300, totalMinor: 100300 });
    expect(calculateMembershipPricing(plan, { ...offer, discount: { amountMinor: 9999999 } }).totalMinor).toBe(0);
  });
  it("rounds minor units once and rejects invalid configuration", () => {
    expect(calculateMembershipPricing({ ...plan, priceMinor: 101, discountMinor: 0, taxRateBasisPoints: 0 }, { ...offer, discount: { kind: "PERCENT", percentageBasisPoints: 5000 } }).offerDiscountMinor).toBe(51);
    expect(() => calculateMembershipPricing(plan, { ...offer, discount: { kind: "PERCENT", percentageBasisPoints: 10001 } })).toThrow();
    expect(() => calculateMembershipPricing({ ...plan, priceMinor: -1 })).toThrow();
  });
  it.each([
    [{ status: "PAUSED" }, "OFFER_UNAVAILABLE"],
    [{ endsAt: now }, "OFFER_UNAVAILABLE"],
    [{ startsAt: new Date("2027-01-01") }, "OFFER_UNAVAILABLE"],
    [{ gymId: "gym-b" }, "OFFER_WRONG_GYM"],
    [{ applicablePlanIds: ["plan-b"] }, "OFFER_WRONG_PLAN"],
    [{ minimumPurchaseMinor: 100001 }, "OFFER_MINIMUM_PURCHASE"],
  ])("rejects ineligible offers %#", (change, code) => {
    expect(() => validateOfferApplicability({ ...offer, ...change }, plan, "gym-a", now)).toThrow(expect.objectContaining({ code }));
  });
  it("accepts scheduled offers only after the start and rejects first-month annual plans", () => {
    expect(() => validateOfferApplicability({ ...offer, status: "SCHEDULED" }, plan, "gym-a", now)).not.toThrow();
    expect(() => validateOfferApplicability({ ...offer, type: "FIRST_MONTH" }, { ...plan, durationDays: 365 }, "gym-a", now)).toThrow(expect.objectContaining({ code: "OFFER_WRONG_PLAN" }));
  });
  it("copies discount terms into the snapshot rather than retaining a mutable reference", () => {
    const local = structuredClone(offer), snapshot = calculateMembershipPricing(plan, local);
    local.discount.percentageBasisPoints = 5000;
    expect(snapshot.offer?.discount.percentageBasisPoints).toBe(1500);
  });
  it("serializes offer reservations and counts pending orders against the global limit", async () => {
    const session = {} as any;
    vi.spyOn(Offer, "findOneAndUpdate").mockResolvedValue({ ...offer, redemptionLimit: 1 } as any);
    const counts = vi.spyOn(Payment, "countDocuments").mockReturnValueOnce(query(1)).mockReturnValueOnce(query(0));
    await expect(reserveQuoteOffer({ offerId: offer._id, gymId: "gym-a", planId: plan._id, planSnapshot: plan, currency: "INR" }, "user-a", session)).rejects.toMatchObject({ code: "OFFER_LIMIT_REACHED" });
    expect(Offer.findOneAndUpdate).toHaveBeenCalledWith({ _id: offer._id, gymId: "gym-a" }, { $inc: { reservationVersion: 1 } }, expect.objectContaining({ session }));
    expect(counts).toHaveBeenCalledTimes(2);
  });
  it("checks per-user usage and refuses a changed quote price", async () => {
    vi.spyOn(Offer, "findOneAndUpdate").mockResolvedValue(offer as any);
    const counts = vi.spyOn(Payment, "countDocuments").mockReturnValueOnce(query(0)).mockReturnValueOnce(query(0)).mockReturnValueOnce(query(1));
    const quote = { offerId: offer._id, gymId: "gym-a", planId: plan._id, planSnapshot: plan, currency: "INR", totalMinor: 1, pricingSnapshot: {} };
    await expect(reserveQuoteOffer(quote, "user-a", {} as any)).rejects.toMatchObject({ code: "OFFER_USER_LIMIT_REACHED" });
    counts.mockReturnValue(query(0));
    await expect(reserveQuoteOffer(quote, "user-a", {} as any)).rejects.toMatchObject({ code: "OFFER_PRICE_CHANGED" });
  });
  it("counts a captured offer only once across repeated capture callbacks", async () => {
    vi.spyOn(Payment, "findOneAndUpdate").mockResolvedValueOnce({ _id: "payment" } as any).mockResolvedValue(null);
    const increment = vi.spyOn(Offer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
    const payment = { _id: "payment", offerId: offer._id, offerReservationStatus: "RESERVED" };
    await redeemPaymentOffer(payment, {} as any);
    await redeemPaymentOffer(payment, {} as any);
    expect(increment).toHaveBeenCalledOnce();
    expect(payment.offerReservationStatus).toBe("REDEEMED");
  });
});
describe("promotion configuration security", () => {
  const base = { name: "Autumn promotion", startsAt: "2026-09-01", endsAt: "2026-10-01" };
  it("accepts only the fixed or percentage shape and rejects server-owned fields", () => {
    expect(offerInput.safeParse({ ...base, type: "DISCOUNT", discount: { amountMinor: 1000 } }).success).toBe(true);
    expect(offerInput.safeParse({ ...base, type: "DISCOUNT", discount: { kind: "PERCENT", percentageBasisPoints: 2000, amountMinor: 100 } }).success).toBe(false);
    expect(offerInput.safeParse({ ...base, type: "DISCOUNT", discount: { amountMinor: 1000 }, redemptionCount: 0, createdBy: "other" }).success).toBe(false);
  });
  it.each(["javascript:alert(1)", "http://example.com", "https://name:pass@example.com", "//evil.example"])('rejects unsafe external target %s', (ctaUrl) => {
    expect(adInput.safeParse({ ...base, ctaTarget: "EXTERNAL", ctaUrl }).success).toBe(false);
  });
  it("accepts valid HTTPS URLs and prevents internal-action URL injection", () => {
    expect(adInput.safeParse({ ...base, ctaTarget: "EXTERNAL", ctaUrl: "https://example.com/current-promotion" }).success).toBe(true);
    expect(adInput.safeParse({ ...base, ctaTarget: "GYM", ctaUrl: "https://example.com" }).success).toBe(false);
  });
  it("derives actual scheduled/expired states without presenting paused ads", () => {
    expect(effectivePromotionStatus({ ...offer, startsAt: new Date("2027-01-01") }, now)).toBe("SCHEDULED");
    expect(effectivePromotionStatus({ ...offer, endsAt: now }, now)).toBe("EXPIRED");
    expect(effectivePromotionStatus({ ...offer, status: "PAUSED" }, now)).toBe("PAUSED");
    expect(effectivePromotionStatus({ ...offer, status: "SCHEDULED" }, now)).toBe("ACTIVE");
  });
});
