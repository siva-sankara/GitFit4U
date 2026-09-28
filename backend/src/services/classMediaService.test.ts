import { afterEach, expect, it, vi } from "vitest";
import { Attachment } from "../models/Business.js";
import { withClassMedia } from "./classMediaService.js";
vi.mock("../integrations/storage/mediaStore.js", () => ({ attachmentUrl: (file: any, thumbnail?: boolean) => `signed:${file._id}:${thumbnail ? "thumb" : "full"}` }));
afterEach(() => vi.restoreAllMocks());
it("resolves only a ready tenant class attachment and preserves unbound legacy media", async () => {
  vi.spyOn(Attachment, "find").mockReturnValue({ lean: async () => [{ _id: "image", gymId: "gym-one", thumbnailObjectKey: "thumb" }] } as any);
  const rows = await withClassMedia([
    { gymId: { _id: "gym-one" }, imageAttachmentId: "image" },
    { gymId: "gym-two", imageAttachmentId: "image", imageUrl: "untrusted-fallback" },
    { gymId: "gym-one", imageUrl: "legacy-image" },
  ]);
  expect(rows[0]).toMatchObject({ imageUrl: "signed:image:full", imageThumbnailUrl: "signed:image:thumb" });
  expect(rows[1].imageUrl).toBeUndefined();
  expect(rows[2].imageUrl).toBe("legacy-image");
  expect(Attachment.find).toHaveBeenCalledWith(expect.objectContaining({ purpose: "CLASS_IMAGE", status: "READY", deletedAt: null }));
});
