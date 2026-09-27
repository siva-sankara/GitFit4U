import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { MembershipPlan, Subscription } from "../models/Commerce.js";
import { listMembers } from "./ownerController.js";
vi.mock("../services/userMediaService.js", () => ({
  withUserMedia: vi.fn(async (rows) => rows),
  withTrainerMedia: vi.fn(async (rows) => rows),
  withMemberMedia: vi.fn(async (rows) => rows),
}));
const gymId = "507f1f77bcf86cd799439011";
function chain(value: unknown) {
  const result: any = { lean: vi.fn().mockResolvedValue(value) };
  for (const key of ["select", "populate", "sort", "skip", "limit"])
    result[key] = vi.fn().mockReturnValue(result);
  return result;
}
const response = () => ({ json: vi.fn() }) as any;
const req = (query: object = {}) =>
  ({
    query,
    auth: { gymId, role: "GYM_OWNER", permissions: ["member:read"] },
  }) as any;
beforeEach(() => {
  vi.spyOn(Gym, "findById").mockReturnValue(
    chain({ timezone: "Asia/Kolkata" }),
  );
  vi.spyOn(MemberProfile, "find").mockReturnValue(chain([]));
  vi.spyOn(MemberProfile, "countDocuments").mockResolvedValue(0);
  vi.spyOn(Subscription, "distinct").mockResolvedValue(["subscription-id"]);
  vi.spyOn(MembershipPlan, "findOne").mockReturnValue(
    chain({ _id: "507f1f77bcf86cd799439015", publicId: "gold-public" }),
  );
  vi.spyOn(User, "distinct").mockResolvedValue([]);
});
afterEach(() => vi.restoreAllMocks());
it("applies plan and trainer filters on the backend within the authorized gym", async () => {
  await listMembers(
    req({ planId: "gold-public", trainerId: "507f1f77bcf86cd799439012" }),
    response(),
  );
  expect(MembershipPlan.findOne).toHaveBeenCalledWith({
    gymId,
    publicId: "gold-public",
  });
  expect(Subscription.distinct).toHaveBeenCalledWith("_id", {
    gymId,
    type: "GYM_MEMBERSHIP",
    "planSnapshot.planId": "gold-public",
  });
  expect(MemberProfile.find).toHaveBeenCalledWith({
    gymId,
    assignedTrainerId: "507f1f77bcf86cd799439012",
    currentSubscriptionId: { $in: ["subscription-id"] },
  });
});
it("preserves the real plan predicate when Mongoose strictQuery casts the filter", async () => {
  await listMembers(req({ planId: "gold-public" }), response());
  const filter = vi.mocked(Subscription.distinct).mock.calls[0][1];
  const query = Subscription.find(filter).setOptions({ strictQuery: true });
  query.cast(Subscription);
  expect(query.getFilter()).toHaveProperty("planSnapshot.planId", "gold-public");
  expect(query.getFilter()).not.toHaveProperty("planId");
});
it("includes direct access in active filters but excludes deactivated profiles", async () => {
  await listMembers(req({ membershipStatus: "ACTIVE" }), response());
  expect(MemberProfile.find).toHaveBeenCalledWith(expect.objectContaining({
    $and: [
      { status: { $nin: ["INACTIVE", "ARCHIVED", "SUSPENDED"] } },
      { $or: [{ currentSubscriptionId: { $in: ["subscription-id"] } }, { currentSubscriptionId: null, directAccess: true }] },
    ],
  }));
});
it("includes deactivated profiles regardless of their historical subscription status", async () => {
  await listMembers(req({ membershipStatus: "DEACTIVATED" }), response());
  expect(MemberProfile.find).toHaveBeenCalledWith(expect.objectContaining({
    $and: [{ $or: [{ status: { $in: ["INACTIVE", "SUSPENDED"] } }, { status: { $ne: "ARCHIVED" }, currentSubscriptionId: { $in: ["subscription-id"] } }] }],
  }));
});
it("keeps cancellation distinct from reversible member deactivation", async () => {
  await listMembers(req({ membershipStatus: "CANCELLED" }), response());
  expect(MemberProfile.find).toHaveBeenCalledWith(expect.objectContaining({
    $and: [{ $or: [{ status: "ARCHIVED" }, { status: { $nin: ["INACTIVE", "SUSPENDED"] }, currentSubscriptionId: { $in: ["subscription-id"] } }] }],
  }));
});
it("does not include already-expired grace subscriptions in the grace filter", async () => {
  await listMembers(req({ membershipStatus: "GRACE" }), response());
  expect(Subscription.distinct).toHaveBeenCalledWith("_id", expect.objectContaining({
    status: "GRACE", endsAt: { $gte: expect.any(Date) },
  }));
});
it("filters expiring memberships from their real expiry dates rather than a stored label", async () => {
  const res = response();
  await listMembers(
    req({ membershipStatus: "EXPIRING", trainerId: "none" }),
    res,
  );
  expect(Subscription.distinct).toHaveBeenCalledWith(
    "_id",
    expect.objectContaining({
      gymId,
      status: "ACTIVE",
      endsAt: { $gte: expect.any(Date), $lt: expect.any(Date) },
    }),
  );
  expect(MemberProfile.find).toHaveBeenCalledWith(
    expect.objectContaining({ assignedTrainerId: null }),
  );
  expect(res.json.mock.calls[0][0].meta).toMatchObject({
    timezone: "Asia/Kolkata",
    serverNow: expect.any(String),
  });
});
it("rejects query-operator injection and unknown member statuses", async () => {
  await expect(
    listMembers(req({ status: { $ne: "ARCHIVED" } }), response()),
  ).rejects.toThrow();
  await expect(
    listMembers(req({ membershipStatus: "made-up" }), response()),
  ).rejects.toThrow();
  expect(MemberProfile.find).not.toHaveBeenCalled();
});
it("escapes search regex metacharacters so user input is a literal search", async () => {
  await listMembers(req({ q: "a.*(b)" }), response());
  const query = vi.mocked(User.distinct).mock.calls[0][1] as any;
  expect(query.$or[0].name.test("aZZb")).toBe(false);
  expect(query.$or[0].name.test("a.*(b)")).toBe(true);
});
