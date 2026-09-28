import mongoose from "mongoose";
import { Attachment } from "../models/Business.js";
import { ClassSession } from "../models/Engagement.js";
import { deleteMedia } from "../integrations/storage/mediaStore.js";
import { logger } from "../config/logger.js";

export const CLASS_MEDIA_RETENTION_MS = 24 * 3600_000;
const retryDelayMs = 5 * 60_000;
export function classMediaCleanupFilter(now: Date) {
  return { purpose: "CLASS_IMAGE", storageProvider: "s3", deletedAt: null, $or: [
    { status: { $in: ["PENDING", "READY", "REJECTED"] }, updatedAt: { $lte: new Date(now.getTime() - CLASS_MEDIA_RETENTION_MS) } },
    { status: "DELETING", updatedAt: { $lte: new Date(now.getTime() - retryDelayMs) } },
  ] };
}

/** Claim the same row written by lockAttachments before checking references. */
export async function claimUnusedClassImage(id: unknown, now: Date) {
  return mongoose.connection.transaction(async (session) => {
    const previous = await Attachment.findOneAndUpdate({ _id: id, ...classMediaCleanupFilter(now) },
      { $set: { status: "DELETING", updatedAt: now }, $inc: { bindingVersion: 1 } },
      { session, returnDocument: "before", timestamps: false });
    if (!previous) return null;
    const prefix = `gyms/${previous.gymId}/class_image/${previous.publicId}.`;
    const safeKey = ["jpg", "png", "webp"].some(extension => previous.objectKey === prefix + extension) &&
      (!previous.thumbnailObjectKey || previous.thumbnailObjectKey === `${previous.objectKey}.thumb.webp`);
    if (!safeKey || await ClassSession.exists({ imageAttachmentId: previous._id }).session(session)) {
      // Referenced rows are reconsidered after another retention window so a
      // long-lived class cannot starve later orphan candidates in bounded scans.
      await Attachment.updateOne({ _id: previous._id, status: "DELETING" },
        { $set: { status: previous.status === "DELETING" ? "READY" : previous.status, updatedAt: now } }, { session, timestamps: false });
      return null;
    }
    return previous.toObject();
  });
}

/** Bounded, retryable S3 cleanup; history and every other media purpose are retained. */
export async function cleanupUnusedClassImages({ now = new Date(), limit = 20 }: { now?: Date; limit?: number } = {}) {
  const rows = await Attachment.find(classMediaCleanupFilter(now)).select("_id").sort({ updatedAt: 1, _id: 1 }).limit(Math.max(1, Math.min(50, limit))).lean();
  let removed = 0;
  for (const row of rows) {
    try {
      const claimed = await claimUnusedClassImage(row._id, now);
      if (!claimed) continue;
      // Storage work is outside the transaction; partial deletion can safely retry.
      await deleteMedia(claimed);
      const result = await Attachment.updateOne({ _id: row._id, purpose: "CLASS_IMAGE", storageProvider: "s3", status: "DELETING", deletedAt: null },
        { $set: { status: "DELETED", deletedAt: now } });
      removed += result.modifiedCount;
    } catch {
      logger.warn({ event: "class.media.cleanup.retry", attachmentId: String(row._id) }, "Class image cleanup deferred");
    }
  }
  return { checked: rows.length, removed };
}
