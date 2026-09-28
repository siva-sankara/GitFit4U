import mongoose, { type ClientSession } from "mongoose";
import { Attachment } from "../models/Business.js";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";
import { AppError } from "../utils/AppError.js";
import { lockAttachments } from "./mediaBindingService.js";

export async function validatedImageAttachment(
  id: unknown,
  ownerId: string,
  purpose: string,
  gymId?: string,
  session?: ClientSession,
) {
  if (!mongoose.isValidObjectId(id))
    throw new AppError(
      422,
      "IMAGE_REFERENCE_INVALID",
      "Upload an image before saving it.",
    );
  const file = await Attachment.findOne({
    _id: id,
    ownerId,
    purpose,
    status: "READY",
    deletedAt: null,
    storageProvider: "s3",
    ...(gymId ? { gymId } : {}),
  })
    .session(session || null)
    .lean();
  if (
    !file ||
    !["image/jpeg", "image/png", "image/webp"].includes(file.mimeType)
  )
    throw new AppError(
      422,
      "IMAGE_UNAVAILABLE",
      "Choose a completed S3 image upload belonging to this account.",
    );
  if (session) await lockAttachments([id], session);
  return file;
}
function legacyThumbnail(url?: string) {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname.endsWith(".googleusercontent.com"))
      return url.replace(/=s\d+(-c)?$/, "") + "=s160-c";
  } catch {
    /* A legacy URL without a supported thumbnail is not used in small avatars. */
  }
  return undefined;
}
async function resolve(
  rows: any[],
  field: "avatarAttachmentId" | "photoAttachmentId",
  purpose: string,
) {
  const ids = rows
    .filter(Boolean)
    .map((row) => row[field])
    .filter(Boolean);
  const files = ids.length
    ? await Attachment.find({
        _id: { $in: ids },
        purpose,
        status: "READY",
        deletedAt: null,
      }).lean()
    : [];
  return rows.map((row) => {
    if (!row) return row;
    const file = files.find((file) => String(file._id) === String(row[field]));
    const url = file
      ? attachmentUrl(file)
      : row[field]
        ? undefined
        : row.avatarUrl || row.photoUrl;
    const thumbnail =
      file && (file.thumbnailObjectKey || file.storageProvider === "cloudinary")
        ? attachmentUrl(file, true)
        : legacyThumbnail(url);
    return {
      ...row,
      avatarUrl: url,
      avatarThumbnailUrl: thumbnail,
      ...(field === "photoAttachmentId"
        ? { photoUrl: url, photoThumbnailUrl: thumbnail }
        : {}),
    };
  });
}
export const withUserMedia = (users: any[]) =>
  resolve(users, "avatarAttachmentId", "AVATAR");
/** Tenant-owned recognition photos never replace the member's account avatar. */
export async function withMemberMedia(members: any[]) {
  const users = await withUserMedia(members.flatMap((member) => member?.userId && typeof member.userId === "object" && member.userId.name ? [member.userId] : []));
  const ids = members.flatMap((member) => member?.contact?.avatarAttachmentId ? [member.contact.avatarAttachmentId] : []);
  const files = ids.length ? await Attachment.find({
    _id: { $in: ids }, purpose: "MEMBER_AVATAR", status: "READY", deletedAt: null,
  }).lean() : [];
  return members.map((member) => {
    if (!member) return member;
    const contact = member.contact || {};
    const file = files.find((candidate) => String(candidate._id) === String(contact.avatarAttachmentId)
      && String(candidate.gymId) === String(member.gymId?._id || member.gymId));
    const url = file ? attachmentUrl(file) : contact.avatarAttachmentId ? undefined : contact.avatarUrl;
    return { ...member, userId: users.find((user) => String(user._id) === String(member.userId?._id)) || member.userId, contact: { ...contact, avatarUrl: url,
      avatarThumbnailUrl: file?.thumbnailObjectKey ? attachmentUrl(file, true) : legacyThumbnail(url),
    } };
  });
}
export async function withTrainerMedia(trainers: any[]) {
  const resolved = await resolve(
    trainers,
    "photoAttachmentId",
    "TRAINER_IMAGE",
  );
  const users = await withUserMedia(
    trainers
      .map((trainer) => trainer?.userId)
      .filter((user) => user && typeof user === "object" && user.name),
  );
  return resolved.map((trainer) => {
    if (!trainer) return trainer;
    const user = users.find(
      (user) => String(user._id) === String(trainer.userId?._id),
    );
    return {
      ...trainer,
      ...(user
        ? {
            userId: user,
            phone: trainer.phone || user.phone,
            email: trainer.email || user.email,
          }
        : {}),
      ...(!trainer.photoAttachmentId && !trainer.photoUrl && user
        ? {
            photoUrl: user.avatarUrl,
            photoThumbnailUrl: user.avatarThumbnailUrl,
            avatarUrl: user.avatarUrl,
            avatarThumbnailUrl: user.avatarThumbnailUrl,
          }
        : {}),
    };
  });
}
