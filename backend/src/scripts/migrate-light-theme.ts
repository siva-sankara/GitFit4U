import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/db.js";

// Idempotent, dry-run by default; explicit Light/Dark and all other preferences remain untouched.
const apply = process.argv.includes("--apply");
const filter = { $or: [{ "preferences.theme": "system" }, { "preferences.theme": { $exists: false } }, { "preferences.theme": null }] };
try {
  await connectDatabase();
  const users = mongoose.connection.collection("users");
  const eligible = await users.countDocuments(filter);
  const result = apply ? await users.updateMany(filter, [{ $set: { preferences: { $mergeObjects: [
    { $cond: [{ $eq: [{ $type: "$preferences" }, "object"] }, "$preferences", {}] },
    { theme: "light" },
  ] } } }]) : null;
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", eligible, modified: result?.modifiedCount || 0, explicitPreferencesPreserved: true }));
} catch {
  console.error(JSON.stringify({ event: "THEME_MIGRATION_FAILED", message: "Unable to migrate theme preferences; verify database connectivity and retry." }));
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
