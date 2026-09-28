import { AppError } from "../utils/AppError.js";

const extensions: Record<string, string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
  "video/mp4": ["mp4"],
};
export function validateMediaName(name: string, mimeType: string) {
  if (
    !extensions[mimeType]?.includes(name.split(".").pop()?.toLowerCase() || "")
  )
    throw new AppError(
      422,
      "FILE_EXTENSION_MISMATCH",
      "The file extension does not match its supported file type.",
    );
}
export function validateMediaBytes(
  bytes: Buffer,
  mimeType: string,
  logo = false,
) {
  const valid =
    mimeType === "image/jpeg"
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : mimeType === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mimeType === "image/webp"
          ? bytes.toString("ascii", 0, 4) === "RIFF" &&
            bytes.toString("ascii", 8, 12) === "WEBP"
          : mimeType === "application/pdf"
            ? bytes.toString("ascii", 0, 5) === "%PDF-"
            : mimeType === "video/mp4"
              ? bytes.toString("ascii", 4, 8) === "ftyp"
              : false;
  if (!valid)
    throw new AppError(
      422,
      "FILE_CONTENT_INVALID",
      "The file contents do not match the selected file type. Choose a valid image or document.",
    );
  if (logo && !mimeType.startsWith("image/"))
    throw new AppError(
      422,
      "LOGO_TYPE_INVALID",
      "Gym logos must be JPG, PNG or WebP images.",
    );
  let width = 0,
    height = 0;
  if (mimeType === "image/png" && bytes.length >= 24) {
    width = bytes.readUInt32BE(16);
    height = bytes.readUInt32BE(20);
  } else if (mimeType === "image/jpeg") {
    for (let offset = 2; offset + 9 < bytes.length;) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (segmentLength < 2) break;
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(marker)
      ) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      offset += 2 + segmentLength;
    }
  } else if (mimeType === "image/webp" && bytes.length >= 30) {
    const format = bytes.toString("ascii", 12, 16);
    if (format === "VP8X") {
      width = 1 + bytes.readUIntLE(24, 3);
      height = 1 + bytes.readUIntLE(27, 3);
    }
    if (
      format === "VP8 " &&
      bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))
    ) {
      width = bytes.readUInt16LE(26) & 0x3fff;
      height = bytes.readUInt16LE(28) & 0x3fff;
    }
    if (format === "VP8L" && bytes[20] === 0x2f) {
      const packed = bytes.readUInt32LE(21);
      width = (packed & 0x3fff) + 1;
      height = ((packed >>> 14) & 0x3fff) + 1;
    }
  }
  if (width || height || mimeType === "image/png") {
    if (
      !width ||
      !height ||
      width > 12000 ||
      height > 12000 ||
      width * height > 40_000_000
    )
      throw new AppError(
        422,
        "IMAGE_DIMENSIONS_INVALID",
        "Choose an image no larger than 12,000 pixels per side and 40 megapixels.",
      );
  }
}
