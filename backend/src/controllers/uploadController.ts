import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { Attachment } from "../models/Business.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { presignedObjectUrl } from "../integrations/storage/s3ObjectStore.js";
import { AppError } from "../utils/AppError.js";
import { Gym } from "../models/Gym.js";
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
) {
  const registration = await GymRegistration.findOne({
    [publicId ? "publicId" : "_id"]: id,
    ownerId,
  });
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
  if (["GYM_GALLERY", "GYM_COVER", "GYM_LOGO"].includes(req.body.purpose)) {
    if (!req.auth!.gymId || !req.auth!.permissions.includes("gym:update"))
      throw new AppError(
        403,
        "GYM_MEDIA_FORBIDDEN",
        "Select a gym you can manage before uploading its media.",
      );
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
  const max =
    req.body.purpose === "GYM_LOGO"
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
    gymId = registration?.gymId || req.auth!.gymId;
  const key = `${gymId || "users"}/${req.auth!.userId}/${req.body.purpose.toLowerCase()}/${publicId}.${extensions[req.body.mimeType]}`;
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
  });
  if (!data)
    throw new AppError(
      404,
      "UPLOAD_NOT_FOUND",
      "This upload is unavailable or has already completed.",
    );
  if (
    data.purpose.startsWith("GYM_") &&
    !req.auth!.permissions.includes("gym:update")
  )
    throw new AppError(
      403,
      "GYM_MEDIA_FORBIDDEN",
      "Gym profile editing permission is required.",
    );
  if (
    String(data.gymId || "") !== String(req.auth!.gymId || "") &&
    data.purpose.startsWith("GYM_")
  )
    throw new AppError(
      403,
      "GYM_MEDIA_FORBIDDEN",
      "Switch to the gym that owns this upload.",
    );
  if (!Buffer.isBuffer(req.body) || req.body.length !== data.size)
    throw new AppError(
      422,
      "UPLOAD_SIZE_MISMATCH",
      "Uploaded file size does not match the selected file.",
    );
  validateMediaBytes(req.body, data.mimeType, data.purpose === "GYM_LOGO");
  const claimed = await Attachment.findOneAndUpdate(
    { _id: data._id, status: "PENDING" },
    { status: "UPLOADED" },
    { new: true },
  );
  if (!claimed)
    throw new AppError(
      409,
      "UPLOAD_IN_PROGRESS",
      "This file is already being uploaded.",
    );
  try {
    Object.assign(data, await uploadMediaBytes(data, req.body), {
      status: "READY",
    });
    await data.save();
  } catch (error) {
    await Attachment.updateOne(
      { _id: data._id, status: "UPLOADED" },
      { status: "PENDING" },
    );
    throw error;
  }
  res.json({
    success: true,
    data: { ...data.toObject(), url: attachmentUrl(data) },
  });
}
export async function complete(req: Request, res: Response) {
  const data = await Attachment.findOne({
    publicId: req.params.id,
    ownerId: req.auth!.userId,
    status: { $in: ["PENDING", "READY"] },
  });
  if (!data) throw new AppError(404, "UPLOAD_NOT_FOUND", "Upload not found.");
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
    data.status = "READY";
    data.checksum = req.body.checksum;
    await data.save();
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
  const data = await Attachment.findOne({
    publicId: req.params.id,
    ownerId: req.auth!.userId,
    deletedAt: null,
  });
  if (!data)
    throw new AppError(404, "ATTACHMENT_NOT_FOUND", "Attachment not found.");
  if (data.registrationId)
    await editableRegistration(data.registrationId, req.auth!.userId);
  if (
    await Gym.exists({
      $or: [
        { logoAttachmentId: data._id },
        { coverAttachmentId: data._id },
        { mediaAttachmentIds: data._id },
      ],
    })
  )
    throw new AppError(
      409,
      "MEDIA_IN_USE",
      "Remove this file from the gym profile before deleting it.",
    );
  await deleteMedia(data);
  data.status = "DELETED";
  data.deletedAt = new Date();
  await data.save();
  res.status(204).send();
}
