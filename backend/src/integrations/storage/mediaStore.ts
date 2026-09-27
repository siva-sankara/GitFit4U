import { createHash } from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { presignedObjectUrl } from "./s3ObjectStore.js";

export function storageProvider() {
  return (
    env.MEDIA_STORAGE_PROVIDER ||
    (env.OBJECT_STORAGE_ENDPOINT &&
    env.OBJECT_STORAGE_ACCESS_KEY &&
    env.OBJECT_STORAGE_SECRET_KEY
      ? "s3"
      : env.CLOUDINARY_CLOUD_NAME
        ? "cloudinary"
        : "s3")
  );
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
export function attachmentUrl(file: any) {
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
    ? file.secureUrl
    : presignedObjectUrl("GET", file.objectKey, 3600);
}
export function verifyMediaConfiguration() {
  if (storageProvider() === "cloudinary") cloudinaryConfig();
  else if (
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
export async function uploadMediaBytes(file: any, bytes: Buffer) {
  if (file.storageProvider === "cloudinary")
    return uploadCloudinary(file, bytes);
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
export async function uploadCloudinary(file: any, bytes: Buffer) {
  const config = cloudinaryConfig();
  const resource = file.mimeType.startsWith("video/")
    ? "video"
    : file.mimeType.startsWith("image/")
      ? "image"
      : "raw";
  const publicId = `${env.CLOUDINARY_FOLDER}/${resource === "raw" ? file.objectKey : file.objectKey.replace(/\.[^.\/]+$/, "")}`;
  const deliveryType = [
    "GYM_LOGO",
    "GYM_COVER",
    "GYM_GALLERY",
    "AVATAR",
    "REVIEW",
    "AD",
  ].includes(file.purpose)
    ? "upload"
    : "authenticated";
  const parameters = {
    public_id: publicId,
    timestamp: String(Math.floor(Date.now() / 1000)),
    overwrite: "false",
    type: deliveryType,
  };
  const body = new FormData();
  for (const [key, value] of Object.entries(parameters))
    body.append(key, value);
  body.append("api_key", config.key);
  body.append("signature", cloudinarySignature(parameters, config.secret));
  body.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: file.mimeType }),
    file.originalName,
  );
  let response: Response;
  try {
    response = await fetch(
      `https://api.cloudinary.com/v1_1/${config.cloud}/${resource}/upload`,
      { method: "POST", body, signal: AbortSignal.timeout(90000) },
    );
  } catch {
    throw new AppError(
      502,
      "MEDIA_UNREACHABLE",
      "Image storage could not be reached. Retry your upload shortly.",
    );
  }
  if (!response.ok)
    throw new AppError(
      502,
      "MEDIA_UPLOAD_FAILED",
      response.status === 401 || response.status === 403
        ? "Image storage rejected its server credentials. Contact the administrator."
        : "Image storage could not process this file. Choose a supported file and retry.",
    );
  const result = (await response.json()) as any;
  if (
    !result.secure_url?.startsWith("https://res.cloudinary.com/") ||
    result.public_id !== publicId ||
    result.bytes !== file.size
  )
    throw new AppError(
      502,
      "MEDIA_RESPONSE_INVALID",
      "Image storage returned an invalid upload response. Please retry.",
    );
  return {
    providerPublicId: result.public_id,
    secureUrl: result.secure_url,
    width: result.width,
    height: result.height,
    deliveryType,
    resourceType: resource,
    format: result.format,
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
