import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  members: vi.fn(),
  subscriptions: vi.fn(),
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
  Subscription: { countDocuments: mocks.subscriptions },
  Payment: { aggregate: mocks.revenue },
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
  mocks.attendance.mockResolvedValue(4);
  mocks.revenue.mockResolvedValue([{ total: 120_000 }]);
  mocks.classes.mockResolvedValue(3);
  mocks.gym.mockReturnValue({
    select: vi
      .fn()
      .mockReturnValue({
        lean: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
      }),
  });
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
      const filter = mocks.revenue.mock.calls[0][0][0].$match;
      expect(String(filter.gymId)).toBe(gymId);
      expect(filter.status).toBe("CAPTURED");
    },
  );
});
