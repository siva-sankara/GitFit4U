import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Offer } from "../models/Business.js";
import { PlatformPlan } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { platformOfferInput } from "../routes/promotionSchemas.js";
import { activePromotionFilter, platformOfferEligibility } from "../services/promotionService.js";
import { writeAudit } from "../services/auditService.js";
import { paginationFromQuery } from "../utils/pagination.js";
import { AppError } from "../utils/AppError.js";

export async function savePlatformOffer(req: Request, res: Response) {
  if (req.auth?.role !== "ADMIN" || !req.auth.permissions.includes("admin:platform"))
    throw new AppError(403, "FORBIDDEN", "Administrator access required.");
  const input = platformOfferInput.parse(req.body);
  const unique = (ids: string[]) => [...new Set(ids)];
  const platformPlanIds = unique(input.platformPlanIds), ownerAudienceIds = unique(input.ownerAudienceIds), gymAudienceIds = unique(input.gymAudienceIds);
  if (platformPlanIds.length && await PlatformPlan.countDocuments({ _id: { $in: platformPlanIds } }) !== platformPlanIds.length)
    throw new AppError(422, "OFFER_WRONG_PLAN", "Choose configured platform plans.");
  if (gymAudienceIds.length && await Gym.countDocuments({ _id: { $in: gymAudienceIds }, deletedAt: null }) !== gymAudienceIds.length)
    throw new AppError(422, "OFFER_WRONG_GYM", "Choose existing gyms.");
  if (ownerAudienceIds.length) {
    const owners = await Gym.distinct("ownerId", { ownerId: { $in: ownerAudienceIds }, deletedAt: null });
    const registrants = await GymRegistration.distinct("ownerId", { ownerId: { $in: ownerAudienceIds } });
    if (ownerAudienceIds.some(id => ![...owners, ...registrants].some(owner => String(owner) === id)))
      throw new AppError(422, "OFFER_WRONG_OWNER", "Choose gym owners or gym registration applicants.");
  }
  const values = { ...input, scope: "PLATFORM_SUBSCRIPTION", type: "DISCOUNT", application: "ONE_TIME", platformPlanIds, ownerAudienceIds, gymAudienceIds };
  let data;
  try {
    data = req.params.id
      ? await Offer.findOneAndUpdate({ publicId: req.params.id, scope: "PLATFORM_SUBSCRIPTION" }, { $set: values, ...(!input.code ? { $unset: { code: 1 } } : {}), $inc: { version: 1, reservationVersion: 1 } }, { returnDocument: "after", runValidators: true })
      : await Offer.create({ ...values, publicId: nanoid(20), createdBy: req.auth.userId });
  } catch (error: any) {
    if (error?.code === 11000) throw new AppError(409, "OFFER_CODE_EXISTS", "A platform offer already uses this code.");
    throw error;
  }
  if (!data) throw new AppError(404, "OFFER_NOT_FOUND", "Platform offer not found.");
  await writeAudit(req, { action: req.params.id ? "platform_offer.updated" : "platform_offer.created", entityType: "Offer", entityId: data.publicId, after: { status: data.status, scope: data.scope, version: data.version } });
  res.status(req.params.id ? 200 : 201).json({ success: true, data });
}

// Registration applicants may not have an owner role yet. Persisted ownership,
// never a supplied owner ID, determines access to their prospective gym's offers.
export async function eligiblePlatformOffers(req: Request, res: Response) {
  const planId = String(req.query.planId || "");
  if (!mongoose.isValidObjectId(planId)) throw new AppError(422, "PLAN_REQUIRED", "Select a platform plan.");
  const plan = await PlatformPlan.findOne({ _id: planId, active: true }).lean();
  let gymId: unknown, renewal = false;
  if (req.query.registrationId) {
    const registration = await GymRegistration.findOne({ publicId: String(req.query.registrationId), ownerId: req.auth!.userId }).select("gymId").lean();
    gymId = registration?.gymId;
  } else if (req.auth?.role === "GYM_OWNER" && req.auth.gymId) {
    if (req.query.expectedGymId && req.query.expectedGymId !== req.auth.gymId) throw new AppError(409, "GYM_CONTEXT_CHANGED", "Select the intended gym before viewing offers.");
    const gym = await Gym.findOne({ _id: req.auth.gymId, ownerId: req.auth.userId, deletedAt: null }).select("_id").lean();
    gymId = gym?._id; renewal = true;
  }
  if (!gymId || !plan) throw new AppError(403, "PLATFORM_OFFERS_FORBIDDEN", "Choose a platform purchase belonging to your account.");
  const { page, limit, skip } = paginationFromQuery(req.query);
  const candidates = await Offer.find({ scope: "PLATFORM_SUBSCRIPTION", ...activePromotionFilter(),
    $and: [
      { $or: [{ ownerAudienceIds: { $size: 0 } }, { ownerAudienceIds: req.auth!.userId }] },
      { $or: [{ gymAudienceIds: { $size: 0 } }, { gymAudienceIds: gymId }] },
      { $or: [{ platformPlanIds: { $size: 0 } }, { platformPlanIds: plan._id }] },
    ], billingPeriods: plan.billingPeriod, purchaseKinds: renewal ? "RENEWAL" : "NEW",
  }).sort({ endsAt: 1, _id: 1 }).skip(skip).limit(limit).lean();
  const data = [];
  for (const offer of candidates) {
    try { await platformOfferEligibility(offer, { plan, userId: req.auth!.userId, gymId, renewal }); }
    catch (error) { if (error instanceof AppError && [409, 422].includes(error.statusCode)) continue; throw error; }
    data.push({ publicId: offer.publicId, name: offer.name, description: offer.description, discount: offer.discount, code: offer.code || offer.publicId, terms: offer.terms, endsAt: offer.endsAt, application: "ONE_TIME" });
  }
  res.json({ success: true, data, meta: { page, limit, hasMore: candidates.length === limit } });
}
