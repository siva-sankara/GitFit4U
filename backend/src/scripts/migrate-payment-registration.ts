import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { migratePaymentRegistrations } from "../services/registrationMigrationService.js";

const apply = process.argv.includes("--apply");
try {
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 15000 });
  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        ...(await migratePaymentRegistrations(apply)),
      },
      null,
      2,
    ),
  );
} finally {
  await mongoose.disconnect();
}
