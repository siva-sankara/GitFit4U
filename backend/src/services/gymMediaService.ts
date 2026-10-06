import { Attachment } from "../models/Business.js";
import type { ClientSession } from "mongoose";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";
import { AppError } from "../utils/AppError.js";

export async function validateGymMedia(
  gymId: string,
  ids: string[],
  coverId?: string | null,
  session?: ClientSession,
) {
  const query = Attachment.find({
    _id: { $in: ids },
    gymId,
    status: "READY",
    deletedAt: null,
    purpose: { $in: ["GYM_GALLERY", "GYM_COVER"] },
    mimeType: { $in: ["image/jpeg", "image/png", "image/webp", "video/mp4"] },
  });
  if (session) query.session(session);
  const files = await query.lean();
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
export async function validateGymLogo(gymId: string, id?: string | null, session?: ClientSession) {
  if (!id) return;
  const query = Attachment.exists({
      _id: id,
      gymId,
      purpose: "GYM_LOGO",
      status: "READY",
      deletedAt: null,
      mimeType: { $in: ["image/jpeg", "image/png", "image/webp"] },
      size: { $lte: 5_000_000 },
    });
  if (session) query.session(session);
  if (!(await query))
    throw new AppError(
      422,
      "GYM_LOGO_INVALID",
      "Choose a completed logo upload belonging to this gym.",
    );
}
export async function withGymMedia(gyms: any[], options: { mediaLimit?: number } = {}) {
  const mediaIds = (gym: any) => (gym.mediaAttachmentIds || []).slice(0, options.mediaLimit);
  const ids = gyms.flatMap((g) => [
    ...mediaIds(g),
    ...(g.logoAttachmentId ? [g.logoAttachmentId] : []),
  ]);
  const files = ids.length
    ? await Attachment.find({
        _id: { $in: ids },
        status: "READY",
        deletedAt: null,
      }).lean()
    : [];
  return gyms.map((gym) => {
    const media = mediaIds(gym).flatMap((id: any) => {
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
          url: attachmentUrl(file),
          thumbnailUrl: file.thumbnailObjectKey
            ? attachmentUrl(file, true)
            : attachmentUrl(file),
          caption:
            gym.mediaCaptions?.get?.(String(file._id)) ||
            gym.mediaCaptions?.[String(file._id)] ||
            "",
        },
      ];
    });
    const cover =
      media.find((m: any) => m._id === String(gym.coverAttachmentId)) ||
      media.find((m: any) => m.mimeType.startsWith("image/"));
    const logo = files.find(
      (f) =>
        String(f._id) === String(gym.logoAttachmentId) &&
        String(f.gymId) === String(gym._id) &&
        f.purpose === "GYM_LOGO",
    );
    return {
      ...gym,
      media,
      mediaCount: (gym.mediaAttachmentIds || []).length,
      coverImageUrl: cover?.url || gym.coverImageUrl,
      logoUrl: logo
        ? attachmentUrl(logo)
        : gym.logoAttachmentId === null
          ? null
          : gym.logoUrl,
      logo: logo
        ? {
            url: attachmentUrl(logo),
            publicId: logo.providerPublicId || logo.publicId,
            attachmentId: String(logo._id),
            width: logo.width,
            height: logo.height,
          }
        : null,
    };
  });
}
