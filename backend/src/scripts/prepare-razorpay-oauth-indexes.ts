import { connectDatabase, disconnectDatabase } from "../config/db.js";
import { PaymentOAuthState } from "../models/Business.js";

// Add indexes only; preserve existing merchant connections and payments.
try {
  await connectDatabase();
  await PaymentOAuthState.createIndexes();
  console.log("Razorpay OAuth attempt indexes are ready.");
} catch {
  console.error("Unable to prepare Razorpay OAuth attempt indexes. Check database connectivity and index permissions.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
