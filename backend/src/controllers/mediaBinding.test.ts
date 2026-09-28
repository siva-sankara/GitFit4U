import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../services/auditService.js", () => ({ writeAudit: vi.fn() }));
vi.mock("../services/domainEventService.js", () => ({ emitDomainEvent: vi.fn() }));
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { Attachment } from "../models/Business.js";
import { SocialPost, SocialStory } from "../models/Social.js";
import { Conversation, Message } from "../models/Collaboration.js";
import { updateProfile } from "./userController.js";
import { updateGym } from "./ownerController.js";
import { saveContent } from "./socialController.js";
import { sendMessage } from "./messagingController.js";
import { emitDomainEvent } from "../services/domainEventService.js";

const userId = "507f1f77bcf86cd799439011", gymId = "507f1f77bcf86cd799439012", fileId = "507f1f77bcf86cd799439013";
const session = { inTransaction: () => true };
function query(value: any) {
  const promise = Promise.resolve(value);
  const result: any = { session: vi.fn(() => result), populate: vi.fn(() => result), lean: vi.fn(async () => value), then: promise.then.bind(promise) };
  return result;
}
function req(body: any, extra: any = {}) {
  return { body, method: "POST", params: {}, auth: { userId, gymId, role: "USER", permissions: [] }, app: { get: () => undefined }, ...extra } as any;
}
function res() { const response: any = { json: vi.fn(), status: vi.fn(() => response) }; return response; }
let transaction: any, lock: any;
beforeEach(() => {
  vi.clearAllMocks();
  transaction = vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (callback: any) => callback(session));
  lock = vi.spyOn(Attachment, "updateMany").mockResolvedValue({ matchedCount: 1 } as never);
  vi.spyOn(Attachment, "findOne").mockReturnValue(query({ _id: fileId, mimeType: "image/png" }));
});
afterEach(() => vi.restoreAllMocks());

