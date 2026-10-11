import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { Payment, ProviderEvent, Subscription } from "../models/Commerce.js";
import { Refund, Settlement } from "../models/Business.js";

// Read-only application inventory. Provider-dashboard obligations such as
// disputes, issued payment links, unsettled transfers and mandates are not
// inferred from MongoDB and must be checked with the original provider.
try {
  await mongoose.connect(env.MONGO_URI, {
    autoCreate: false,
    autoIndex: false,
    serverSelectionTimeoutMS: 10_000,
  });
  const [payments, unresolvedPayments, refunds, settlements, events, subscriptions] =
    await Promise.all([
      Payment.aggregate([
        {
          $group: {
            _id: {
              provider: { $ifNull: ["$provider", "UNSET_LEGACY"] },
              status: "$status",
              flow: { $ifNull: ["$flow", "$purpose"] },
            },
            count: { $sum: 1 },
            amountMinor: { $sum: "$amountMinor" },
          },
        },
        { $sort: { "_id.provider": 1, "_id.status": 1, "_id.flow": 1 } },
      ]),
      Payment.aggregate([
        { $match: { status: { $in: ["CREATED", "PENDING", "AUTHORIZED", "REFUND_PENDING", "DISPUTED"] } } },
        { $group: { _id: { provider: { $ifNull: ["$provider", "UNSET_LEGACY"] }, status: "$status" }, count: { $sum: 1 }, amountMinor: { $sum: "$amountMinor" } } },
        { $sort: { "_id.provider": 1, "_id.status": 1 } },
      ]),
      Refund.aggregate([
        { $match: { status: { $in: ["REQUESTED", "PROCESSING", "FAILED"] } } },
        { $group: { _id: { provider: { $ifNull: ["$provider", "UNSET_LEGACY"] }, status: "$status" }, count: { $sum: 1 }, amountMinor: { $sum: "$amountMinor" } } },
        { $sort: { "_id.provider": 1, "_id.status": 1 } },
      ]),
      Settlement.aggregate([
        { $match: { status: { $ne: "SETTLED" } } },
        { $group: { _id: { provider: { $ifNull: ["$provider", "UNSET_LEGACY"] }, status: "$status" }, count: { $sum: 1 }, netMinor: { $sum: "$netMinor" } } },
        { $sort: { "_id.provider": 1, "_id.status": 1 } },
      ]),
      ProviderEvent.aggregate([
        { $match: { status: { $in: ["RECEIVED", "PROCESSING", "FAILED"] } } },
        { $group: { _id: { provider: "$provider", status: "$status" }, count: { $sum: 1 } } },
        { $sort: { "_id.provider": 1, "_id.status": 1 } },
      ]),
      Subscription.aggregate([
        { $match: { status: "ACTIVE" } },
        { $group: { _id: "$type", count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]),
    ]);

  console.log(JSON.stringify({
    readOnly: true,
    payments,
    unresolvedPayments,
    unresolvedRefunds: refunds,
    unsettledSettlementRecords: settlements,
    unprocessedProviderEvents: events,
    activeSubscriptions: subscriptions,
    externalDashboardChecksRequired: [
      "provider disputes",
      "issued payment links",
      "unsettled provider transfers",
      "recurring mandates/subscriptions",
    ],
  }, null, 2));
} catch (error: any) {
  console.error(`Payment cutover inventory failed: ${error?.name || "Error"}. Connection details withheld.`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
