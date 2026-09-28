import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Attachment } from "../models/Business.js";
import { ClassSession } from "../models/Engagement.js";
import { classMediaCleanupFilter, claimUnusedClassImage, cleanupUnusedClassImages } from "./classMediaCleanupService.js";
import { deleteMedia } from "../integrations/storage/mediaStore.js";
vi.mock("../integrations/storage/mediaStore.js", () => ({ deleteMedia: vi.fn() }));
vi.mock("../config/logger.js", () => ({ logger: { warn: vi.fn() } }));
const now = new Date("2030-01-02T12:00:00Z"), session = {} as any;
let file: any;
beforeEach(() => {
  vi.clearAllMocks();
  file = { _id: "image", publicId: "public", gymId: "gym", purpose: "CLASS_IMAGE", status: "READY", objectKey: "gyms/gym/class_image/public.png", toObject() { return { ...this }; } };
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (work: any) => work(session));
  vi.spyOn(Attachment, "findOneAndUpdate").mockResolvedValue(file);
  vi.spyOn(Attachment, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
  vi.spyOn(ClassSession, "exists").mockReturnValue({ session: vi.fn().mockResolvedValue(null) } as any);
});
afterEach(() => vi.restoreAllMocks());
it("keeps a full-day grace period and excludes legacy/other-purpose/in-progress uploads", () => {
  expect(classMediaCleanupFilter(now)).toEqual({ purpose: "CLASS_IMAGE", storageProvider: "s3", deletedAt: null, $or: [
    { status: { $in: ["PENDING", "READY", "REJECTED"] }, updatedAt: { $lte: new Date("2030-01-01T12:00:00Z") } },
    { status: "DELETING", updatedAt: { $lte: new Date("2030-01-02T11:55:00Z") } },
  ] });
});
it("locks the attachment before checking references and retains every referenced class image", async () => {
  vi.mocked(ClassSession.exists).mockReturnValue({ session: vi.fn().mockResolvedValue({ _id: "class" }) } as any);
  expect(await claimUnusedClassImage("image", now)).toBeNull();
  expect(Attachment.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ _id: "image" }), expect.objectContaining({ $inc: { bindingVersion: 1 } }), expect.objectContaining({ session }));
  expect(vi.mocked(Attachment.findOneAndUpdate).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(ClassSession.exists).mock.invocationCallOrder[0]);
  expect(Attachment.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: { status: "READY", updatedAt: now } }), expect.objectContaining({ session }));
  expect(deleteMedia).not.toHaveBeenCalled();
});
it("does not claim an upload attached or refreshed after candidate discovery", async () => {
  vi.mocked(Attachment.findOneAndUpdate).mockResolvedValue(null);
  expect(await claimUnusedClassImage("image", now)).toBeNull();
  expect(ClassSession.exists).not.toHaveBeenCalled();
});
it("refuses arbitrary storage keys even on an orphan record", async () => {
  file.objectKey = "gyms/other-gym/logo/private.png";
  expect(await claimUnusedClassImage("image", now)).toBeNull();
  expect(deleteMedia).not.toHaveBeenCalled();
});
it("bounds scans and retains a failed deletion for a later idempotent retry", async () => {
  const query: any = { select: () => query, sort: () => query, limit: vi.fn(() => query), lean: async () => [{ _id: "image" }] };
  vi.spyOn(Attachment, "find").mockReturnValue(query);
  vi.mocked(deleteMedia).mockRejectedValueOnce(new Error("storage unavailable"));
  expect(await cleanupUnusedClassImages({ now, limit: 100 })).toEqual({ checked: 1, removed: 0 });
  expect(query.limit).toHaveBeenCalledWith(50);
  expect(Attachment.updateOne).not.toHaveBeenCalled();
  vi.mocked(deleteMedia).mockResolvedValue(undefined);
  expect(await cleanupUnusedClassImages({ now: new Date(now.getTime() + 300001) })).toEqual({ checked: 1, removed: 1 });
  expect(Attachment.updateOne).toHaveBeenCalledWith(expect.objectContaining({ status: "DELETING", purpose: "CLASS_IMAGE" }), expect.objectContaining({ $set: expect.objectContaining({ status: "DELETED" }) }));
});
