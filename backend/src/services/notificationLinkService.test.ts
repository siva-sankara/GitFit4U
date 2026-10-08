import { afterEach, expect, it, vi } from "vitest";
import { Gym } from "../models/Gym.js";
import { withNotificationLinks } from "./notificationLinkService.js";
afterEach(() => vi.restoreAllMocks());
const gymId = "507f1f77bcf86cd799439011";
it("upgrades old reminders using a batched trusted gym lookup, preserving immutable event identities", async () => {
  const find = vi.spyOn(Gym, "find").mockReturnValue({ select: () => ({ lean: async () => [{ _id: gymId, publicId: "target-gym" }] }) } as never);
  const old = { _id: "notification", event: "platform.expiring", gymId, actionUrl: "/owner/platform-subscription", dedupeKey: "unchanged", metadata: { gymPublicId: "untrusted-metadata" } };
  const results = await withNotificationLinks([old, { ...old, _id: "second" }]);
  expect(find).toHaveBeenCalledTimes(1);
  expect(find).toHaveBeenCalledWith({ _id: { $in: [gymId] }, deletedAt: null });
  expect(results[0]).toEqual({ ...old, actionUrl: "/notification-open/notification" });
  expect(old.actionUrl).toBe("/owner/platform-subscription");
});
it("falls back to the inbox when a historical gym no longer exists rather than choosing the active gym", async () => {
  vi.spyOn(Gym, "find").mockReturnValue({ select: () => ({ lean: async () => [] }) } as never);
  const [result] = await withNotificationLinks([{ event: "platform.expiring", gymId, actionUrl: "/owner/platform-subscription" }]);
  expect(result.actionUrl).toBe("/notifications");
});
it("leaves already-bound and unrelated notifications unchanged without database work", async () => {
  const find = vi.spyOn(Gym, "find");
  const rows = [{ event: "platform.expiring", actionUrl: "/platform-renewal?gym=target" }, { event: "admin.announcement", actionUrl: "/owner/platform-subscription" }];
  expect(await withNotificationLinks(rows)).toEqual(rows);
  expect(find).not.toHaveBeenCalled();
});
