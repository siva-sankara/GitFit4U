import mongoose from "mongoose";
import { env } from "../config/env.js";
import { migratePromotionScopes } from "../services/promotionScopeMigration.js";
// Additive and dry-run by default. No invoice, payment, status or amount updates.
try {
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 });
  console.log(JSON.stringify(await migratePromotionScopes(process.argv.includes("--apply"))));
} catch {
  console.error("Promotion scope migration could not complete; check database access and retry the dry-run.");
  process.exitCode = 1;
} finally { await mongoose.disconnect(); }