it("serializes avatar validation, the shared attachment lock and account update in one session", async () => {
  const update = vi.spyOn(User, "findByIdAndUpdate").mockReturnValue(query({ _id: userId }));
  await updateProfile(req({ avatarAttachmentId: fileId }), res());
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(lock).toHaveBeenCalledWith(expect.objectContaining({ _id: { $in: [fileId] }, status: "READY", deletedAt: null }), { $inc: { bindingVersion: 1 } }, { session });
  expect(update.mock.calls[0][2]).toMatchObject({ session });
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
});
it("does not write an avatar reference if deletion wins after its validation", async () => {
  lock.mockResolvedValue({ matchedCount: 0 });
  const update = vi.spyOn(User, "findByIdAndUpdate");
  await expect(updateProfile(req({ avatarAttachmentId: fileId }), res())).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE", statusCode: 409 });
  expect(update).not.toHaveBeenCalled();
});
it("preserves invalid-avatar validation status without attempting a lock", async () => {
  vi.spyOn(Attachment, "findOne").mockReturnValue(query(null));
  await expect(updateProfile(req({ avatarAttachmentId: fileId }), res())).rejects.toMatchObject({ code: "IMAGE_UNAVAILABLE", statusCode: 422 });
  expect(lock).not.toHaveBeenCalled();
});
it.each(["posts", "stories"])("binds a new %s image and its entity creation in one transaction", async (kind) => {
  const model = kind === "stories" ? SocialStory : SocialPost;
  const create = vi.spyOn(model, "create").mockResolvedValue([{ publicId: "content" }] as never);
  await saveContent(req({ text: "An update", attachmentIds: [fileId] }, { params: { kind } }), res());
  expect(create).toHaveBeenCalledWith([expect.objectContaining({ attachmentIds: [fileId], authorId: userId })], { session });
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
});
it("uses the same transaction for an edited post's ownership read and attachment save", async () => {
  const record = { text: "Old", attachmentIds: [], save: vi.fn() }, found = query(record);
  const find = vi.spyOn(SocialPost, "findOne").mockReturnValue(found);
  await saveContent(req({ text: "Edited", attachmentIds: [fileId] }, { method: "PATCH", params: { kind: "posts", contentId: "post" } }), res());
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ authorId: userId, deletedAt: null }));
  expect(found.session).toHaveBeenCalledWith(session);
  expect(record.save).toHaveBeenCalledWith({ session });
});
it("does not create a post when deletion wins the shared attachment lock", async () => {
  lock.mockResolvedValue({ matchedCount: 0 });
  const create = vi.spyOn(SocialPost, "create");
  await expect(saveContent(req({ text: "Update", attachmentIds: [fileId] }, { params: { kind: "posts" } }), res())).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
  expect(create).not.toHaveBeenCalled();
});
it("locks owner gallery and logo references before the gym mutation", async () => {
  const galleryId = "507f1f77bcf86cd799439014";
  vi.spyOn(Gym, "findById").mockReturnValue(query({ mediaAttachmentIds: [] }));
  vi.spyOn(Attachment, "exists").mockReturnValue(query({ _id: fileId }));
  vi.spyOn(Attachment, "find").mockReturnValue(query([{ _id: galleryId, mimeType: "image/png" }]));
  lock.mockResolvedValue({ matchedCount: 2 });
  const update = vi.spyOn(Gym, "findOneAndUpdate").mockReturnValue(query({ publicId: "gym" }));
  await updateGym(req({ logoAttachmentId: fileId, mediaAttachmentIds: [galleryId], coverAttachmentId: galleryId }), res());
  expect(lock.mock.calls[0][0]._id.$in).toEqual([fileId, galleryId]);
  expect(update.mock.calls[0][2]).toMatchObject({ session });
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(update.mock.invocationCallOrder[0]);
});
it("keeps ordinary profile and text-only social saves outside a transaction", async () => {
  vi.spyOn(User, "findByIdAndUpdate").mockReturnValue(query({ _id: userId }));
  vi.spyOn(SocialPost, "create").mockResolvedValue({ publicId: "post" } as never);
  await updateProfile(req({ name: "Updated Name" }), res());
  await saveContent(req({ text: "Text only" }, { params: { kind: "posts" } }), res());
  expect(transaction).not.toHaveBeenCalled();
  expect(lock).not.toHaveBeenCalled();
});
function messageFixture() {
  vi.spyOn(Conversation, "findOne").mockImplementation(() => query({ _id: "conversation-id", publicId: "conversation", type: "DIRECT", participants: [userId, "recipient"] }));
  vi.spyOn(Attachment, "find").mockReturnValue(query([{ _id: fileId, publicId: "file-public", objectKey: "object-key", originalName: "image.png", mimeType: "image/png", size: 40 }]));
  vi.spyOn(Conversation, "updateOne").mockResolvedValue({} as never);
  return req({ clientMessageId: "draft", text: "Photo", attachments: [{ key: "file-public" }] }, { params: { id: "conversation" } });
}
it("locks validated message attachments before insertion and notifies only after commit", async () => {
  let committed = false;
  transaction.mockImplementation(async (callback: any) => { const result = await callback(session); committed = true; return result; });
  vi.mocked(emitDomainEvent).mockImplementation(async () => { expect(committed).toBe(true); return undefined; });
  const request = messageFixture();
  const create = vi.spyOn(Message, "create").mockResolvedValue([{ _id: "message-id", publicId: "message", createdAt: new Date() }] as never);
  await sendMessage(request, res());
  expect(create).toHaveBeenCalledWith([expect.objectContaining({ attachments: [expect.objectContaining({ key: "file-public" })] })], { session });
  expect(lock.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0]);
  expect(emitDomainEvent).toHaveBeenCalled();
});
it("does not insert a message or notify recipients when concurrent deletion wins", async () => {
  const request = messageFixture();
  lock.mockResolvedValue({ matchedCount: 0 });
  const create = vi.spyOn(Message, "create");
  await expect(sendMessage(request, res())).rejects.toMatchObject({ code: "MEDIA_UNAVAILABLE" });
  expect(create).not.toHaveBeenCalled();
  expect(emitDomainEvent).not.toHaveBeenCalled();
});
