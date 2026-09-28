import { afterEach, expect, it, vi } from "vitest";
import type { ClientSession } from "mongoose";
import { Attachment } from "../models/Business.js";
import { lockAttachments } from "./mediaBindingService.js";
afterEach(() => vi.restoreAllMocks());
const session = { inTransaction: () => true } as ClientSession;
it("writes each attachment once in the entity transaction", async () => {
  const update = vi
    .spyOn(Attachment, "updateMany")
    .mockResolvedValue({ matchedCount: 2 } as any);
  await lockAttachments(["b", "a", "b", null], session);
  expect(update).toHaveBeenCalledWith(
    { _id: { $in: ["a", "b"] }, status: "READY", deletedAt: null },
    { $inc: { bindingVersion: 1 } },
    { session },
  );
});
it("rejects a disappearing/deleting attachment so its entity transaction rolls back", async () => {
  vi.spyOn(Attachment, "updateMany").mockResolvedValue({
    matchedCount: 0,
  } as any);
  await expect(lockAttachments(["a"], session)).rejects.toMatchObject({
    statusCode: 409,
    code: "MEDIA_UNAVAILABLE",
  });
});
it("does not permit a nontransactional binding claim", async () => {
  const update = vi.spyOn(Attachment, "updateMany");
  await expect(
    lockAttachments(["a"], { inTransaction: () => false } as ClientSession),
  ).rejects.toThrow("active database transaction");
  expect(update).not.toHaveBeenCalled();
});
it("skips empty bindings", async () => {
  const update = vi.spyOn(Attachment, "updateMany");
  await lockAttachments([], session);
  expect(update).not.toHaveBeenCalled();
});
