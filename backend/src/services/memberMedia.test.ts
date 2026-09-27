import { afterEach, expect, it, vi } from "vitest";
import { Attachment } from "../models/Business.js";
import { validatedImageAttachment, withMemberMedia } from "./userMediaService.js";
vi.mock("../integrations/storage/mediaStore.js", () => ({ attachmentUrl: (file: any, thumbnail?: boolean) => `https://media.test/${thumbnail ? file.thumbnailObjectKey : file.objectKey}` }));
afterEach(() => vi.restoreAllMocks());
it("resolves a member recognition thumbnail only for the member's gym", async () => {
  vi.spyOn(Attachment, "find").mockReturnValue({ lean: vi.fn().mockResolvedValue([{ _id: "photo", gymId: "gym-one", objectKey: "photo.webp", thumbnailObjectKey: "thumb.webp" }]) } as any);
  const rows = await withMemberMedia([
    { gymId: "gym-one", contact: { avatarAttachmentId: "photo" } },
    { gymId: "gym-two", contact: { avatarAttachmentId: "photo", avatarUrl: "https://legacy.test/should-not-fallback" } },
  ]);
  expect(rows[0].contact).toMatchObject({ avatarUrl: "https://media.test/photo.webp", avatarThumbnailUrl: "https://media.test/thumb.webp" });
  expect(rows[1].contact.avatarUrl).toBeUndefined();
  expect(Attachment.find).toHaveBeenCalledWith(expect.objectContaining({ purpose: "MEMBER_AVATAR", status: "READY", deletedAt: null }));
});
it("rejects member-photo binding unless uploader, purpose, ready state and gym all match", async () => {
  vi.spyOn(Attachment, "findOne").mockReturnValue({ session: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) } as any);
  await expect(validatedImageAttachment("507f1f77bcf86cd799439011", "uploader", "MEMBER_AVATAR", "gym-one")).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE" });
  expect(Attachment.findOne).toHaveBeenCalledWith(expect.objectContaining({ ownerId: "uploader", purpose: "MEMBER_AVATAR", gymId: "gym-one", storageProvider: "s3", status: "READY" }));
});
