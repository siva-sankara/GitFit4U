import mongoose, { type PipelineStage } from "mongoose";
import { z } from "zod";
import { Payment } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { BankAccount, Settlement } from "../models/Business.js";
import { AppError } from "../utils/AppError.js";

export function revenueRange(from?: unknown, to?: unknown) {
  const date = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine(
      (v) =>
        Number.isFinite(Date.parse(v)) &&
        new Date(v).toISOString().startsWith(v),
      "Invalid calendar date",
    );
  const start = from ? new Date(date.parse(from)) : undefined;
  const end = to
    ? new Date(new Date(date.parse(to)).getTime() + 86400000)
    : undefined;
  if (start && end && start >= end)
    throw new AppError(
      422,
      "INVALID_DATE_RANGE",
      "End date must be on or after start date.",
    );
  return { ...(start ? { $gte: start } : {}), ...(end ? { $lt: end } : {}) };
}

// Refund states still represent captured receipts. Only completed refunds
// reduce the original receipt; pending or failed refunds must not erase it.
function capturedReceiptStages(
  match: Record<string, unknown>,
  timezone?: string,
): PipelineStage[] {
  return [
    {
      $match: {
        ...match,
        status: {
          $in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING"],
        },
      },
    },
    {
      $lookup: {
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
        as: "refunds",
      },
    },
    {
      $set: {
        refunded: { $ifNull: [{ $arrayElemAt: ["$refunds.amount", 0] }, 0] },
        ...(timezone
          ? {
              day: {
                $dateToString: {
                  date: "$capturedAt",
                  format: "%Y-%m-%d",
                  timezone,
                },
              },
            }
          : {}),
      },
    },
    { $set: { net: { $subtract: ["$amountMinor", "$refunded"] } } },
  ];
}

// This is payment volume across the application, not the platform's earnings.
// The cohort is payments captured in the current UTC month; all processed
// refunds of those receipts are deducted, regardless of their processing date.
export async function platformMonthlyReceipts(now = new Date()) {
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
  );
  const result = await Payment.aggregate([
    ...capturedReceiptStages({
      capturedAt: { $gte: monthStart, $lt: monthEnd },
    }),
    {
      $group: {
        _id: null,
        grossMinor: { $sum: "$amountMinor" },
        refundMinor: { $sum: "$refunded" },
        netMinor: { $sum: "$net" },
      },
    },
  ]);
  return {
    grossMinor: result[0]?.grossMinor || 0,
    refundMinor: result[0]?.refundMinor || 0,
    netMinor: result[0]?.netMinor || 0,
    currency: "INR",
    basis: "CAPTURED_PAYMENT_COHORT_NET_OF_PROCESSED_REFUNDS",
    scope: "PLATFORM_WIDE_PAYMENT_RECEIPTS_NOT_PLATFORM_EARNINGS",
    dateRangeTimezone: "UTC",
  };
}

// Cohort accounting: membership receipts in the chosen UTC date range, less
// processed refunds for those same receipts. Platform fees are not gym revenue.
export async function gymRevenue(gymId: string, from?: unknown, to?: unknown) {
  const range = revenueRange(from, to);
  const gym = await Gym.findById(gymId).select("timezone").lean();
  const timezone = gym?.timezone || "Asia/Kolkata";
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const month = `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
  const match = {
    gymId: new mongoose.Types.ObjectId(gymId),
    purpose: "MEMBERSHIP",
  };
  const [result, pending, settlements, bankAccount] = await Promise.all([
    Payment.aggregate([
      ...capturedReceiptStages(
        {
          ...match,
          ...(Object.keys(range).length ? { capturedAt: range } : {}),
        },
        timezone,
      ),
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                grossMinor: { $sum: "$amountMinor" },
                refundMinor: { $sum: "$refunded" },
                totalMinor: { $sum: "$net" },
                offlineMinor: {
                  $sum: {
                    $cond: [{ $eq: ["$provider", "OFFLINE"] }, "$net", 0],
                  },
                },
                onlineMinor: {
                  $sum: {
                    $cond: [{ $ne: ["$provider", "OFFLINE"] }, "$net", 0],
                  },
                },
                monthMinor: {
                  $sum: {
                    $cond: [
                      { $eq: [{ $substrBytes: ["$day", 0, 7] }, month] },
                      "$net",
                      0,
                    ],
                  },
                },
              },
            },
          ],
          series: [
            { $group: { _id: "$day", amountMinor: { $sum: "$net" } } },
            { $sort: { _id: 1 } },
            { $project: { _id: 0, date: "$_id", amountMinor: 1 } },
          ],
        },
      },
    ]),
    Payment.aggregate([
      {
        $match: {
          ...match,
          status: { $in: ["CREATED", "PENDING", "AUTHORIZED"] },
          ...(Object.keys(range).length ? { createdAt: range } : {}),
        },
      },
      { $group: { _id: null, amount: { $sum: "$amountMinor" } } },
    ]),
    Settlement.find({ gymId }).sort({ createdAt: -1 }).limit(50).lean(),
    BankAccount.findOne({ gymId }).lean(),
  ]);
  const totals = result[0]?.totals[0] || {};
  const { _id, ...values } = totals;
  return {
    grossMinor: 0,
    refundMinor: 0,
    totalMinor: 0,
    monthMinor: 0,
    offlineMinor: 0,
    onlineMinor: 0,
    ...values,
    netMinor: totals.totalMinor || 0,
    membershipMinor: totals.totalMinor || 0,
    pendingMinor: pending[0]?.amount || 0,
    currency: "INR",
    series: result[0]?.series || [],
    settlements,
    bankAccount,
    basis: "CAPTURED_MEMBERSHIP_COHORT_NET_OF_PROCESSED_REFUNDS",
    dateRangeTimezone: "UTC",
    groupingTimezone: timezone,
  };
}
