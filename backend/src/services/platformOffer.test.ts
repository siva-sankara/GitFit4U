import { afterEach, describe, expect, it, vi } from "vitest";
import { calculateMembershipPricing, platformQuotePricing, validatePlatformOfferApplicability, validateOfferApplicability, reserveQuoteOffer } from "./promotionService.js";
import { classifyLegacyOffer } from "./promotionScopeMigration.js";
import { platformOfferInput } from "../routes/promotionSchemas.js";
import { Offer } from "../models/Business.js";
import { Payment, Subscription } from "../models/Commerce.js";
const plan = { _id: "plan", priceMinor: 10001, currency: "INR", billingPeriod: "MONTHLY" };
const offer = { _id: "offer", publicId: "platform-offer", scope: "PLATFORM_SUBSCRIPTION", version: 3, application: "ONE_TIME", name: "Platform offer", status: "ACTIVE", startsAt: new Date("2020-01-01"), endsAt: new Date("2099-01-01"), purchaseKinds: ["NEW", "RENEWAL"], billingPeriods: ["MONTHLY"], discount: { kind: "PERCENT", percentageBasisPoints: 2500 } };
const input = { plan, userId: "owner", gymId: "gym", renewal: false };
const query = (value: unknown) => ({ session: vi.fn().mockResolvedValue(value) }) as any;
afterEach(() => vi.restoreAllMocks());
describe("platform offer boundaries", () => {
  it.each([
    [{ scope: "GYM_MEMBERSHIP" }, "OFFER_WRONG_SCOPE"],
    [{ scope: "REVIEW_REQUIRED" }, "OFFER_WRONG_SCOPE"],
    [{ gymId: "gym" }, "OFFER_WRONG_SCOPE"],
    [{ ownerAudienceIds: ["other"] }, "OFFER_AUDIENCE_FORBIDDEN"],
    [{ gymAudienceIds: ["other"] }, "OFFER_AUDIENCE_FORBIDDEN"],
    [{ platformPlanIds: ["other"] }, "OFFER_WRONG_PLAN"],
    [{ billingPeriods: ["YEARLY"] }, "OFFER_WRONG_PLAN"],
    [{ purchaseKinds: ["RENEWAL"] }, "OFFER_WRONG_PURCHASE"],
    [{ status: "PAUSED" }, "OFFER_UNAVAILABLE"],
    [{ endsAt: new Date("2000-01-01") }, "OFFER_UNAVAILABLE"],
    [{ minimumPurchaseMinor: 20000 }, "OFFER_MINIMUM_PURCHASE"],
  ])("rejects wrong scope, audience, cycle and validity %#", (change, code) => {
    expect(() => validatePlatformOfferApplicability({ ...offer, ...change }, input)).toThrow(expect.objectContaining({ code }));
  });
  it("rejects a platform offer from member eligibility and retains one-time versioned pricing", () => {
    expect(() => validateOfferApplicability(offer, plan, "gym")).toThrow(expect.objectContaining({ code: "OFFER_WRONG_SCOPE" }));
    expect(calculateMembershipPricing(plan, offer)).toMatchObject({ subtotalMinor: 10001, discountMinor: 2500, taxMinor: 0, totalMinor: 7501, offer: { scope: "PLATFORM_SUBSCRIPTION", version: 3, application: "ONE_TIME" } });
  });
  it("does not trust client pricing, scope, creator or recurring terms", () => {
    const base = { name: offer.name, startsAt: offer.startsAt, endsAt: offer.endsAt, purchaseKinds: offer.purchaseKinds, billingPeriods: offer.billingPeriods, discount: offer.discount };
    expect(platformOfferInput.safeParse(base).success).toBe(true);
    for (const field of ["scope", "gymId", "createdBy", "application", "totalMinor", "redemptionCount"])
      expect(platformOfferInput.safeParse({ ...base, [field]: "forged" }).success).toBe(false);
    expect(platformOfferInput.safeParse({ ...base, purchaseKinds: [] }).success).toBe(false);
  });
  it("rejects stacking and a free/negative online amount", async () => {
    await expect(platformQuotePricing({ ...input, couponCode: "ONE", offerId: "TWO" })).rejects.toMatchObject({ code: "ONE_OFFER_ONLY" });
    await expect(platformQuotePricing({ ...input, plan: { ...plan, priceMinor: 0 } })).rejects.toMatchObject({ code: "MINIMUM_ONLINE_PAYMENT" });
    await expect(platformQuotePricing({ ...input, plan: { ...plan, priceMinor: -10 } })).rejects.toMatchObject({ code: "INVALID_PLAN_PRICE" });
  });
  it("rechecks the version and subscription history before a new reservation", async () => {
    vi.spyOn(Offer, "findOneAndUpdate").mockResolvedValue(offer as any);
    const subscription = vi.spyOn(Subscription, "exists").mockReturnValue(query(null));
    vi.spyOn(Payment, "countDocuments").mockReturnValue(query(0));
    const pricing = calculateMembershipPricing(plan, { ...offer, version: 2 });
    const quote = { offerId: offer._id, gymId: "gym", planId: plan._id, planSnapshot: { ...plan, type: "PLATFORM" }, totalMinor: pricing.totalMinor, pricingSnapshot: pricing };
    await expect(reserveQuoteOffer(quote, "owner", {} as any)).rejects.toMatchObject({ code: "OFFER_PRICE_CHANGED" });
    subscription.mockReturnValue(query({ _id: "existing" }));
    await expect(reserveQuoteOffer(quote, "owner", {} as any)).rejects.toMatchObject({ code: "OFFER_WRONG_PURCHASE" });
  });
  it("keeps an admin-edited gym offer in gym scope and flags ambiguous historical purchases", () => {
    const facts = { gymExists: true, creatorAuthorized: true, plansBelongToGym: true, paymentPurposes: ["MEMBERSHIP"], paymentGymsMatch: true };
    expect(classifyLegacyOffer(facts).scope).toBe("GYM_MEMBERSHIP");
    for (const change of [{ creatorAuthorized: false }, { paymentGymsMatch: false }, { gymExists: false }, { paymentPurposes: ["PLATFORM_PLAN"] }])
      expect(classifyLegacyOffer({ ...facts, ...change }).scope).toBe("REVIEW_REQUIRED");
  });
});
