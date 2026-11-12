import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { PaymentConnection, PaymentOAuthState, RouteTransfer } from "../models/Business.js";
import { Payment, ProviderEvent } from "../models/Commerce.js";

const apply = process.argv.includes("--apply");

try {
  await connectDatabase();
  const legacyConnectionFilter = {
    linkedAccountId: { $type: "string" },
    merchantAccountId: { $exists: false },
    connectionType: { $exists: false },
  };
  const legacyConnections = await PaymentConnection.countDocuments(legacyConnectionFilter);
  const legacyPayments = await Payment.countDocuments({
    purpose: "MEMBERSHIP",
    "beneficiarySnapshot.linkedAccountId": { $type: "string" },
  });
  let updated = 0;
  if (apply) {
    const result = await PaymentConnection.updateMany(
      legacyConnectionFilter,
      { $set: { connectionType: "LEGACY_ROUTE" } },
    );
    updated = result.modifiedCount;
    await Promise.all([
      PaymentConnection.createIndexes(),
      PaymentOAuthState.createIndexes(),
      Payment.createIndexes(),
      ProviderEvent.createIndexes(),
      RouteTransfer.createIndexes(),
    ]);
  }
  console.log(JSON.stringify({
    mode: apply ? "apply" : "dry-run",
    legacyConnectionCandidates: legacyConnections,
    legacyConnectionsMarked: updated,
    historicalRoutePaymentsPreserved: legacyPayments,
    historicalProviderIdentitiesRewritten: 0,
    historicalRouteTransfersDeleted: 0,
  }, null, 2));
} finally {
  await disconnectDatabase();
  await mongoose.disconnect().catch(() => undefined);
}

