import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Offer, Advertisement, Attachment } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { MembershipPlan } from "../models/Commerce.js";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { offerInput, promotionStatus, adInput } from "../routes/promotionSchemas.js";
import { activePromotionFilter, effectivePromotionStatus, promotionGymFilter, gymOfferScopeFilter } from "../services/promotionService.js";
import { lockAttachments } from "../services/mediaBindingService.js";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import { AppError } from "../utils/AppError.js";
import { writeAudit } from "../services/auditService.js";

function isAdmin(req: Request) { return req.auth?.role === "ADMIN" && req.auth.permissions.includes("admin:platform"); }
async function scope(req: Request, bodyGymId?: string) {
  const gymId = isAdmin(req) ? bodyGymId : req.auth?.gymId;
  if (!gymId || !mongoose.isValidObjectId(gymId) || (!isAdmin(req) && bodyGymId && bodyGymId !== gymId))
    throw new AppError(403, "PROMOTION_GYM_FORBIDDEN", "Select a gym you are authorized to manage.");
  const gym = await Gym.findOne({ _id: gymId, deletedAt: null, status: { $nin: ["SUSPENDED", "ARCHIVED"] } });
  if (!gym) throw new AppError(403, "GYM_READ_ONLY", "This gym is unavailable for promotional changes.");
  return gym;
}
async function list(req: Request, res: Response, kind: "offer" | "ad" | "platform") {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter: any = {};
  if (kind === "platform") { if (!isAdmin(req)) throw new AppError(403, "FORBIDDEN", "Administrator access required."); filter.scope = "PLATFORM_SUBSCRIPTION"; }
  if (kind === "offer") filter.$and = [gymOfferScopeFilter];
  if (req.query.status) {
    const status = promotionStatus.parse(req.query.status), now = new Date();
    if (status === "ACTIVE") Object.assign(filter, activePromotionFilter(now));
    else if (status === "SCHEDULED") Object.assign(filter, { status: { $in: ["ACTIVE", "SCHEDULED"] }, startsAt: { $gt: now }, endsAt: { $gt: now } });
    else if (status === "EXPIRED") (filter.$and ||= []).push({ $or: [{ status: "EXPIRED" }, { status: { $in: ["ACTIVE", "SCHEDULED"] }, endsAt: { $lte: now } }] });
    else filter.status = status;
  }
  if (isAdmin(req)) {
    if (req.query.gymId) {
      if (!mongoose.isValidObjectId(String(req.query.gymId))) throw new AppError(422, "INVALID_GYM", "Choose a valid gym.");
      filter.gymId = req.query.gymId;
    }
  } else {
    if (!req.auth?.gymId) throw new AppError(403, "GYM_REQUIRED", "Select a gym you manage.");
    filter.gymId = req.auth.gymId;
  }
  const search = String(req.query.q || "").trim().slice(0, 100);
  if (search) {
    const regex = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    const owners = isAdmin(req) ? await User.find({ $or: [{ name: regex }, { email: regex }] }).select("_id").limit(100).lean() : [];
    const gyms = isAdmin(req) ? await Gym.find({ $or: [{ name: regex }, { ownerId: { $in: owners.map(o => o._id) } }] }).select("_id").limit(100).lean() : [];
    (filter.$and ||= []).push({ $or: [{ name: regex }, { description: regex }, { code: regex }, ...(kind !== "platform" ? [{ gymId: { $in: gyms.map(g => g._id) } }] : [])] });
  }
  const Model = kind === "ad" ? Advertisement : Offer;
  const rowsQuery = Model.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).populate({ path: "gymId", select: "name publicId slug ownerId", populate: { path: "ownerId", select: "name email publicId" } });
  if (kind !== "ad") rowsQuery.populate(kind === "platform" ? [
    { path: "platformPlanIds", select: "name billingPeriod" }, { path: "ownerAudienceIds", select: "name email" }, { path: "gymAudienceIds", select: "name" },
  ] : [{ path: "applicablePlanIds", select: "name" }]);
  const [rows, total] = await Promise.all([
    rowsQuery.lean(),
    Model.countDocuments(filter),
  ]);
  const data = kind === "ad" ? await adsWithImages(rows) : rows;
  res.json({ success: true, data: data.map((row: any) => ({ ...row, effectiveStatus: effectivePromotionStatus(row), ...(kind === "ad" ? {
    destination: row.ctaTarget === "EXTERNAL" ? row.ctaUrl : row.gymId?.slug ? `/gyms/${encodeURIComponent(row.gymId.slug)}${row.ctaTarget === "PLANS" ? "#gym-plans" : row.ctaTarget === "OFFER" ? "#gym-offers" : ""}` : "Gym unavailable",
  } : {}) })), meta: pageMeta(page, limit, total) });
}
export const listOffers = (req: Request, res: Response) => list(req, res, "offer");
export const listAds = (req: Request, res: Response) => list(req, res, "ad");
export const listPlatformOffers = (req: Request, res: Response) => list(req, res, "platform");
async function saveOffer(req: Request, res: Response) {
  const input = offerInput.parse(req.body), gym = await scope(req, input.gymId);
  const planIds = [...new Set(input.applicablePlanIds)];
  if (planIds.length && await MembershipPlan.countDocuments({ _id: { $in: planIds }, gymId: gym._id }) !== planIds.length)
    throw new AppError(422, "OFFER_WRONG_PLAN", "Select plans belonging to this gym.");
  const values = { ...input, scope: "GYM_MEMBERSHIP", gymId: gym._id, applicablePlanIds: planIds };
  let data;
  try {
    data = req.params.id
      ? await Offer.findOneAndUpdate({ publicId: req.params.id, gymId: gym._id, $and: [gymOfferScopeFilter] }, { $set: values, ...(!input.code ? { $unset: { code: 1 } } : {}), $inc: { reservationVersion: 1, version: 1 } }, { returnDocument: "after", runValidators: true })
      : await Offer.create({ ...values, publicId: nanoid(20), createdBy: req.auth!.userId });
  } catch (error: any) {
    if (error?.code === 11000) throw new AppError(409, "OFFER_CODE_EXISTS", "This gym already has an offer with that code.");
    throw error;
  }
  if (!data) throw new AppError(404, "OFFER_NOT_FOUND", "Offer not found in this gym.");
  await writeAudit(req, { action: req.params.id ? "offer.updated" : "offer.created", entityType: "Offer", entityId: data.publicId, after: { status: data.status, gymId: String(gym._id) } });
  res.status(req.params.id ? 200 : 201).json({ success: true, data });
}
export const createOffer = saveOffer;
export const updateOffer = saveOffer;
async function saveAd(req: Request, res: Response) {
  const input = adInput.parse(req.body), gym = await scope(req, input.gymId);
  const data = await mongoose.connection.transaction(async session => {
    if (input.ctaTarget === "OFFER" && !await Offer.exists({ _id: input.offerId, gymId: gym._id, status: { $ne: "ARCHIVED" }, $and: [gymOfferScopeFilter] }).session(session))
      throw new AppError(422, "AD_OFFER_UNAVAILABLE", "Choose an offer belonging to this gym.");
    if (input.creativeAttachmentId) {
      const file = await Attachment.findOne({ _id: input.creativeAttachmentId, ownerId: req.auth!.userId, gymId: gym._id, purpose: "AD", storageProvider: "s3", status: "READY", deletedAt: null, mimeType: { $in: ["image/jpeg", "image/png", "image/webp"] } }).session(session);
      if (!file) {
        // Existing campaign editors may retain an already-bound image from another authorized editor.
        const existing = req.params.id && await Advertisement.exists({ publicId: req.params.id, gymId: gym._id, creativeAttachmentId: input.creativeAttachmentId }).session(session);
        const retained = existing && await Attachment.exists({ _id: input.creativeAttachmentId, gymId: gym._id, purpose: "AD", status: "READY", deletedAt: null }).session(session);
        if (!retained) throw new AppError(422, "AD_IMAGE_UNAVAILABLE", "Upload a completed advertisement image for this gym.");
      }
      await lockAttachments([input.creativeAttachmentId], session);
    }
    const values = { ...input, gymId: gym._id, ...(input.ctaTarget !== "OFFER" ? { offerId: null } : {}) };
    const result = req.params.id
      ? await Advertisement.findOneAndUpdate({ publicId: req.params.id, gymId: gym._id }, { $set: values, ...(input.ctaTarget !== "EXTERNAL" ? { $unset: { ctaUrl: 1 } } : {}) }, { session, returnDocument: "after", runValidators: true })
      : (await Advertisement.create([{ ...values, publicId: nanoid(20), createdBy: req.auth!.userId }], { session }))[0];
    if (!result) throw new AppError(404, "AD_NOT_FOUND", "Advertisement not found in this gym.");
    return result;
  });
  await writeAudit(req, { action: req.params.id ? "ad.updated" : "ad.created", entityType: "Advertisement", entityId: data.publicId, after: { status: data.status, gymId: String(gym._id) } });
  res.status(req.params.id ? 200 : 201).json({ success: true, data: (await adsWithImages([data.toObject()]))[0] });
}
export const createAd = saveAd;
export const updateAd = saveAd;
async function adsWithImages(rows: any[]) {
  const files = await Attachment.find({ _id: { $in: rows.map(row => row.creativeAttachmentId).filter(Boolean) }, purpose: "AD", status: "READY", deletedAt: null }).lean();
  const byId = new Map(files.map(file => [String(file._id), file]));
  return rows.map(row => {
    const file = byId.get(String(row.creativeAttachmentId));
    return { ...row, imageUrl: file && String(file.gymId) === String(row.gymId?._id || row.gymId) ? attachmentUrl(file) : undefined };
  });
}
export async function publicOffers(req: Request, res: Response) {
  const gym = await Gym.findOne({ ...promotionGymFilter(String(req.query.gymId || "")), status: "ACTIVE", platformSubscriptionStatus: "ACTIVE", deletedAt: null }).lean();
  if (!gym) return res.json({ success: true, data: [] });
  const filter: any = { gymId: gym._id, ...activePromotionFilter(), $expr: { $or: [{ $eq: [{ $ifNull: ["$redemptionLimit", null] }, null] }, { $lt: [{ $ifNull: ["$redemptionCount", 0] }, "$redemptionLimit"] }] } };
  filter.$and = [gymOfferScopeFilter];
  if (req.query.planId) {
    const plan = await MembershipPlan.findOne({ ...promotionGymFilter(String(req.query.planId)), gymId: gym._id, status: "ACTIVE" }).lean();
    if (!plan) return res.json({ success: true, data: [] });
    filter.$or = [{ applicablePlanIds: { $size: 0 } }, { applicablePlanIds: { $exists: false } }, { applicablePlanIds: plan._id }];
    filter.minimumPurchaseMinor = { $not: { $gt: plan.priceMinor } };
  }
  const data = await Offer.find(filter).select("publicId name description code type discount terms startsAt endsAt minimumPurchaseMinor applicablePlanIds perUserLimit").sort({ endsAt: 1 }).limit(12).lean();
  res.json({ success: true, data: data.map(offer => ({ ...offer, code: offer.code || offer.publicId })) });
}
export async function publicAds(req: Request, res: Response) {
  const placement = String(req.query.placement || "");
  if (!["EXPLORE", "DASHBOARD", "GYM_PROFILE"].includes(placement)) throw new AppError(422, "INVALID_AD_PLACEMENT", "Choose a supported promotion placement.");
  // Historical ads predate placement targeting. Keep them discoverable only on
  // their own gym profile until the explicit migration records that default.
  const filter: any = {
    ...activePromotionFilter(),
    ...(placement === "GYM_PROFILE"
      ? { $or: [{ placements: placement }, { placements: { $exists: false } }, { placements: { $size: 0 } }] }
      : { placements: placement }),
  };
  if (req.query.gymId) {
    const gym = await Gym.findOne(promotionGymFilter(String(req.query.gymId))).select("_id").lean();
    if (!gym) return res.json({ success: true, data: [] });
    filter.gymId = gym._id;
  } else if (placement === "GYM_PROFILE") throw new AppError(422, "GYM_REQUIRED", "Select the gym whose promotions should be shown.");
  const pipeline: any[] = [
    { $match: filter },
    { $lookup: { from: Gym.collection.name, localField: "gymId", foreignField: "_id", as: "gym" } }, { $unwind: "$gym" },
    { $match: { "gym.status": "ACTIVE", "gym.platformSubscriptionStatus": "ACTIVE", "gym.deletedAt": null } },
  ];
  if (req.auth) pipeline.push({ $lookup: { from: MemberProfile.collection.name, let: { gym: "$gymId" }, pipeline: [
    { $match: { userId: new mongoose.Types.ObjectId(req.auth.userId), status: "ACTIVE", $expr: { $eq: ["$gymId", "$$gym"] } } }, { $limit: 1 }, { $project: { _id: 1 } },
  ], as: "viewerMembership" } });
  pipeline.push({ $match: { $or: [{ "audience.kind": "ALL" }, { audience: null }, ...(req.auth ? [{ "audience.kind": "GYM_MEMBERS", "viewerMembership.0": { $exists: true } }] : [])] } }, { $sort: { createdAt: -1, _id: -1 } }, { $limit: 6 });
  const rows = await adsWithImages(await Advertisement.aggregate(pipeline));
  const data = [];
  for (const ad of rows) {
    let href = `/gyms/${encodeURIComponent(ad.gym.slug)}`;
    if (ad.ctaTarget === "PLANS") href += "#gym-plans";
    if (ad.ctaTarget === "OFFER") {
      if (!await Offer.exists({ _id: ad.offerId, gymId: ad.gymId, ...activePromotionFilter(), $and: [gymOfferScopeFilter] })) continue;
      href += "#gym-offers";
    }
    if (ad.ctaTarget === "EXTERNAL") {
      try { const url = new URL(ad.ctaUrl); if (url.protocol !== "https:" || url.username || url.password) continue; href = url.href; } catch { continue; }
    }
    data.push({ publicId: ad.publicId, name: ad.name, description: ad.description, imageUrl: ad.imageUrl, gymName: ad.gym.name, ctaLabel: ad.ctaLabel || "View gym", href, external: ad.ctaTarget === "EXTERNAL", endsAt: ad.endsAt });
  }
  res.json({ success: true, data });
}
