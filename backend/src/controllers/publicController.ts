import type { Request, Response } from "express";
import { z } from "zod";
import { Gym } from "../models/Gym.js";
import { withGymMedia } from "../services/gymMediaService.js";
import { MembershipPlan } from "../models/Commerce.js";
import { ClassSession, Review, Trainer } from "../models/Engagement.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import { AppError } from "../utils/AppError.js";
export const publicEligibility = {
  status: "ACTIVE",
  platformSubscriptionStatus: "ACTIVE",
};
const fields =
  "publicId name slug logoUrl logoAttachmentId coverImageUrl mediaAttachmentIds coverAttachmentId facilities address location rating startingPriceMinor currency openingHours timezone";
function literal(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function filters(req: Request) {
  const filter: Record<string, any> = { ...publicEligibility };
  const q =
    typeof req.query.q === "string" ? req.query.q.trim().slice(0, 80) : "";
  if (q)
    filter.$or = ["name", "address.city", "address.locality"].map((field) => ({
      [field]: new RegExp(literal(q), "i"),
    }));
  if (typeof req.query.city === "string" && req.query.city)
    filter["address.city"] = new RegExp(
      `^${literal(req.query.city.slice(0, 80))}$`,
      "i",
    );
  if (typeof req.query.facility === "string" && req.query.facility)
    filter.facilities = new RegExp(
      literal(req.query.facility.slice(0, 80)),
      "i",
    );
  if (req.query.rating)
    filter["rating.average"] = {
      $gte: z.coerce.number().min(0).max(5).parse(req.query.rating),
    };
  if (req.query.maxPrice)
    filter.startingPriceMinor = {
      $lte: z.coerce.number().int().nonnegative().parse(req.query.maxPrice),
    };
  return filter;
}
export async function listGyms(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query),
    filter = filters(req);
  const [data, total] = await Promise.all([
    Gym.find(filter)
      .select(fields)
      .sort({ "rating.average": -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Gym.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: await withGymMedia(data),
    meta: pageMeta(page, limit, total),
  });
}
export async function nearbyGyms(req: Request, res: Response) {
  const longitude = z.coerce.number().min(-180).max(180).parse(req.query.lng),
    latitude = z.coerce.number().min(-90).max(90).parse(req.query.lat),
    distanceKm = z.coerce
      .number()
      .min(1)
      .max(50)
      .parse(req.query.distanceKm || 10),
    { page, limit, skip } = paginationFromQuery(req.query);
  const result = await Gym.aggregate([
    {
      $geoNear: {
        near: { type: "Point", coordinates: [longitude, latitude] },
        distanceField: "distanceMeters",
        maxDistance: distanceKm * 1000,
        spherical: true,
        query: filters(req),
      },
    },
    {
      $facet: {
        rows: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: Object.fromEntries(
              [...fields.split(" "), "distanceMeters"].map((k) => [k, 1]),
            ),
          },
        ],
        count: [{ $count: "total" }],
      },
    },
  ]);
  res.json({
    success: true,
    data: await withGymMedia(result[0]?.rows || []),
    meta: pageMeta(page, limit, result[0]?.count[0]?.total || 0),
  });
}
export async function gymDetails(req: Request, res: Response) {
  const gym = await Gym.findOne({
    slug: req.params.slug,
    ...publicEligibility,
  }).lean();
  if (!gym)
    throw new AppError(404, "GYM_NOT_FOUND", "This gym is not available.");
  const [plans, classes, trainers, reviews] = await Promise.all([
    MembershipPlan.find({ gymId: gym._id, status: "ACTIVE" })
      .sort({ priceMinor: 1 })
      .lean(),
    ClassSession.find({
      gymId: gym._id,
      status: "SCHEDULED",
      startsAt: { $gte: new Date() },
    })
      .sort({ startsAt: 1 })
      .limit(100)
      .lean(),
    Trainer.find({ gymId: gym._id, status: "ACTIVE" })
      .select("publicId name photoUrl qualifications specializations bio")
      .limit(100)
      .lean(),
    Review.find({ gymId: gym._id, status: "PUBLISHED" })
      .select(
        "publicId userId rating title body createdAt editedAt ownerResponse",
      )
      .populate("userId", "name avatarUrl")
      .sort({ createdAt: -1 })
      .limit(100)
      .lean(),
  ]);
  res.json({
    success: true,
    data: {
      gym: (await withGymMedia([gym]))[0],
      plans,
      classes,
      trainers,
      reviews,
    },
  });
}

export async function gymReviews(req: Request, res: Response) {
  const gym = await Gym.findOne({
    slug: req.params.slug,
    ...publicEligibility,
  }).select("_id");
  if (!gym)
    throw new AppError(404, "GYM_NOT_FOUND", "This gym is not available.");
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { gymId: gym._id, status: "PUBLISHED" };
  const [data, total, distribution] = await Promise.all([
    Review.find(filter)
      .select(
        "publicId userId rating title body createdAt editedAt ownerResponse",
      )
      .populate("userId", "name avatarUrl")
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Review.countDocuments(filter),
    Review.aggregate([
      { $match: filter },
      { $group: { _id: "$rating", count: { $sum: 1 } } },
    ]),
  ]);
  res.json({
    success: true,
    data,
    meta: {
      ...pageMeta(page, limit, total),
      distribution: Object.fromEntries(
        distribution.map((row: any) => [String(row._id), row.count]),
      ),
    },
  });
}
