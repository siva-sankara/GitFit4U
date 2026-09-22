import { Attachment } from "../models/Business.js";
import { presignedObjectUrl } from "../integrations/storage/s3ObjectStore.js";
import { AppError } from "../utils/AppError.js";

export async function validateGymMedia(
  gymId: string,
  ids: string[],
  coverId?: string | null,
) {
  const files = await Attachment.find({
    _id: { $in: ids },
    gymId,
    status: "READY",
    deletedAt: null,
    purpose: { $in: ["GYM_GALLERY", "GYM_COVER"] },
    mimeType: { $in: ["image/jpeg", "image/png", "image/webp", "video/mp4"] },
  }).lean();
  if (files.length !== ids.length)
    throw new AppError(
      422,
      "GYM_MEDIA_INVALID",
      "Choose completed photo or video uploads belonging to this gym.",
    );
  if (
    coverId &&
    !files.some(
      (f) => String(f._id) === coverId && f.mimeType.startsWith("image/"),
    )
  )
    throw new AppError(
      422,
      "GYM_COVER_INVALID",
      "The cover must be a photo in this gym's gallery.",
    );
}

// Persist attachment IDs, not expiring S3 URLs. Resolve fresh viewing links on every read.
export async function withGymMedia(gyms: any[]) {
  const ids = gyms.flatMap((g) => g.mediaAttachmentIds || []);
  const files = ids.length
    ? await Attachment.find({
        _id: { $in: ids },
        status: "READY",
        deletedAt: null,
      }).lean()
    : [];
  return gyms.map((gym) => {
    const media = (gym.mediaAttachmentIds || []).flatMap((id: any) => {
      const file = files.find(
        (f) =>
          String(f._id) === String(id) && String(f.gymId) === String(gym._id),
      );
      if (!file) return [];
      return [
        {
          _id: String(file._id),
          publicId: file.publicId,
          name: file.originalName,
          mimeType: file.mimeType,
          url: presignedObjectUrl("GET", file.objectKey, 3600),
        },
      ];
    });
    const cover =
      media.find((m: any) => m._id === String(gym.coverAttachmentId)) ||
      media.find((m: any) => m.mimeType.startsWith("image/"));
    return { ...gym, media, coverImageUrl: cover?.url || gym.coverImageUrl };
  });
}
