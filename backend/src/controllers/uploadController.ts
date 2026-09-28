import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import mongoose, { type ClientSession } from "mongoose";
import { Attachment, Advertisement, Invoice } from "../models/Business.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { presignedObjectUrl } from "../integrations/storage/s3ObjectStore.js";
import { AppError } from "../utils/AppError.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { Trainer, Review, ClassSession } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { assertTenantMediaAccess } from "../services/mediaAccessService.js";
import { SocialPost, SocialStory } from "../models/Social.js";
import { Message } from "../models/Collaboration.js";
import {
  attachmentUrl,
  deleteMedia,
  storageProvider,
  uploadMediaBytes,
  verifyMediaConfiguration,
} from "../integrations/storage/mediaStore.js";
import {
  validateMediaBytes,
  validateMediaName,
} from "../services/mediaValidation.js";
const extensions: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
};
async function editableRegistration(
  id: unknown,
  ownerId: string,
  publicId = false,
  session?: ClientSession,
) {
  const registration = await GymRegistration.findOne({
    [publicId ? "publicId" : "_id"]: id,
    ownerId,
  }).session(session || null);
  if (!registration)
    throw new AppError(
      404,
      "REGISTRATION_NOT_FOUND",
      "Registration not found.",
    );
  return registration;
}
export async function initiate(req: Request, res: Response) {
  validateMediaName(req.body.name, req.body.mimeType);
  verifyMediaConfiguration();
  if (req.body.gymId && req.auth!.role !== "ADMIN")
    throw new AppError(
      403,
      "TENANT_MEDIA_FORBIDDEN",
      "Gym media scope is derived from your authenticated workspace.",
    );
  const selectedGymId =
    req.auth!.role === "ADMIN" ? req.body.gymId : req.auth!.gymId;
  await assertTenantMediaAccess(req, req.body.purpose, selectedGymId);
  if (
    [
      "AVATAR",
      "MEMBER_AVATAR",
      "TRAINER_IMAGE",
      "CLASS_IMAGE",
      "POST_IMAGE",
      "STORY_IMAGE",
      "REVIEW",
      "AD",
    ].includes(req.body.purpose) &&
    !req.body.mimeType.startsWith("image/")
  )
    throw new AppError(
      422,
      "IMAGE_REQUIRED",
      "Choose a JPG, PNG or WebP image.",
    );
  if (["GYM_GALLERY", "GYM_COVER", "GYM_LOGO"].includes(req.body.purpose)) {
    if (
      !req.body.mimeType.startsWith("image/") &&
      !(req.body.purpose === "GYM_GALLERY" && req.body.mimeType === "video/mp4")
    )
      throw new AppError(
        422,
        "FILE_TYPE_NOT_ALLOWED",
        "Choose a gym photo or an MP4 gallery video.",
      );
  }
  if (req.body.registrationId)
    throw new AppError(
      410,
      "REGISTRATION_DOCUMENTS_REMOVED",
      "Gym registration no longer requires documents. Save gym details and continue to payment.",
    );
  if (!extensions[req.body.mimeType])
    throw new AppError(
      422,
      "FILE_TYPE_NOT_ALLOWED",
      "This file type is not allowed.",
    );
  const max = ["GYM_LOGO", "AVATAR", "MEMBER_AVATAR", "TRAINER_IMAGE", "CLASS_IMAGE"].includes(
    req.body.purpose,
  )
    ? 5_000_000
    : req.body.mimeType === "video/mp4"
      ? 50_000_000
      : 10_000_000;
  if (req.body.size > max)
    throw new AppError(
      413,
      "FILE_TOO_LARGE",
      `File must be no larger than ${max / 1_000_000} MB.`,
    );
  const registration = req.body.registrationId
    ? await editableRegistration(
        req.body.registrationId,
        req.auth!.userId,
        true,
      )
    : null;
  if (
    registration &&
    (req.body.purpose !== "DOCUMENT" ||
      !["image/jpeg", "image/png", "application/pdf"].includes(
        req.body.mimeType,
      ))
  )
    throw new AppError(
      422,
      "FILE_TYPE_NOT_ALLOWED",
      "Gym verification accepts PDF, JPG or PNG documents.",
    );
  const publicId = nanoid(20),
    gymId = registration?.gymId || selectedGymId;
  const tenantMedia =
    req.body.purpose.startsWith("GYM_") ||
    ["TRAINER_IMAGE", "CLASS_IMAGE", "MEMBER_AVATAR", "AD"].includes(req.body.purpose);
  const key = `${tenantMedia ? `gyms/${gymId}` : `users/${req.auth!.userId}`}/${req.body.purpose.toLowerCase()}/${publicId}.${extensions[req.body.mimeType]}`;
  const provider = storageProvider();
  // Byte validation precedes storage. No browser-writable object URL survives completion.
  const uploadUrl = `/api/v1/uploads/${publicId}/bytes`;
  const data = await Attachment.create({
    publicId,
    ownerId: req.auth!.userId,
    gymId,
    registrationId: registration?._id,
    purpose: req.body.purpose,
    objectKey: key,
    storageProvider: provider,
    originalName: req.body.name,
    mimeType: req.body.mimeType,
    size: req.body.size,
    status: "PENDING",
  });
  res.status(201).json({
    success: true,
    data: { attachment: data, uploadUrl, expiresInSeconds: 900 },
  });
}
export async function bytes(req: Request, res: Response) {
  const data = await Attachment.findOne({
    publicId: req.params.id,
    ownerId: req.auth!.userId,
    status: "PENDING",
    deletedAt: null,
    createdAt: { $gte: new Date(Date.now() - 15 * 60000) },
  });
  if (!data)
    throw new AppError(
      404,
      "UPLOAD_NOT_FOUND",
      "This upload is unavailable or has already completed.",
    );
  await assertTenantMediaAccess(req, data.purpose, data.gymId);
  if (!Buffer.isBuffer(req.body) || req.body.length !== data.size)
    throw new AppError(
      422,
      "UPLOAD_SIZE_MISMATCH",
      "Uploaded file size does not match the selected file.",
    );
  validateMediaBytes(req.body, data.mimeType, data.purpose === "GYM_LOGO");
  const claimed = await Attachment.findOneAndUpdate(
    {
      _id: data._id,
      ownerId: req.auth!.userId,
      status: "PENDING",
      deletedAt: null,
    },
    {
      $set: {
        status: "UPLOADED",
        ...(data.mimeType.startsWith("image/")
          ? { thumbnailObjectKey: data.objectKey + ".thumb.webp" }
          : {}),
      },
    },
    { returnDocument: "after" },
  );
  if (!claimed)
    throw new AppError(
      409,
      "UPLOAD_IN_PROGRESS",
      "This file is already being uploaded.",
    );
  let completed;
  try {
    const metadata = await uploadMediaBytes(claimed.toObject(), req.body);
    completed = await Attachment.findOneAndUpdate(
      {
        _id: data._id,
        ownerId: req.auth!.userId,
        status: "UPLOADED",
        deletedAt: null,
      },
      { $set: { ...metadata, status: "READY" } },
      { returnDocument: "after" },
    );
    if (!completed)
      throw new AppError(
        409,
        "UPLOAD_STATE_CHANGED",
        "This upload is no longer available. Start a new upload.",
      );
  } catch (error) {
    await Attachment.updateOne(
      {
        _id: data._id,
        ownerId: req.auth!.userId,
        status: "UPLOADED",
        deletedAt: null,
      },
      { status: "PENDING" },
    );
    throw error;
  }
  res.json({
    success: true,
    data: { ...completed.toObject(), url: attachmentUrl(completed) },
  });
}
export async function complete(req: Request, res: Response) {
  let data = await Attachment.findOne({
    publicId: req.params.id,
    ownerId: req.auth!.userId,
    status: { $in: ["PENDING", "READY"] },
    deletedAt: null,
  });
  if (!data) throw new AppError(404, "UPLOAD_NOT_FOUND", "Upload not found.");
  await assertTenantMediaAccess(req, data.purpose, data.gymId);
  if (data.status !== "READY") {
    if (data.storageProvider === "cloudinary")
      throw new AppError(
        409,
        "UPLOAD_NOT_PRESENT",
        "Upload the file before completing it.",
      );
    if (data.registrationId)
      throw new AppError(
        410,
        "REGISTRATION_DOCUMENTS_REMOVED",
        "Gym registration no longer accepts verification documents.",
      );
    const head = await fetch(presignedObjectUrl("HEAD", data.objectKey, 120), {
      method: "HEAD",
      signal: AbortSignal.timeout(15000),
    });
    if (!head.ok)
      throw new AppError(
        409,
        "UPLOAD_NOT_PRESENT",
        "Upload bytes were not found in storage.",
      );
    if (Number(head.headers.get("content-length")) !== data.size)
      throw new AppError(
        409,
        "UPLOAD_SIZE_MISMATCH",
        "Uploaded file size does not match the request.",
      );
    if (head.headers.get("content-type")?.split(";")[0] !== data.mimeType)
      throw new AppError(
        409,
        "UPLOAD_TYPE_MISMATCH",
        "Uploaded file type does not match the request.",
      );
    const content = await fetch(
      presignedObjectUrl("GET", data.objectKey, 120),
      {
        headers: { Range: "bytes=0-65535" },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!content.ok || !content.body)
      throw new AppError(
        409,
        "UPLOAD_NOT_PRESENT",
        "The uploaded file could not be checked.",
      );
    const reader = content.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (length < 65536) {
        const chunk = await reader.read();
        if (chunk.done) break;
        const part = chunk.value.subarray(0, 65536 - length);
        chunks.push(part);
        length += part.length;
      }
    } finally {
      await reader.cancel();
    }
    validateMediaBytes(
      Buffer.concat(chunks),
      data.mimeType,
      data.purpose === "GYM_LOGO",
    );
    const completed = await Attachment.findOneAndUpdate(
      {
        _id: data._id,
        ownerId: req.auth!.userId,
        status: "PENDING",
        deletedAt: null,
      },
      {
        $set: {
          status: "READY",
          ...(req.body.checksum ? { checksum: req.body.checksum } : {}),
        },
      },
      { returnDocument: "after" },
    );
    // A concurrent completion is idempotent; deletion or an active byte upload is not.
    data =
      completed ||
      (await Attachment.findOne({
        _id: data._id,
        ownerId: req.auth!.userId,
        status: "READY",
        deletedAt: null,
      }));
    if (!data)
      throw new AppError(
        409,
        "UPLOAD_STATE_CHANGED",
        "This upload changed while it was being checked. Retry or start a new upload.",
      );
  }
  res.json({
    success: true,
    data: {
      ...data.toObject(),
      url: attachmentUrl(data),
    },
  });
}
export async function remove(req: Request, res: Response) {
  const data = await mongoose.connection.transaction(async (session) => {
    const filter = {
      publicId: req.params.id,
      ownerId: req.auth!.userId,
      deletedAt: null,
    };
    // Binding transactions write this same row through lockAttachments.
    const claimed = await Attachment.findOneAndUpdate(
      { ...filter, status: { $in: ["PENDING", "READY"] } },
      { $set: { status: "DELETING" }, $inc: { bindingVersion: 1 } },
      { session, returnDocument: "after" },
    );
    const current =
      claimed || (await Attachment.findOne(filter).session(session));
    if (!current)
      throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
    await assertTenantMediaAccess(req, current.purpose, current.gymId);
    if (current.registrationId)
      await editableRegistration(
        current.registrationId,
        req.auth!.userId,
        false,
        session,
      );
    if (!claimed) {
      // A storage failure leaves DELETING for an authorized, idempotent retry.
      if (current.status === "DELETING") return current;
      throw new AppError(
        409,
        "UPLOAD_IN_PROGRESS",
        "Wait for this upload to finish before deleting it.",
      );
    }
    if (
      (await Gym.exists({
        $or: [
          { logoAttachmentId: current._id },
          { coverAttachmentId: current._id },
          { mediaAttachmentIds: current._id },
        ],
      }).session(session)) ||
      (await User.exists({ avatarAttachmentId: current._id }).session(
        session,
      )) ||
      (await MemberProfile.exists({
        "contact.avatarAttachmentId": current._id,
      }).session(session)) ||
      (await Review.exists({
        attachmentIds: current._id,
        status: { $ne: "REMOVED" },
      }).session(session)) ||
      (await Trainer.exists({ photoAttachmentId: current._id }).session(
        session,
      )) ||
      (await ClassSession.exists({ imageAttachmentId: current._id }).session(session)) ||
      (await SocialPost.exists({
        attachmentIds: current._id,
        deletedAt: null,
      }).session(session)) ||
      (await SocialStory.exists({
        attachmentIds: current._id,
        deletedAt: null,
        expiresAt: { $gt: new Date() },
      }).session(session)) ||
      (await Advertisement.exists({ creativeAttachmentId: current._id, status: { $ne: "ARCHIVED" } }).session(session)) ||
      (await Invoice.exists({ "supplierSnapshot.logoAttachmentId": current._id }).session(session)) ||
      (await Message.exists({
        deletedAt: null,
        "attachments.key": { $in: [current.publicId, current.objectKey] },
      }).session(session))
    )
      throw new AppError(
        409,
        "MEDIA_IN_USE",
        "Remove this file from its profile, message or content before deleting it.",
      );
    return current;
  });
  // External storage work must be outside the retriable MongoDB transaction.
  await deleteMedia(data.toObject());
  const result = await Attachment.updateOne(
    {
      _id: data._id,
      ownerId: req.auth!.userId,
      status: "DELETING",
      deletedAt: null,
    },
    { $set: { status: "DELETED", deletedAt: new Date() } },
  );
  if (
    !result.matchedCount &&
    !(await Attachment.exists({
      _id: data._id,
      ownerId: req.auth!.userId,
      status: "DELETED",
      deletedAt: { $ne: null },
    }))
  )
    throw new AppError(
      409,
      "UPLOAD_STATE_CHANGED",
      "The file state changed. Retry deleting the file.",
    );
  res.status(204).send();
}
