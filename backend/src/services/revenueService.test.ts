import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  gym: vi.fn(),
  settlements: vi.fn(),
  bankAccount: vi.fn(),
}));
vi.mock("../models/Commerce.js", () => ({
  Payment: { aggregate: mocks.aggregate },
}));
vi.mock("../models/Gym.js", () => ({ Gym: { findById: mocks.gym } }));
vi.mock("../models/Business.js", () => ({
  Settlement: { find: mocks.settlements },
  BankAccount: { findOne: mocks.bankAccount },
}));
import {
  gymRevenue,
  platformMonthlyReceipts,
  revenueRange,
  revenuePeriod,
} from "./revenueService.js";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gym.mockReturnValue({
    select: vi.fn().mockReturnValue({
      lean: vi.fn().mockResolvedValue({ timezone: "Asia/Kolkata" }),
    }),
  });
  mocks.settlements.mockReturnValue({
    sort: vi.fn().mockReturnValue({
      limit: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue([]) }),
    }),
  });
  mocks.bankAccount.mockReturnValue({ lean: vi.fn().mockResolvedValue(null) });
});
describe("revenue date boundaries", () => {
  it("uses an exclusive next-day bound for an inclusive calendar end", () => {
    const value = revenueRange("2026-09-01", "2026-09-30");
    expect(value.$gte?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(value.$lt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("rejects impossible dates and reversed ranges", () => {
    expect(() => revenueRange("2026-02-30")).toThrow();
    expect(() => revenueRange("2026-10-01", "2026-09-01")).toThrow();
  });
  it("does not invent a range when no filters were provided", () =>
    expect(revenueRange()).toEqual({}));
});

describe("gym revenue accounting", () => {
  const gymId = "507f1f77bcf86cd799439011";
  it("uses the same tenant-scoped refund-net membership totals for every consumer", async () => {
    mocks.aggregate
      .mockResolvedValueOnce([
        {
          totals: [
            {
              _id: null,
              grossMinor: 15000,
              refundMinor: 3000,
              totalMinor: 12000,
              offlineMinor: 8000,
              onlineMinor: 4000,
              monthMinor: 9000,
            },
          ],
          series: [{ date: "2026-09-01", amountMinor: 12000 }],
        },
      ])
      .mockResolvedValueOnce([{ amount: 2000 }]);

    const report = await gymRevenue(gymId, "2026-09-01", "2026-09-30");

    expect(report).toMatchObject({
      grossMinor: 15000,
      refundMinor: 3000,
      totalMinor: 12000,
      netMinor: 12000,
      membershipMinor: 12000,
      offlineMinor: 8000,
      onlineMinor: 4000,
      monthMinor: 9000,
      pendingMinor: 2000,
      currency: "INR",
      dateRangeTimezone: "Asia/Kolkata",
      groupingTimezone: "Asia/Kolkata",
      series: [{ date: "2026-09-01", amountMinor: 12000 }],
    });
    expect(report).not.toHaveProperty("_id");
    expect(mocks.gym).toHaveBeenCalledWith(gymId);
    expect(mocks.settlements).toHaveBeenCalledWith({ gymId });
    expect(mocks.bankAccount).toHaveBeenCalledWith({ gymId });
    const receiptPipeline = mocks.aggregate.mock.calls[0][0];
    const receiptMatch = receiptPipeline[0].$match;
    expect(String(receiptMatch.gymId)).toBe(gymId);
    expect(receiptMatch).toMatchObject({
      purpose: "MEMBERSHIP",
      status: {
        $in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING"],
      },
      capturedAt: {
        $gte: new Date("2026-08-31T18:30:00Z"),
        $lt: new Date("2026-09-30T18:30:00Z"),
      },
    });
    expect(receiptPipeline[1].$lookup).toMatchObject({
      from: "refunds",
      let: { paymentId: "$_id" },
      pipeline: [
        {
          $match: {
            $expr: { $eq: ["$paymentId", "$$paymentId"] },
            status: "PROCESSED",
          },
        },
        { $group: { _id: null, amount: { $sum: "$amountMinor" } } },
      ],
    });
    expect(receiptPipeline[3].$set.net).toEqual({
      $subtract: ["$amountMinor", "$refunded"],
    });
    const pendingMatch = mocks.aggregate.mock.calls[1][0][0].$match;
    expect(String(pendingMatch.gymId)).toBe(gymId);
    expect(pendingMatch).toMatchObject({
      purpose: "MEMBERSHIP",
      status: { $in: ["CREATED", "PENDING", "AUTHORIZED"] },
      createdAt: receiptMatch.capturedAt,
    });
  });

  it("returns explicit zeros when the gym has no receipts or pending payments", async () => {
    mocks.aggregate
      .mockResolvedValueOnce([{ totals: [], series: [] }])
      .mockResolvedValueOnce([]);
    const report = await gymRevenue(gymId);
    expect(report).toMatchObject({
      grossMinor: 0,
      refundMinor: 0,
      totalMinor: 0,
      netMinor: 0,
      monthMinor: 0,
      membershipMinor: 0,
      offlineMinor: 0,
      onlineMinor: 0,
      pendingMinor: 0,
      series: [],
    });
    expect(mocks.aggregate.mock.calls[0][0][0].$match).not.toHaveProperty(
      "capturedAt",
    );
  });
});

describe("gym-local period selection", () => {
  it("includes seven calendar days ending today in the gym timezone", () => {
    const selected = revenuePeriod(
      "7d",
      "Asia/Kolkata",
      new Date("2026-09-27T20:00:00Z"),
    );
    expect(selected).toMatchObject({ from: "2026-09-22", to: "2026-09-28" });
    expect(selected.range.$gte?.toISOString()).toBe("2026-09-21T18:30:00.000Z");
    expect(selected.range.$lt?.toISOString()).toBe("2026-09-28T18:30:00.000Z");
  });
  it("handles year boundaries in last-month and quarter views", () => {
    const now = new Date("2026-01-16T10:00:00Z");
    expect(revenuePeriod("last-month", "UTC", now)).toMatchObject({
      from: "2025-12-01",
      to: "2025-12-31",
    });
    expect(revenuePeriod("3m", "UTC", now)).toMatchObject({
      from: "2025-11-01",
      to: "2026-01-16",
    });
  });
  it("uses a 23-hour day during a daylight-saving transition", () => {
    const range = revenueRange("2026-03-08", "2026-03-08", "America/New_York");
    expect(range.$lt!.getTime() - range.$gte!.getTime()).toBe(23 * 3600000);
  });
  it("rejects unknown period values rather than returning unfiltered revenue", () =>
    expect(() => revenuePeriod("unsupported", "UTC")).toThrow());
});

describe("platform-wide captured payment receipts", () => {
  it.each([
    { refundMinor: 0, netMinor: 10000 },
    { refundMinor: 3000, netMinor: 7000 },
    { refundMinor: 10000, netMinor: 0 },
  ])(
    "reports gross less processed refunds ($refundMinor) without implying platform earnings",
    async ({ refundMinor, netMinor }) => {
      mocks.aggregate.mockResolvedValue([
        { grossMinor: 10000, refundMinor, netMinor },
      ]);
      const report = await platformMonthlyReceipts(
        new Date("2026-09-15T12:00:00Z"),
      );
      expect(report).toEqual({
        grossMinor: 10000,
        refundMinor,
        netMinor,
        currency: "INR",
        basis: "CAPTURED_PAYMENT_COHORT_NET_OF_PROCESSED_REFUNDS",
        scope: "PLATFORM_WIDE_PAYMENT_RECEIPTS_NOT_PLATFORM_EARNINGS",
        dateRangeTimezone: "UTC",
      });
      const pipeline = mocks.aggregate.mock.calls[0][0];
      expect(pipeline[0].$match).toEqual({
        capturedAt: {
          $gte: new Date("2026-09-01"),
          $lt: new Date("2026-10-01"),
        },
        status: {
          $in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING"],
        },
      });
      expect(pipeline[1].$lookup.pipeline[0].$match).toEqual({
        $expr: { $eq: ["$paymentId", "$$paymentId"] },
        status: "PROCESSED",
      });
      expect(pipeline[2].$set.refunded).toEqual({
        $ifNull: [{ $arrayElemAt: ["$refunds.amount", 0] }, 0],
      });
      expect(pipeline[3].$set.net).toEqual({
        $subtract: ["$amountMinor", "$refunded"],
      });
      expect(pipeline[4].$group).toEqual({
        _id: null,
        grossMinor: { $sum: "$amountMinor" },
        refundMinor: { $sum: "$refunded" },
        netMinor: { $sum: "$net" },
      });
      expect(mocks.gym).not.toHaveBeenCalled();
      expect(mocks.settlements).not.toHaveBeenCalled();
      expect(mocks.bankAccount).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      "2026-12-31T23:59:59-05:00",
      "2027-01-01T00:00:00Z",
      "2027-02-01T00:00:00Z",
    ],
    [
      "2026-09-01T00:30:00+05:30",
      "2026-08-01T00:00:00Z",
      "2026-09-01T00:00:00Z",
    ],
  ])(
    "uses UTC month boundaries even when input time crosses a local month boundary: %s",
    async (now, start, end) => {
      mocks.aggregate.mockResolvedValue([]);
      await platformMonthlyReceipts(new Date(now));
      expect(mocks.aggregate.mock.calls[0][0][0].$match.capturedAt).toEqual({
        $gte: new Date(start),
        $lt: new Date(end),
      });
    },
  );

  it("returns explicit zeros when the current month has no captured receipts", async () => {
    mocks.aggregate.mockResolvedValue([]);
    expect(await platformMonthlyReceipts()).toMatchObject({
      grossMinor: 0,
      refundMinor: 0,
      netMinor: 0,
    });
  });
});
