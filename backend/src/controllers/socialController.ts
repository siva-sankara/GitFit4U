import type { Request, Response } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { z } from "zod";
import { User } from "../models/User.js";
import { Follow, SocialPost, SocialStory } from "../models/Social.js";
import { Attachment } from "../models/Business.js";
import { AppError } from "../utils/AppError.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";
import {
  validatedImageAttachment,
  withUserMedia,
} from "../services/userMediaService.js";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";
import { globalStreak, storyExpiry } from "../services/socialService.js";
import {
  activeRelationshipsPage,
  countActiveRelationships,
} from "../services/socialRelationshipService.js";
const publicFields =
  "_id publicId name avatarUrl avatarAttachmentId social status";
const imageId = z.string().regex(/^[a-fA-F0-9]{24}$/);
export const socialContentInput = z
  .object({
    text: z.string().trim().max(3000).default(""),
    attachmentIds: z.array(imageId).max(4).default([]),
  })
  .strict()
  .refine(
    (value) => Boolean(value.text || value.attachmentIds.length),
    "Add text or an image.",
  );
export function canReadSocialProfile(
  user: any,
  viewerId: string,
  admin = false,
) {
  return (
    String(user._id) === viewerId ||
    admin ||
    user.social?.visibility === "PUBLIC"
  );
}
function moderator(req: Request) {
  return (
    req.auth!.role === "ADMIN" &&
    req.auth!.permissions.includes("admin:platform")
  );
}
function identity(user: any) {
  return {
    publicId: user.publicId,
    name: user.name,
    avatarUrl: user.avatarUrl,
    avatarThumbnailUrl: user.avatarThumbnailUrl,
  };
}
async function target(req: Request, enforce = false) {
  const user = await User.findOne({
    ...(req.params.id === "me"
      ? { _id: req.auth!.userId }
      : { publicId: String(req.params.id) }),
    status: "ACTIVE",
  })
    .select(publicFields)
    .lean();
  if (!user) throw new AppError(404, "PROFILE_NOT_FOUND", "Profile not found.");
  if (enforce && !canReadSocialProfile(user, req.auth!.userId, moderator(req)))
    throw new AppError(
      403,
      "PROFILE_PRIVATE",
      "This member's profile is private.",
    );
  return user;
}
export async function searchProfiles(req: Request, res: Response) {
  const { page, limit, skip } = paginationFromQuery(req.query);
  const q = z.string().trim().max(80).default("").parse(req.query.q);
  const filter = {
    status: "ACTIVE",
    "social.visibility": "PUBLIC",
    ...(q
      ? {
          name: {
            $regex: q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            $options: "i",
          },
        }
      : {}),
  };
  const [rows, total] = await Promise.all([
    User.find(filter)
      .select(publicFields)
      .sort({ name: 1, _id: 1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    User.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: (await withUserMedia(rows)).map(identity),
    meta: pageMeta(page, limit, total),
  });
}
export async function profile(req: Request, res: Response) {
  const user = await target(req),
    own = String(user._id) === req.auth!.userId;
  const canView = canReadSocialProfile(user, req.auth!.userId, moderator(req));
  const [resolved] = await withUserMedia([user]);
  const [followers, following, posts, follows, streak] = canView
    ? await Promise.all([
        countActiveRelationships(String(user._id), true),
        countActiveRelationships(String(user._id), false),
        SocialPost.countDocuments({ authorId: user._id, deletedAt: null }),
        Follow.exists({ followerId: req.auth!.userId, followingId: user._id }),
        globalStreak(String(user._id), user.social?.timezone || "Asia/Kolkata"),
      ])
    : [
        undefined,
        undefined,
        undefined,
        await Follow.exists({
          followerId: req.auth!.userId,
          followingId: user._id,
        }),
        undefined,
      ];
  res.json({
    success: true,
    data: {
      ...identity(resolved),
      own,
      canView,
      canModerate: moderator(req),
      following: Boolean(follows),
      social: canView ? user.social : { visibility: "PRIVATE" },
      counts: { followers, following, posts },
      streak: streak
        ? {
            currentStreak: streak.currentStreak,
            longestStreak: streak.longestStreak,
            lastAttendanceDate: streak.lastAttendanceDate,
            totalVisits: streak.totalVisits,
            timezone: streak.timezone,
          }
        : undefined,
    },
  });
}
export async function follow(req: Request, res: Response) {
  if (req.method === "DELETE") {
    // Removing a relationship must remain possible after suspension/privacy changes.
    const user = await User.findOne({ publicId: String(req.params.id) })
      .select("_id")
      .lean();
    if (user)
      await Follow.deleteOne({
        followerId: req.auth!.userId,
        followingId: user._id,
      });
    res.json({ success: true, data: { following: false } });
    return;
  }
  const user = await target(req);
  if (String(user._id) === req.auth!.userId)
    throw new AppError(422, "SELF_FOLLOW", "You cannot follow yourself.");
  const filter = { followerId: req.auth!.userId, followingId: user._id };
  if (user.social?.visibility !== "PUBLIC")
    throw new AppError(
      403,
      "PROFILE_PRIVATE",
      "This member is not accepting follows.",
    );
  try {
    await Follow.updateOne(
      filter,
      { $setOnInsert: filter },
      { upsert: true, runValidators: true },
    );
  } catch (error: any) {
    if (error.code !== 11000 || !(await Follow.exists(filter))) throw error;
  }
  res.json({ success: true, data: { following: true } });
}
export async function relationships(req: Request, res: Response) {
  const user = await target(req, true),
    incoming = req.params.kind === "followers";
  const { page, limit, skip } = paginationFromQuery(req.query);
  const { users, total } = await activeRelationshipsPage(
    String(user._id),
    incoming,
    skip,
    limit,
  );
  res.json({
    success: true,
    data: (await withUserMedia(users)).map(identity),
    meta: pageMeta(page, limit, total),
  });
}
async function contentRows(rows: any[], author: any) {
  const ids = rows.flatMap((row) => row.attachmentIds || []);
  const files = ids.length
    ? await Attachment.find({
        _id: { $in: ids },
        ownerId: author._id,
        status: "READY",
        deletedAt: null,
      }).lean()
    : [];
  const [person] = await withUserMedia([author]);
  return rows.map((row) => ({
    publicId: row.publicId,
    text: row.text,
    createdAt: row.createdAt,
    editedAt: row.editedAt,
    expiresAt: row.expiresAt,
    author: identity(person),
    attachmentIds: row.attachmentIds,
    images: (row.attachmentIds || [])
      .map((id: any) => files.find((file) => String(file._id) === String(id)))
      .filter(Boolean)
      .map((file: any) => ({
        id: String(file._id),
        url: attachmentUrl(file),
        thumbnailUrl: file.thumbnailObjectKey
          ? attachmentUrl(file, true)
          : undefined,
      })),
  }));
}
export async function listContent(req: Request, res: Response) {
  const user = await target(req, true),
    stories = req.params.kind === "stories",
    model = stories ? SocialStory : SocialPost;
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = {
    authorId: user._id,
    deletedAt: null,
    ...(stories ? { expiresAt: { $gt: new Date() }, archivedAt: null } : {}),
  };
  const [rows, total] = await Promise.all([
    model
      .find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    model.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data: await contentRows(rows, user),
    meta: pageMeta(page, limit, total),
  });
}
export async function saveContent(req: Request, res: Response) {
  const stories = req.params.kind === "stories",
    model = stories ? SocialStory : SocialPost;
  const own = req.auth!.userId,
    body = socialContentInput.parse(req.body);
  if (stories && body.attachmentIds.length > 1)
    throw new AppError(422, "STORY_IMAGE_LIMIT", "Choose one image per story.");
  const editing = req.method === "PATCH";
  const save = async (session?: ClientSession) => {
  const recordQuery = editing ? model.findOne({
    publicId: req.params.contentId,
    authorId: own,
    deletedAt: null,
    ...(stories ? { expiresAt: { $gt: new Date() } } : {}),
  }) : null;
  if (session && recordQuery) recordQuery.session(session);
  const record = editing
    ? await recordQuery
    : null;
  if (editing && !record)
    throw new AppError(
      404,
      "CONTENT_NOT_FOUND",
      "Content was not found or cannot be edited.",
    );
  for (const id of body.attachmentIds)
    await validatedImageAttachment(
      id,
      own,
      stories ? "STORY_IMAGE" : "POST_IMAGE",
      undefined,
      session,
    );
  const now = new Date();
  if (record) {
    record.text = body.text;
    record.attachmentIds = body.attachmentIds;
    record.editedAt = now;
    await record.save(session ? { session } : undefined);
  }
  if (record) return record;
  const input = {
      ...body,
      publicId: nanoid(20),
      authorId: own,
      createdAt: now,
      ...(stories ? { expiresAt: storyExpiry(now) } : {}),
    };
  return session ? (await model.create([input], { session }))[0] : await model.create(input);
  };
  const data = body.attachmentIds.length
    ? await mongoose.connection.transaction((session) => save(session))
    : await save();
  res
    .status(editing ? 200 : 201)
    .json({ success: true, data: { publicId: data.publicId } });
}
export async function deleteContent(req: Request, res: Response) {
  const model = req.params.kind === "stories" ? SocialStory : SocialPost;
  const data = await model.findOneAndUpdate(
    {
      publicId: req.params.contentId,
      deletedAt: null,
      ...(!moderator(req) ? { authorId: req.auth!.userId } : {}),
    },
    { $set: { deletedAt: new Date(), deletedBy: req.auth!.userId } },
  );
  if (!data) throw new AppError(404, "CONTENT_NOT_FOUND", "Content not found.");
  res.status(204).send();
}
