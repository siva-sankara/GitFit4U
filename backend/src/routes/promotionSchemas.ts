import { z } from "zod";
const objectId = z.string().regex(/^[a-f\d]{24}$/i);
const money = z.number().int().min(0).max(1_000_000_000);
export const promotionStatus = z.enum(["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "EXPIRED", "ENDED", "ARCHIVED"]);
const fields = {
  name: z.string().trim().min(2).max(160), description: z.string().trim().max(3000).default(""),
  gymId: objectId.optional(), startsAt: z.coerce.date(), endsAt: z.coerce.date(),
  status: promotionStatus.default("DRAFT"),
};
const discount = z.object({
  kind: z.enum(["FIXED", "PERCENT"]).default("FIXED"),
  amountMinor: money.optional(), percentageBasisPoints: z.number().int().min(1).max(10_000).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.kind === "FIXED" && (!v.amountMinor || v.percentageBasisPoints !== undefined))
    ctx.addIssue({ code: "custom", message: "Set a positive fixed discount, without a percentage." });
  if (v.kind === "PERCENT" && (!v.percentageBasisPoints || v.amountMinor !== undefined))
    ctx.addIssue({ code: "custom", message: "Set a percentage discount, without a fixed amount." });
});
const offerFields = z.object({
  ...fields, type: z.enum(["DISCOUNT", "NEW_MEMBER", "FESTIVAL", "REFERRAL", "FIRST_MONTH"]),
  code: z.string().trim().min(2).max(30).regex(/^[a-z0-9_-]+$/i).transform(v => v.toUpperCase()).optional(),
  discount, terms: z.string().trim().max(3000).default(""), minimumPurchaseMinor: money.default(0),
  applicablePlanIds: z.array(objectId).max(100).default([]),
  redemptionLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(1).max(100).default(1),
}).strict();
export const offerInput = offerFields.refine(v => v.endsAt > v.startsAt, "End must follow start");
export const platformOfferInput = offerFields.omit({ gymId: true, type: true, applicablePlanIds: true }).extend({
  platformPlanIds: z.array(objectId).max(100).default([]),
  ownerAudienceIds: z.array(objectId).max(100).default([]),
  gymAudienceIds: z.array(objectId).max(100).default([]),
  purchaseKinds: z.array(z.enum(["NEW", "RENEWAL"])).min(1).max(2),
  billingPeriods: z.array(z.enum(["MONTHLY", "YEARLY"])).min(1).max(2),
}).strict().refine(v => v.endsAt > v.startsAt, "End must follow start");
export const adInput = z.object({
  ...fields, budgetMinor: money.default(0),
  creativeAttachmentId: objectId.nullable().optional(),
  placements: z.array(z.enum(["EXPLORE", "DASHBOARD", "GYM_PROFILE"])).min(1).max(3).default(["GYM_PROFILE"]),
  audience: z.object({ kind: z.enum(["ALL", "GYM_MEMBERS"]).default("ALL") }).strict().default({ kind: "ALL" }),
  ctaLabel: z.string().trim().min(1).max(60).default("View gym"),
  ctaTarget: z.enum(["GYM", "PLANS", "OFFER", "EXTERNAL"]).default("GYM"),
  ctaUrl: z.string().url().max(2000).optional(), offerId: objectId.nullable().optional(),
}).strict().superRefine((v, ctx) => {
  if (v.endsAt <= v.startsAt) ctx.addIssue({ code: "custom", message: "End must follow start" });
  if (v.ctaTarget === "OFFER" && !v.offerId) ctx.addIssue({ code: "custom", message: "Select an offer for this action." });
  if (v.ctaTarget === "EXTERNAL") {
    try { const url = new URL(v.ctaUrl || ""); if (url.protocol !== "https:" || url.username || url.password) throw new Error(); }
    catch { ctx.addIssue({ code: "custom", message: "External actions require a valid HTTPS URL without credentials." }); }
  } else if (v.ctaUrl) ctx.addIssue({ code: "custom", message: "Internal actions must not specify an external URL." });
});
