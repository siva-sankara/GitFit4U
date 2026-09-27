import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Offer, Advertisement } from "../models/Business.js";
import { Payment } from "../models/Commerce.js";
// Dry-run is the default. This migration never creates campaigns or modifies payment amounts.
const apply = process.argv.includes("--apply");
try {
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  const duplicateCodes = await Offer.aggregate([{ $match: { code: { $type: "string" } } }, { $group: { _id: { gymId: "$gymId", code: { $toUpper: "$code" } }, count: { $sum: 1 } } }, { $match: { count: { $gt: 1 } } }, { $limit: 1 }]);
  const legacyAds = await Advertisement.countDocuments({ placements: { $exists: false } });
  const invalidOffers = await Offer.countDocuments({ $or: [{ gymId: { $exists: false } }, { discount: null }] });
  if (duplicateCodes.length) throw new Error("PROMOTION_CODE_CONFLICT: Resolve duplicate gym offer codes before creating indexes; no records were changed.");
  if (apply) {
    await Offer.updateMany({ code: { $type: "string" } }, [{ $set: { code: { $toUpper: "$code" } } }]);
    await Advertisement.updateMany({ placements: { $exists: false } }, { $set: { placements: ["GYM_PROFILE"] } });
    // Historical audience configuration is deliberately preserved, never widened.
    for (const model of [Offer, Advertisement, Payment]) await model.createIndexes();
  }
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", safeToApply: true, legacyAdsNeedingPlacement: legacyAds, offersNeedingReview: invalidOffers, duplicateOfferCodes: 0, note: "Existing campaigns retain status, dates, targeting and values. Legacy offer publicId remains a valid checkout code. Payment amounts and media objects are unchanged." }));
} catch (error) {
  console.error(error instanceof Error ? error.message.replace(/mongodb(?:\+srv)?:\/\/[^\s]+/gi, "[database]") : "Promotion migration failed.");
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
