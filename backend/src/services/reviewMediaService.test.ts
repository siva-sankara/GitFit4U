import { afterEach, describe, expect, it, vi } from "vitest";
import { Attachment } from "../models/Business.js";
import { reviewInput } from "../routes/inputSchemas.js";
import { validateReviewImages, withReviewMedia } from "./reviewMediaService.js";
vi.mock("../integrations/storage/mediaStore.js", () => ({ attachmentUrl: (file: any, thumb: boolean) => `${thumb ? "thumbnail" : "original"}/${file._id}` }));
afterEach(() => vi.restoreAllMocks());
const id = "507f1f77bcf86cd799439011";
describe("review image binding", () => {
  it("rejects raw URL injection and duplicate attachment IDs at the API schema", () => {
    expect(reviewInput.safeParse({ rating: 5, photoUrls: ["https://untrusted.example/image"] }).success).toBe(false);
    expect(reviewInput.safeParse({ rating: 5, attachmentIds: [id, id] }).success).toBe(false);
  });
  it("requires owned, completed S3 review images", async () => {
    const find = vi.spyOn(Attachment, "find").mockReturnValue({ lean: async () => [] } as any);
    await expect(validateReviewImages([id], "owner")).rejects.toMatchObject({ code: "REVIEW_IMAGE_UNAVAILABLE" });
    expect(find).toHaveBeenCalledWith({ _id: { $in: [id] }, ownerId: "owner", purpose: "REVIEW", storageProvider: "s3", status: "READY", deletedAt: null });
  });
  it("resolves thumbnails and does not expose a different author's image", async () => {
    vi.spyOn(Attachment, "find").mockReturnValue({ lean: async () => [{ _id: id, ownerId: "owner", mimeType: "image/png" }] } as any);
    const rows = await withReviewMedia([{ userId: { _id: "owner" }, attachmentIds: [id] }, { userId: "someone-else", attachmentIds: [id] }]);
    expect(rows[0].images).toEqual([{ id, url: `original/${id}`, thumbnailUrl: `thumbnail/${id}` }]);
    expect(rows[1].images).toEqual([]);
  });
});
