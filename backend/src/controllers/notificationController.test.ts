import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  find: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../models/Engagement.js", () => ({
  Notification: { updateMany: mocks.update, findOne: mocks.find },
}));
vi.mock("../services/auditService.js", () => ({ writeAudit: mocks.audit }));
import {
  deleteNotifications,
  notificationDetails,
} from "./notificationController.js";
const id = "aaaaaaaaaaaaaaaaaaaaaaaa";
const req = (body = {}, params = {}) =>
  ({ body, params, auth: { userId: "signed-in-user" } }) as any;
const res = () => ({ json: vi.fn() }) as any;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.update.mockResolvedValue({ modifiedCount: 1 });
});
it("soft deletes selected notifications scoped to the authenticated user and stops pending push", async () => {
  await deleteNotifications(req({ ids: [id] }), res());
  expect(mocks.update.mock.calls[0][0]).toEqual({
    userId: "signed-in-user",
    archivedAt: null,
    _id: { $in: [id] },
  });
  expect(mocks.update.mock.calls[0][1]).toMatchObject({
    $set: { archivedAt: expect.any(Date), pushStatus: "SKIPPED" },
  });
});
it("supports an individual notification without trusting caller ownership", async () => {
  await deleteNotifications(req({}, { id }), res());
  expect(mocks.update.mock.calls[0][0]).toMatchObject({
    userId: "signed-in-user",
    _id: { $in: [id] },
  });
});
it("requires explicit Delete All confirmation and disallows mass-assigned user IDs", async () => {
  await expect(
    deleteNotifications(req({ all: true }), res()),
  ).rejects.toThrow();
  await expect(
    deleteNotifications(
      req({ all: true, confirmed: true, userId: "victim" }),
      res(),
    ),
  ).rejects.toThrow();
  expect(mocks.update).not.toHaveBeenCalled();
});
it("deletes all inbox pages only for the signed-in account", async () => {
  await deleteNotifications(req({ all: true, confirmed: true }), res());
  expect(mocks.update.mock.calls[0][0]).toEqual({
    userId: "signed-in-user",
    archivedAt: null,
  });
});
it("does not return archived or another account's notification detail", async () => {
  mocks.find.mockReturnValue({ select: () => ({ lean: async () => null }) });
  await expect(
    notificationDetails(req({}, { id }), res()),
  ).rejects.toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
  expect(mocks.find).toHaveBeenCalledWith({
    _id: id,
    userId: "signed-in-user",
    archivedAt: null,
  });
});
