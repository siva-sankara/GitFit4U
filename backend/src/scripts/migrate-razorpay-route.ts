import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { Payment } from "../models/Commerce.js";
import { PaymentConnection, RouteTransfer } from "../models/Business.js";

const apply = process.argv.includes("--apply");

try {
  await connectDatabase();
  const candidates = await Payment.countDocuments({
    status: "CAPTURED",
    subscriptionId: { $exists: true },
    fulfillmentStatus: { $exists: false },
  });
  const result = apply
    ? await Payment.updateMany(
        {
          status: "CAPTURED",
          subscriptionId: { $exists: true },
          fulfillmentStatus: { $exists: false },
        },
        { $set: { fulfillmentStatus: "APPLIED" } },
      )
    : null;

  if (apply) {
    await Payment.createIndexes();
    await PaymentConnection.createIndexes();
    await RouteTransfer.createIndexes();
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        capturedFulfillmentCandidates: candidates,
        capturedFulfillmentUpdated: result?.modifiedCount || 0,
        historicalProviderIdentitiesRewritten: 0,
        paymentConnectionsRewritten: 0,
      },
      null,
      2,
    ),
  );
} finally {
  await disconnectDatabase();
  await mongoose.disconnect().catch(() => undefined);
}
