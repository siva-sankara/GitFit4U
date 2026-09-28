import mongoose from "mongoose";
import { env } from "../config/env.js";
import {
  Follow,
  ProfileContactChange,
  SocialPost,
  SocialStory,
} from "../models/Social.js";
import { StreakProjection, AttendanceEvent } from "../models/Attendance.js";
import { Attachment } from "../models/Business.js";
import { User } from "../models/User.js";

// Dry-run by default. No user/content/media records or provider objects are deleted.
const apply = process.argv.includes("--apply");
try {
  await mongoose.connect(env.MONGO_URI, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 10000,
  });
  const indexes = await StreakProjection.collection
    .listIndexes()
    .toArray()
    .catch((error: any) => {
      if (error.code === 26) return [];
      throw error;
    });
  const legacy = indexes.find(
    (index: any) =>
      index.unique === true &&
      Object.keys(index.key).length === 2 &&
      index.key.gymId === 1 &&
      index.key.memberProfileId === 1 &&
      !index.partialFilterExpression,
  );
  const legacyMedia = await Attachment.countDocuments({
    storageProvider: "cloudinary",
    status: "READY",
  });
  const conflicts: string[] = [];
  for (const [label, model, match, group] of [
    [
      "duplicate global streak users",
      StreakProjection,
      { scope: "USER" },
      { userId: "$userId" },
    ],
    [
      "duplicate gym/member streaks",
      StreakProjection,
      { gymId: { $type: "objectId" }, memberProfileId: { $type: "objectId" } },
      { gymId: "$gymId", memberProfileId: "$memberProfileId" },
    ],
    [
      "duplicate follow relationships",
      Follow,
      {},
      { followerId: "$followerId", followingId: "$followingId" },
    ],
  ] as const) {
    const duplicates = await model.aggregate([
      { $match: match },
      { $group: { _id: group, count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ]);
    if (duplicates.length) conflicts.push(label);
  }
  if (apply && conflicts.length)
    throw new Error(
      "SOCIAL_INDEX_CONFLICTS: Resolve duplicate records before applying indexes; no index was changed.",
    );
  if (apply) {
    if (legacy?.name) await StreakProjection.collection.dropIndex(legacy.name);
    for (const model of [
      StreakProjection,
      AttendanceEvent,
      Follow,
      SocialPost,
      SocialStory,
      ProfileContactChange,
      User,
    ])
      await model.createIndexes();
  }
  console.log(
    JSON.stringify({
      mode: apply ? "applied" : "dry-run",
      replaceLegacyStreakIndex: Boolean(legacy),
      safeToApply: conflicts.length === 0,
      conflicts,
      legacyCloudinaryAssetsPreserved: legacyMedia,
      mediaObjectsModified: 0,
      note: "Run with --apply during a maintenance window before enabling social profiles.",
    }),
  );
} catch (error: any) {
  console.error(
    JSON.stringify({
      error: "SOCIAL_MEDIA_MIGRATION_FAILED",
      reason: error.message?.startsWith("SOCIAL_INDEX_CONFLICTS")
        ? error.message
        : undefined,
      code: typeof error.code === "number" ? error.code : undefined,
    }),
  );
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
