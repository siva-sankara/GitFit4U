import mongoose, { type PipelineStage } from "mongoose";
import { Follow } from "../models/Social.js";
import { User } from "../models/User.js";

function activeRelationshipStages(
  userId: string,
  incoming: boolean,
): PipelineStage[] {
  return [
    {
      $match: {
        [incoming ? "followingId" : "followerId"]: new mongoose.Types.ObjectId(
          userId,
        ),
      },
    },
    {
      $lookup: {
        from: User.collection.name,
        localField: incoming ? "followerId" : "followingId",
        foreignField: "_id",
        pipeline: [
          { $match: { status: "ACTIVE" } },
          {
            $project: {
              _id: 1,
              publicId: 1,
              name: 1,
              avatarUrl: 1,
              avatarAttachmentId: 1,
            },
          },
        ],
        as: "person",
      },
    },
    { $unwind: "$person" },
  ];
}

export async function countActiveRelationships(
  userId: string,
  incoming: boolean,
) {
  const [result] = await Follow.aggregate([
    ...activeRelationshipStages(userId, incoming),
    { $count: "total" },
  ]);
  return result?.total || 0;
}

export async function activeRelationshipsPage(
  userId: string,
  incoming: boolean,
  skip: number,
  limit: number,
) {
  // Join/filter BEFORE pagination. A single facet gives rows and count the same input.
  const [result] = await Follow.aggregate([
    ...activeRelationshipStages(userId, incoming),
    {
      $facet: {
        rows: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: skip },
          { $limit: limit },
          { $replaceWith: "$person" },
        ],
        count: [{ $count: "total" }],
      },
    },
  ]);
  return { users: result?.rows || [], total: result?.count[0]?.total || 0 };
}

export async function cleanupOrphanedFollows({
  after,
  limit = 100,
}: { after?: string; limit?: number } = {}) {
  // Bounded keyset walk: do not scan the entire collection on every maintenance tick.
  // Temporary suspensions retain their relationships; only absent users are orphaned.
  const size = Math.max(1, Math.min(Math.floor(limit), 500));
  const rows = await Follow.find(
    after ? { _id: { $gt: new mongoose.Types.ObjectId(after) } } : {},
  )
    .sort({ _id: 1 })
    .limit(size)
    .select("_id followerId followingId")
    .lean();
  if (!rows.length) return { scanned: 0, removed: 0, nextCursor: undefined };
  const ids = rows.flatMap((row) => [row.followerId, row.followingId]);
  const existing = new Set(
    (
      await User.find({ _id: { $in: ids } })
        .select("_id")
        .lean()
    ).map((user) => String(user._id)),
  );
  const orphanIds = rows
    .filter(
      (row) =>
        !existing.has(String(row.followerId)) ||
        !existing.has(String(row.followingId)),
    )
    .map((row) => row._id);
  const removed = orphanIds.length
    ? (await Follow.deleteMany({ _id: { $in: orphanIds } })).deletedCount
    : 0;
  return {
    scanned: rows.length,
    removed,
    nextCursor: rows.length === size ? String(rows.at(-1)!._id) : undefined,
  };
}
