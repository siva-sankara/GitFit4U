import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  subscriptions: vi.fn(),
  platform: vi.fn(),
  attendance: vi.fn(),
  revenue: vi.fn(),
  classes: vi.fn(),
  gym: vi.fn(),
}));
vi.mock("../models/Member.js", () => ({
  MemberProfile: { countDocuments: mocks.members },
}));
vi.mock("../models/Commerce.js", () => ({
  MembershipPlan: {},
  Subscription: {
    countDocuments: mocks.subscriptions,
    findOne: mocks.platform,
  },
  Payment: {},
}));
vi.mock("../services/revenueService.js", () => ({
  gymRevenue: mocks.revenue,
}));
vi.mock("../models/Attendance.js", () => ({
  AttendanceEvent: { countDocuments: mocks.attendance },
}));
vi.mock("../models/Engagement.js", () => ({
  ClassSession: { countDocuments: mocks.classes },
  Campaign: {},
  Trainer: {},
}));
vi.mock("../models/Gym.js", () => ({ Gym: { findById: mocks.gym } }));
import { dashboard } from "./ownerController.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.members.mockResolvedValueOnce(10).mockResolvedValueOnce(8);
  mocks.subscriptions.mockResolvedValue(2);
  mocks.platform.mockReturnValue({
    sort: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }),
  });
  mocks.attendance.mockResolvedValue(4);
  mocks.revenue.mockResolvedValue({ monthMinor: 120_000 });
  mocks.classes.mockResolvedValue(3);
  mocks.gym.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
    }),
  });
});

it("returns real platform plan limits, gym usage and expiry to the owner", async () => {
  mocks.platform.mockReturnValue({
    sort: vi
      .fn()
      .mockReturnValue({
        lean: vi
          .fn()
          .mockResolvedValue({
            publicId: "platform-sub",
            status: "ACTIVE",
            planId: "plan-id",
            planSnapshot: { name: "Professional", memberLimit: 500 },
            endsAt: new Date(Date.now() + 7 * 86400000),
          }),
      }),
  });
  const res = { json: vi.fn() };
  await dashboard(
    {
      auth: {
        gymId: "507f1f77bcf86cd799439011",
        role: "GYM_OWNER",
        permissions: [],
      },
    } as any,
    res as any,
  );
  expect(res.json.mock.calls[0][0].data.platformSubscription).toMatchObject({
    publicId: "platform-sub",
    plan: { name: "Professional", memberLimit: 500 },
    usage: { members: 8, memberLimit: 500 },
    canRenew: true,
    renewalUrl: "/owner/platform-subscription",
  });
  expect(mocks.subscriptions).toHaveBeenCalledWith(expect.objectContaining({ type: "GYM_MEMBERSHIP" }));
});

describe("owner dashboard financial permissions", () => {
  const gymId = "507f1f77bcf86cd799439011";
  function request(role: "GYM_OWNER" | "GYM_STAFF", finance: boolean) {
    return {
      auth: {
        userId: "staff1",
        gymId,
        role,
        permissions: ["gym:read", ...(finance ? ["finance:read"] : [])],
      },
    } as unknown as Request;
  }
  it.each(["GYM_OWNER", "GYM_STAFF"] as const)(
    "excludes financial data for %s without finance access",
    async (role) => {
      const res = { json: vi.fn() };
      await dashboard(request(role, false), res as unknown as Response);
      expect(mocks.revenue).not.toHaveBeenCalled();
      const data = res.json.mock.calls[0][0].data;
      expect(data).not.toHaveProperty("monthlyRevenueMinor");
      expect(data).toMatchObject({
        gymStatus: "ACTIVE",
        totalMembers: 10,
        activeMembers: 8,
        todayAttendance: 4,
        classesToday: 3,
      });
      expect(mocks.members).toHaveBeenCalledWith({ gymId, status: "ACTIVE" });
    },
  );

  it.each(["GYM_OWNER", "GYM_STAFF"] as const)(
    "returns tenant-scoped revenue for %s with explicit finance access",
    async (role) => {
      const res = { json: vi.fn() };
      await dashboard(request(role, true), res as unknown as Response);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ monthlyRevenueMinor: 120_000 }),
        }),
      );
      expect(mocks.revenue).toHaveBeenCalledOnce();
      expect(mocks.revenue).toHaveBeenCalledWith(gymId);
    },
  );
});
