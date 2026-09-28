import sharp from "sharp";
import { AppError } from "../utils/AppError.js";

// Decode untrusted images fully, strip metadata and generate a small real thumbnail.
export async function prepareImage(bytes: Buffer, mimeType: string) {
  try {
    const image = sharp(bytes, {
      limitInputPixels: 40_000_000,
      failOn: "warning",
    });
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      metadata.width > 12000 ||
      metadata.height > 12000 ||
      (metadata.pages || 1) > 1 ||
      !["jpeg", "png", "webp"].includes(metadata.format || "") ||
      `image/${metadata.format}` !== mimeType
    )
      throw new Error("Invalid image");
    const result = await image
      .rotate()
      .resize(2048, 2048, { fit: "inside", withoutEnlargement: true })
      .toFormat(metadata.format as "jpeg" | "png" | "webp", { quality: 85 })
      .toBuffer({ resolveWithObject: true });
    const thumbnail = await sharp(result.data)
      .resize(160, 160, { fit: "cover", withoutEnlargement: true })
      .webp({ quality: 78 })
      .toBuffer();
    return {
      original: result.data,
      thumbnail,
      width: result.info.width,
      height: result.info.height,
    };
  } catch {
    throw new AppError(
      422,
      "IMAGE_CONTENT_INVALID",
      "Choose a valid, still JPG, PNG or WebP image up to 40 megapixels.",
    );
  }
}
