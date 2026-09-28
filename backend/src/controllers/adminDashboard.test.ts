import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  gyms: vi.fn(),
  registrations: vi.fn(),
  users: vi.fn(),
  subscriptions: vi.fn(),
  payments: vi.fn(),
  receipts: vi.fn(),
}));
vi.mock("../models/Gym.js", () => ({ Gym: { countDocuments: mocks.gyms } }));
vi.mock("../models/GymRegistration.js", () => ({
  GymRegistration: { countDocuments: mocks.registrations },
}));
vi.mock("../models/User.js", () => ({ User: { countDocuments: mocks.users } }));
vi.mock("../models/Commerce.js", () => ({
  MembershipPlan: {},
  Payment: { countDocuments: mocks.payments },
  PlatformPlan: {},
  Subscription: { countDocuments: mocks.subscriptions },
}));
vi.mock("../services/revenueService.js", () => ({
  platformMonthlyReceipts: mocks.receipts,
}));
vi.mock("../services/domainEventService.js", () => ({
  emitDomainEvent: vi.fn(),
}));
import { dashboard } from "./adminController.js";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2027-01-01T00:15:00Z"));
  mocks.gyms.mockResolvedValueOnce(8).mockResolvedValueOnce(6);
  mocks.registrations.mockResolvedValue(2);
  mocks.users.mockResolvedValueOnce(8).mockResolvedValueOnce(100);
  mocks.subscriptions.mockResolvedValue(70);
  mocks.payments.mockResolvedValue(3);
  mocks.receipts.mockResolvedValue({
    grossMinor: 15000,
    refundMinor: 3000,
    netMinor: 12000,
    basis: "CAPTURED_PAYMENT_COHORT_NET_OF_PROCESSED_REFUNDS",
    scope: "PLATFORM_WIDE_PAYMENT_RECEIPTS_NOT_PLATFORM_EARNINGS",
    dateRangeTimezone: "UTC",
  });
});
afterEach(() => vi.useRealTimers());

describe("admin dashboard receipt accounting", () => {
  it("uses centralized refund-net payment volume while preserving platform counters", async () => {
    const res = { json: vi.fn() };
    await dashboard({} as Request, res as unknown as Response);
    expect(mocks.receipts).toHaveBeenCalledWith(
      new Date("2027-01-01T00:15:00Z"),
    );
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        totalGyms: 8,
        activeGyms: 6,
        awaitingPaymentGyms: 2,
        totalOwners: 8,
        totalUsers: 100,
        activeSubscriptions: 70,
        monthlyRevenueMinor: 12000,
        monthlyGrossReceiptsMinor: 15000,
        monthlyCohortRefundsMinor: 3000,
        monthlyRevenueBasis: "CAPTURED_PAYMENT_COHORT_NET_OF_PROCESSED_REFUNDS",
        monthlyRevenueScope:
          "PLATFORM_WIDE_PAYMENT_RECEIPTS_NOT_PLATFORM_EARNINGS",
        monthlyRevenueTimezone: "UTC",
        failedPayments: 3,
      },
    });
    expect(mocks.payments).toHaveBeenCalledWith({
      status: "FAILED",
      createdAt: {
        $gte: new Date("2027-01-01T00:00:00Z"),
        $lt: new Date("2027-02-01T00:00:00Z"),
      },
    });
  });
});
