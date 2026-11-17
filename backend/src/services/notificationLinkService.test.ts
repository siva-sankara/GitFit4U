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
it("reuses the committed purchase notification, exposes only a protected destination, and never returns the invite", async () => {
  vi.spyOn(Gym, "find").mockReturnValue({ select: () => ({ lean: async () => [{ _id: gymId, name: "Gym A", whatsappUpdates: { enabled: true, inviteUrl: "https://chat.whatsapp.com/PrivateToken" } }] }) } as never);
  const purchase = { _id: "notice", event: "membership.activated", gymId, entityId: "membership", dedupeKey: "membership.activated:membership:once", metadata: { membershipPurchaseConfirmed: true } };
  const [result] = await withNotificationLinks([purchase]);
  expect(result).toMatchObject({ actionUrl: "/notification-open/notice", dedupeKey: purchase.dedupeKey, message: expect.stringContaining("Your membership at Gym A is confirmed") });
  expect(JSON.stringify(result)).not.toContain("PrivateToken");
});
it("keeps purchase confirmation available when invitation lookup fails", async () => {
  vi.spyOn(Gym, "find").mockReturnValue({ select: () => ({ lean: async () => { throw new Error("temporary"); } }) } as never);
  const purchase = { _id: "notice", event: "membership.renewed", gymId, message: "Membership renewed", metadata: { membershipPurchaseConfirmed: true } };
  expect(await withNotificationLinks([purchase])).toEqual([{ ...purchase, actionUrl: "/notification-open/notice" }]);
});
it("does not display a looping view-details action for announcements", async () => {
  const [result] = await withNotificationLinks([{ _id: "notice", dedupeKey: "campaign:one", actionUrl: "/notifications" }]);
  expect(result.actionUrl).toBeUndefined();
});
