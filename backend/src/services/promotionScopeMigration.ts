import { Offer } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { RoleAssignment } from "../models/Auth.js";
import { MembershipPlan, Payment, PlanQuote } from "../models/Commerce.js";

export function classifyLegacyOffer(facts: { gymExists: boolean; creatorAuthorized: boolean; plansBelongToGym: boolean; paymentPurposes: string[]; paymentGymsMatch: boolean }) {
  if (facts.gymExists && facts.creatorAuthorized && facts.plansBelongToGym && facts.paymentGymsMatch && facts.paymentPurposes.every(purpose => purpose === "MEMBERSHIP"))
    return { scope: "GYM_MEMBERSHIP", reason: "Gym, creator access, plans and existing purchases agree." };
  // Old unbound/admin records lack explicit cycle, audience and one-time terms.
  // Never turn them into a published platform discount by guessing those terms.
  return { scope: "REVIEW_REQUIRED", reason: "Missing or conflicting gym, creator, plan or purchase relationships; explicitly review scope and eligibility." };
}

export async function migratePromotionScopes(apply = false) {
  const counts = { scanned: 0, gymMembership: 0, reviewRequired: 0, updated: 0 };
  const cursor = Offer.find({ scope: { $exists: false } }).lean().cursor();
  for await (const offer of cursor) {
    const gym = offer.gymId ? await Gym.findById(offer.gymId).select("ownerId").lean() : null;
    const creator = await User.findById(offer.createdBy).select("roles").lean();
    const assigned = gym && await RoleAssignment.exists({ userId: offer.createdBy, gymId: gym._id, role: { $in: ["GYM_OWNER", "GYM_STAFF"] } });
    const planCount = offer.applicablePlanIds?.length ? await MembershipPlan.countDocuments({ _id: { $in: offer.applicablePlanIds }, gymId: offer.gymId }) : 0;
    const quotes = await PlanQuote.distinct("_id", { $or: [{ offerId: offer._id }, { "pricingSnapshot.offer.offerId": offer.publicId }] });
    const purchases = await Payment.find({ $or: [{ offerId: offer._id }, { quoteId: { $in: quotes } }, { "pricingSnapshot.offer.offerId": offer.publicId }, { "metadata.quoteSnapshot.offerId": offer._id }] }).select("purpose gymId").lean();
    const result = classifyLegacyOffer({ gymExists: Boolean(gym), creatorAuthorized: Boolean(creator && (creator.roles.includes("ADMIN") || String(gym?.ownerId) === String(offer.createdBy) || assigned)),
      plansBelongToGym: planCount === new Set(offer.applicablePlanIds?.map(String) || []).size,
      paymentPurposes: purchases.map(payment => payment.purpose), paymentGymsMatch: purchases.every(payment => String(payment.gymId) === String(offer.gymId)),
    });
    counts.scanned++;
    if (result.scope === "GYM_MEMBERSHIP") counts.gymMembership++; else counts.reviewRequired++;
    if (apply) {
      // Compare the last observed revision so concurrent edits are not reclassified.
      const updated = await Offer.updateOne({ _id: offer._id, scope: { $exists: false }, updatedAt: offer.updatedAt }, { $set: { scope: result.scope, scopeReviewReason: result.reason, version: offer.version || 1 } });
      counts.updated += updated.modifiedCount;
    }
  }
  return { mode: apply ? "applied" : "dry-run", ...counts };
}
