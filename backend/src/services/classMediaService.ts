import { Attachment } from "../models/Business.js";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";

/** Resolve only completed images bound to the same gym; legacy URLs remain readable. */
export async function withClassMedia(rows: any[]) {
  const ids = rows.flatMap((row) => row?.imageAttachmentId ? [row.imageAttachmentId] : []);
  const files = ids.length ? await Attachment.find({
    _id: { $in: ids }, purpose: "CLASS_IMAGE", status: "READY", deletedAt: null,
  }).lean() : [];
  return rows.map((row) => {
    if (!row) return row;
    const file = files.find((file) => String(file._id) === String(row.imageAttachmentId)
      && String(file.gymId) === String(row.gymId?._id || row.gymId));
    return { ...row, imageUrl: file ? attachmentUrl(file) : row.imageAttachmentId ? undefined : row.imageUrl,
      imageThumbnailUrl: file?.thumbnailObjectKey ? attachmentUrl(file, true) : undefined };
  });
}
