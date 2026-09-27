import { afterEach, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { Campaign, Notification } from "../models/Engagement.js";
import { User } from "../models/User.js";
import { deliverCampaignBatch } from "./campaignDeliveryService.js";
vi.mock("../config/logger.js", () => ({ logger: { error: vi.fn() } }));
afterEach(() => vi.restoreAllMocks());
const cutoff = new Date("2026-09-26T10:00:00Z");
function setup() {
  const campaign = {
    _id: new mongoose.Types.ObjectId(),
    publicId: "broadcast-one",
    scope: "PLATFORM",
    audience: { roles: ["USER", "GYM_OWNER"] },
    audienceSnapshot: { createdBefore: cutoff },
    name: "Notice",
    message: "Platform notice",
  };
  const lease = vi
    .spyOn(Campaign, "findOneAndUpdate")
    .mockResolvedValue(campaign as never);
  const update = vi.spyOn(Campaign, "updateOne").mockResolvedValue({} as never);
  vi.spyOn(Notification, "countDocuments").mockResolvedValue(100 as never);
  const batch = Array.from({ length: 100 }, () => ({
    _id: new mongoose.Types.ObjectId(),
    notificationPreferences: { push: false },
  }));
  const query = {
    sort: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    lean: vi.fn().mockResolvedValue(batch),
  };
  const users = vi.spyOn(User, "find").mockReturnValue(query as never);
  const notifications = vi
    .spyOn(Notification, "bulkWrite")
    .mockResolvedValue({} as never);
  return { campaign, lease, update, batch, query, users, notifications };
}
it("leases and delivers a bounded batch with stable per-user dedupe and preference-aware channels", async () => {
  const { campaign, lease, update, batch, query, users, notifications } =
    setup();
  expect(await deliverCampaignBatch()).toBe(true);
  expect(query.limit).toHaveBeenCalledWith(100);
  expect(users).toHaveBeenCalledWith({
    status: "ACTIVE",
    roles: { $in: ["USER", "GYM_OWNER"] },
    createdAt: { $lte: cutoff },
  });
  const operations: any = notifications.mock.calls[0][0];
  expect(operations).toHaveLength(100);
  expect(operations[0].updateOne.filter).toEqual({
    userId: batch[0]._id,
    dedupeKey: "campaign:broadcast-one",
  });
  expect(operations[0].updateOne.update.$setOnInsert.channels).toEqual([
    "IN_APP",
  ]);
  expect(operations[0].updateOne.upsert).toBe(true);
  expect(lease.mock.calls[0][0]).toHaveProperty("$and");
  expect(update.mock.calls[0][0]).toMatchObject({
    _id: campaign._id,
    leaseId: expect.any(String),
  });
  expect(update.mock.calls[0][1]).toMatchObject({
    $set: { deliveryCursor: batch[99]._id, "analytics.delivered": 100 },
  });
});
it("retains the delivery cursor after failure so retries use identical recipient keys", async () => {
  const { notifications, update } = setup();
  notifications.mockRejectedValue(new Error("Transient database failure"));
  await deliverCampaignBatch();
  const change: any = update.mock.calls[0][1];
  expect(change.$set.status).toBe("QUEUED");
  expect(change.$set.deliveryCursor).toBeUndefined();
  expect(change.$set.leaseUntil).toBeInstanceOf(Date);
});
it("does no delivery work if another worker holds the lease", async () => {
  const { lease, users, notifications } = setup();
  lease.mockResolvedValue(null);
  expect(await deliverCampaignBatch()).toBe(false);
  expect(users).not.toHaveBeenCalled();
  expect(notifications).not.toHaveBeenCalled();
});
