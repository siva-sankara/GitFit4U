import { afterEach, expect, it, vi } from "vitest";
import sharp from "sharp";
vi.mock("../../config/env.js", () => ({ env: {
  OBJECT_STORAGE_ENDPOINT: "https://s3.ap-south-1.amazonaws.com", OBJECT_STORAGE_BUCKET: "test-bucket",
  OBJECT_STORAGE_REGION: "ap-south-1", OBJECT_STORAGE_ACCESS_KEY: "test-access", OBJECT_STORAGE_SECRET_KEY: "test-secret",
  CLOUDINARY_CLOUD_NAME: "test-cloud", CLOUDINARY_API_KEY: "test-key", CLOUDINARY_API_SECRET: "server-secret", MEDIA_STORAGE_PROVIDER: "cloudinary",
} }));
import { attachmentUrl, storageProvider, uploadMediaBytes } from "./mediaStore.js";
import { presignedObjectUrl } from "./s3ObjectStore.js";
afterEach(() => vi.unstubAllGlobals());
it("always chooses S3 for new uploads even when legacy Cloudinary configuration is present", () => expect(storageProvider()).toBe("s3"));
it("decodes and optimizes images then writes a small WebP thumbnail to S3", async () => {
  const bytes = await sharp({ create: { width: 600, height: 800, channels: 3, background: "#445566" } }).png().toBuffer();
  const fetchMock = vi.fn(async () => ({ ok: true })); vi.stubGlobal("fetch", fetchMock);
  const result = await uploadMediaBytes({ storageProvider: "s3", objectKey: "users/owner/avatar/asset.png", mimeType: "image/png" }, bytes);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(String(fetchMock.mock.calls[0][0])).toContain("s3.ap-south-1.amazonaws.com");
  expect(result).toMatchObject({ width: 600, height: 800, thumbnailObjectKey: "users/owner/avatar/asset.png.thumb.webp" });
  const thumb = await sharp(Buffer.from((fetchMock.mock.calls[1] as any)[1].body)).metadata();
  expect(thumb).toMatchObject({ format: "webp", width: 160, height: 160 });
  expect(attachmentUrl({ storageProvider: "s3", objectKey: "full.png", thumbnailObjectKey: "thumb.webp" }, true)).toContain("/thumb.webp?");
});
it("rejects forged image bytes before uploading and disallows pending legacy uploads", async () => {
  const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  await expect(uploadMediaBytes({ storageProvider: "s3", objectKey: "users/u/asset.png", mimeType: "image/png" }, Buffer.from("not a PNG"))).rejects.toMatchObject({ code: "IMAGE_CONTENT_INVALID" });
  await expect(uploadMediaBytes({ storageProvider: "cloudinary" }, Buffer.alloc(0))).rejects.toMatchObject({ code: "LEGACY_UPLOAD_DISABLED" });
  expect(fetchMock).not.toHaveBeenCalled();
});
it("preserves expiring access for already stored confidential Cloudinary files", () => {
  const url = new URL(attachmentUrl({ storageProvider: "cloudinary", deliveryType: "authenticated", providerPublicId: "legacy-private", format: "png" }));
  expect(url.searchParams.get("type")).toBe("authenticated");
  expect(Number(url.searchParams.get("expires_at")) - Number(url.searchParams.get("timestamp"))).toBe(300);
  expect(url.toString()).not.toContain("server-secret");
});
it("rejects traversal/object-path manipulation", () => {
  for (const key of ["../private", "users/../../secret", "/root", "users\\secret"]) expect(() => presignedObjectUrl("GET", key)).toThrow();
});
it("sanitizes S3 rejections instead of exposing upstream response contents", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 403, text: async () => "provider secret debug" })));
  await expect(uploadMediaBytes({ storageProvider: "s3", objectKey: "documents/doc.pdf", mimeType: "application/pdf" }, Buffer.from("%PDF-1.0"))).rejects.toMatchObject({ code: "MEDIA_UPLOAD_FAILED" });
});
