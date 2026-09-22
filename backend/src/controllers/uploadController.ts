import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { Attachment } from "../models/Business.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { presignedObjectUrl } from "../integrations/storage/s3ObjectStore.js";
import { AppError } from "../utils/AppError.js";
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
  const max = req.body.mimeType === "video/mp4" ? 50_000_000 : 10_000_000;
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
  const uploadUrl = presignedObjectUrl("PUT", key);
  const data = await Attachment.create({
    publicId,
    ownerId: req.auth!.userId,
    gymId,
    registrationId: registration?._id,
    purpose: req.body.purpose,
    objectKey: key,
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
export async function complete(req: Request, res: Response) {
  const data = await Attachment.findOne({
    publicId: req.params.id,
    ownerId: req.auth!.userId,
    status: { $in: ["PENDING", "READY"] },
  });
  if (!data) throw new AppError(404, "UPLOAD_NOT_FOUND", "Upload not found.");
  if (data.status !== "READY") {
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
    data.status = "READY";
    data.checksum = req.body.checksum;
    await data.save();
  }
  res.json({
    success: true,
    data: {
      ...data.toObject(),
      url: presignedObjectUrl("GET", data.objectKey, 3600),
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
  const response = await fetch(
    presignedObjectUrl("DELETE", data.objectKey, 120),
    { method: "DELETE", signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok && response.status !== 404)
    throw new AppError(
      502,
      "STORAGE_DELETE_FAILED",
      "File could not be deleted.",
    );
  data.status = "DELETED";
  data.deletedAt = new Date();
  await data.save();
  res.status(204).send();
}
