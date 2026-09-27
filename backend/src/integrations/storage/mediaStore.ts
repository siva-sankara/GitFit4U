import { createHash } from "node:crypto";
import { prepareImage } from "../../services/imageProcessingService.js";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { presignedObjectUrl } from "./s3ObjectStore.js";

export function storageProvider(): "s3" | "cloudinary" {
  return "s3";
}
function cloudinaryConfig() {
  if (
    !env.CLOUDINARY_CLOUD_NAME ||
    !env.CLOUDINARY_API_KEY ||
    !env.CLOUDINARY_API_SECRET
  )
    throw new AppError(
      503,
      "MEDIA_NOT_CONFIGURED",
      "Image storage is not configured. Ask the administrator to configure the media provider.",
    );
  return {
    cloud: env.CLOUDINARY_CLOUD_NAME,
    key: env.CLOUDINARY_API_KEY,
    secret: env.CLOUDINARY_API_SECRET,
  };
}
export function cloudinarySignature(
  parameters: Record<string, string>,
  secret: string,
) {
  return createHash("sha256")
    .update(
      Object.keys(parameters)
        .sort()
        .map((key) => `${key}=${parameters[key]}`)
        .join("&") + secret,
    )
    .digest("hex");
}
export function attachmentUrl(file: any, thumbnail = false) {
  if (
    file.storageProvider === "cloudinary" &&
    file.deliveryType === "authenticated"
  ) {
    const config = cloudinaryConfig(),
      now = Math.floor(Date.now() / 1000);
    const parameters: Record<string, string> = {
      timestamp: String(now),
      expires_at: String(now + 300),
      public_id: file.providerPublicId,
      type: "authenticated",
      attachment: "false",
      ...(file.format ? { format: file.format } : {}),
    };
    const query = new URLSearchParams({
      ...parameters,
      api_key: config.key,
      signature: cloudinarySignature(parameters, config.secret),
    });
    return `https://api.cloudinary.com/v1_1/${config.cloud}/${file.resourceType || "image"}/download?${query}`;
  }
  return file.storageProvider === "cloudinary"
    ? thumbnail && file.secureUrl?.includes("/image/upload/")
      ? file.secureUrl.replace(
          "/image/upload/",
          "/image/upload/c_fill,w_160,h_160,q_auto,f_auto/",
        )
      : file.secureUrl
    : presignedObjectUrl(
        "GET",
        thumbnail && file.thumbnailObjectKey
          ? file.thumbnailObjectKey
          : file.objectKey,
        300,
      );
}
export function verifyMediaConfiguration() {
  if (
    !env.OBJECT_STORAGE_ENDPOINT ||
    !env.OBJECT_STORAGE_ACCESS_KEY ||
    !env.OBJECT_STORAGE_SECRET_KEY
  )
    throw new AppError(
      503,
      "MEDIA_NOT_CONFIGURED",
      "Image storage is not configured. Ask the administrator to configure the media provider.",
    );
}
export async function putS3Bytes(file: any, bytes: Buffer) {
  if (file.storageProvider === "cloudinary")
    throw new AppError(
      409,
      "LEGACY_UPLOAD_DISABLED",
      "Start a new upload to save this file in S3.",
    );
  let response: Response;
  try {
    response = await fetch(presignedObjectUrl("PUT", file.objectKey, 120), {
      method: "PUT",
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(bytes.length),
      },
      body: new Uint8Array(bytes),
      signal: AbortSignal.timeout(90000),
    });
  } catch {
    throw new AppError(
      502,
      "MEDIA_UNREACHABLE",
      "Image storage could not be reached. Please retry.",
    );
  }
  if (!response.ok)
    throw new AppError(
      502,
      "MEDIA_UPLOAD_FAILED",
      "Image storage rejected the upload. Contact the administrator if retrying does not help.",
    );
  return {};
}
export async function uploadMediaBytes(file: any, bytes: Buffer) {
  if (file.storageProvider === "cloudinary")
    throw new AppError(
      409,
      "LEGACY_UPLOAD_DISABLED",
      "Start a new upload to save this file in S3.",
    );
  verifyMediaConfiguration();
  if (!file.mimeType.startsWith("image/")) return putS3Bytes(file, bytes);
  const prepared = await prepareImage(bytes, file.mimeType);
  const thumbnailObjectKey = file.objectKey + ".thumb.webp";
  await putS3Bytes(file, prepared.original);
  await putS3Bytes(
    { ...file, objectKey: thumbnailObjectKey, mimeType: "image/webp" },
    prepared.thumbnail,
  );
  return {
    size: prepared.original.length,
    width: prepared.width,
    height: prepared.height,
    thumbnailObjectKey,
    thumbnailSize: prepared.thumbnail.length,
  };
}
export async function deleteMedia(file: any) {
  if (file.storageProvider !== "cloudinary") {
    const response = await fetch(
      presignedObjectUrl("DELETE", file.objectKey, 120),
      { method: "DELETE", signal: AbortSignal.timeout(15000) },
    );
    if (!response.ok && response.status !== 404)
      throw new AppError(
        502,
        "STORAGE_DELETE_FAILED",
        "File could not be deleted.",
      );
    if (file.thumbnailObjectKey)
      await deleteMedia({
        ...file,
        objectKey: file.thumbnailObjectKey,
        thumbnailObjectKey: undefined,
      });
    return;
  }
  if (!file.providerPublicId) return;
  const config = cloudinaryConfig(),
    resource = file.mimeType.startsWith("video/")
      ? "video"
      : file.mimeType.startsWith("image/")
        ? "image"
        : "raw";
  const parameters = {
    public_id: file.providerPublicId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    invalidate: "true",
    type: file.deliveryType || "upload",
  };
  const body = new URLSearchParams({
    ...parameters,
    api_key: config.key,
    signature: cloudinarySignature(parameters, config.secret),
  });
  const response = await fetch(
    `https://api.cloudinary.com/v1_1/${config.cloud}/${resource}/destroy`,
    { method: "POST", body, signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok)
    throw new AppError(
      502,
      "STORAGE_DELETE_FAILED",
      "File could not be deleted. Retry shortly.",
    );
}
