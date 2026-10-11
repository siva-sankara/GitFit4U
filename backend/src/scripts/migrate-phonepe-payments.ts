import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { Payment } from "../models/Commerce.js";
import { PaymentConnection, Settlement } from "../models/Business.js";

// Additive financial migration. Existing provider identities and recipient
// history are preserved; no transaction is rewritten as a PhonePe payment.
try {
  await connectDatabase();
  const payments = Payment.find({
    $or: [
      { flow: { $exists: false } },
      { providerEnvironment: { $exists: false } },
      { providerScopedOrderKey: { $exists: false } },
      { providerScopedPaymentKey: { $exists: false } },
    ],
  }).cursor();
  let updated = 0;
  for await (const payment of payments) {
    const provider = payment.provider || "RAZORPAY";
    const environment = provider === "OFFLINE" ? "OFFLINE" : "LEGACY";
    const merchant = payment.providerMerchantReference || "HISTORICAL_DEFAULT";
    const set: Record<string, unknown> = {
      flow:
        payment.purpose === "PLATFORM_PLAN"
          ? "PLATFORM_SUBSCRIPTION"
          : payment.purpose === "MEMBERSHIP"
            ? "GYM_MEMBERSHIP"
            : "ADVERTISEMENT",
      providerEnvironment: environment,
      providerMerchantReference: merchant,
      entitlementStatus: payment.status === "CAPTURED" ? "ACTIVE" : "PENDING",
      allocationStatus:
        payment.purpose === "PLATFORM_PLAN" ? "NOT_REQUIRED" : "REVIEW_REQUIRED",
      settlementStatus: "UNAVAILABLE",
    };
    if (payment.providerOrderId)
      set.providerScopedOrderKey = `${provider}:${environment}:${merchant}:${payment.providerOrderId}`;
    if (payment.providerPaymentId)
      set.providerScopedPaymentKey = `${provider}:${environment}:${merchant}:${payment.providerPaymentId}`;
    await Payment.updateOne({ _id: payment._id }, { $set: set });
    updated += 1;
  }

  const collection = mongoose.connection.collection("payments");
  const indexes = await collection.listIndexes().toArray().catch((error) => {
    if (error.code === 26) return [];
    throw error;
  });
  for (const oldName of ["providerOrderId_1", "providerPaymentId_1"]) {
    if (indexes.some((index) => index.name === oldName)) await collection.dropIndex(oldName);
  }
  await Payment.createIndexes();
  await PaymentConnection.createIndexes();
  await Settlement.createIndexes();
  console.log(`PhonePe payment schema prepared; ${updated} historical payment records safely backfilled.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "PhonePe payment migration failed");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
