import { Attachment } from "../models/Business.js";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";
import { AppError } from "../utils/AppError.js";
import type { ClientSession } from "mongoose";
import { lockAttachments } from "./mediaBindingService.js";

export async function validateReviewImages(
  ids: string[],
  userId: string,
  session?: ClientSession,
) {
  if (!ids.length) return [];
  const query = Attachment.find({
    _id: { $in: ids },
    ownerId: userId,
    purpose: "REVIEW",
    storageProvider: "s3",
    status: "READY",
    deletedAt: null,
  });
  if (session) query.session(session);
  const files = await query.lean();
  if (
    files.length !== ids.length ||
    files.some(
      (file) =>
        !["image/jpeg", "image/png", "image/webp"].includes(file.mimeType),
    )
  )
    throw new AppError(
      422,
      "REVIEW_IMAGE_UNAVAILABLE",
      "Choose completed review image uploads belonging to this account.",
    );
  if (session) await lockAttachments(ids, session);
  return ids;
}

export async function withReviewMedia(rows: any[]) {
  const ids = rows.flatMap((row) => row.attachmentIds || []);
  const files = ids.length
    ? await Attachment.find({
        _id: { $in: ids },
        purpose: "REVIEW",
        status: "READY",
        deletedAt: null,
      }).lean()
    : [];
  const byId = new Map(files.map((file) => [String(file._id), file]));
  return rows.map((row) => ({
    ...row,
    images: (row.attachmentIds || [])
      .map((id: unknown) => byId.get(String(id)))
      .filter(
        (file: any) =>
          file &&
          String(file.ownerId) === String(row.userId?._id || row.userId),
      )
      .map((file: any) => ({
        id: String(file._id),
        url: attachmentUrl(file),
        thumbnailUrl: attachmentUrl(file, true),
      })),
  }));
}
