import { afterEach, expect, it, vi } from "vitest";
import { MemberProfile } from "../models/Member.js";
import { Subscription } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { memberClassScope } from "./memberClassAccessService.js";
const chain = (value: unknown): any => ({ select: vi.fn().mockReturnThis(), lean: vi.fn().mockResolvedValue(value) });
const now = new Date("2026-09-28T10:00:00Z"), endsAt = new Date("2026-10-01T00:00:00Z");
afterEach(() => vi.restoreAllMocks());
it("returns a deny-all scope without querying gyms when the user has no active member relationship", async () => {
  vi.spyOn(MemberProfile, "find").mockReturnValue(chain([]));
  const gyms = vi.spyOn(Gym, "find");
  expect(await memberClassScope("user", { now })).toEqual({ filter: { _id: { $in: [] } }, eligibleGymCount: 0 });
  expect(MemberProfile.find).toHaveBeenCalledWith({ userId: "user", status: "ACTIVE", "invitation.status": { $ne: "PENDING" } });
  expect(gyms).not.toHaveBeenCalled();
});
it("requires the user's currently active subscription, current cycle and matching member/gym tuple", async () => {
  vi.spyOn(MemberProfile, "find").mockReturnValue(chain([{ _id: "member", gymId: "gym", currentSubscriptionId: "current" }]));
  vi.spyOn(Subscription, "find").mockReturnValue(chain([]));
  const gyms = vi.spyOn(Gym, "find");
  expect((await memberClassScope("user", { now })).eligibleGymCount).toBe(0);
  expect(Subscription.find).toHaveBeenCalledWith({ userId: "user", type: "GYM_MEMBERSHIP", status: "ACTIVE",
    startsAt: { $lte: now }, endsAt: { $gt: now }, $or: [{ memberProfileId: "member", gymId: "gym", _id: "current" }] });
  expect(gyms).not.toHaveBeenCalled();
});
function eligible() {
  vi.spyOn(MemberProfile, "find").mockReturnValue(chain([{ _id: "member", gymId: "gym" }]));
  vi.spyOn(Subscription, "find").mockReturnValue(chain([{ gymId: "gym", startsAt: new Date("2026-09-01"), endsAt }]));
  vi.spyOn(Gym, "find").mockReturnValue(chain([{ _id: "gym", timezone: "Asia/Kolkata" }]));
}
it("intersects a forged gym filter instead of expanding membership scope", async () => {
  eligible();
  expect(await memberClassScope("user", { now, gymId: "other" })).toEqual({ filter: { _id: { $in: [] } }, eligibleGymCount: 1 });
  expect(Gym.find).toHaveBeenCalledWith(expect.objectContaining({ _id: { $in: ["gym"] }, deletedAt: null }));
});
it("constrains date, search and full class duration to eligible subscription windows", async () => {
  eligible();
  const scope = await memberClassScope("user", { now, from: new Date("2020-01-01"), day: "2026-09-28", search: ".*" });
  expect(scope).toMatchObject({ eligibleGymCount: 1, filter: { status: "SCHEDULED", name: { $regex: "\\.\\*", $options: "i" },
    $or: [{ gymId: "gym", startsAt: { $gte: now, $lt: new Date("2026-09-28T18:30:00Z") }, endsAt: { $lte: endsAt } }] } });
});
it("propagates membership lookup failure without trying a public/all-gym fallback", async () => {
  vi.spyOn(MemberProfile, "find").mockReturnValue({ select: vi.fn().mockReturnThis(), lean: vi.fn().mockRejectedValue(new Error("unavailable")) } as any);
  const gyms = vi.spyOn(Gym, "find");
  await expect(memberClassScope("user", { now })).rejects.toThrow("unavailable");
  expect(gyms).not.toHaveBeenCalled();
});
