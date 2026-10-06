import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/db.js";
import "../models/Delivery.js";

// Run during a maintenance window before starting upgraded API instances.
// This changes index definitions only; it never removes notification records.
try {
  await connectDatabase();
  const collection = mongoose.connection.collection("notifications");
  const indexes = await collection
    .listIndexes()
    .toArray()
    .catch((error) => {
      if (error.code === 26) return [];
      throw error;
    });
  const old = indexes.find(
    (index) =>
      index.key.userId === 1 &&
      index.key.dedupeKey === 1 &&
      !index.partialFilterExpression,
  );
  const duplicates = await collection
    .aggregate([
      { $match: { dedupeKey: { $type: "string" } } },
      {
        $group: {
          _id: { userId: "$userId", dedupeKey: "$dedupeKey" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      { $limit: 1 },
    ])
    .toArray();
  if (duplicates.length)
    throw new Error(
      "Resolve duplicate notification dedupe keys before migrating.",
    );
  if (old?.name) await collection.dropIndex(old.name);
  await collection.createIndex(
    { userId: 1, dedupeKey: 1 },
    {
      unique: true,
      partialFilterExpression: { dedupeKey: { $type: "string" } },
    },
  );
  const otpCollection = mongoose.connection.collection("otpchallenges");
  const otpIndexes = await otpCollection
    .listIndexes()
    .toArray()
    .catch((error) => {
      if (error.code === 26) return [];
      throw error;
    });
  // Older releases deleted challenges at their five-minute verification
  // expiry, which also erased the evidence needed for the 15-minute abuse
  // window. Retention now uses purgeAt; no challenge documents are deleted by
  // this migration itself.
  const oldOtpExpiry = otpIndexes.find(
    (index) => index.key.expiresAt === 1 && index.expireAfterSeconds !== undefined,
  );
  if (oldOtpExpiry?.name) await otpCollection.dropIndex(oldOtpExpiry.name);
  await import("../app.js");
  for (const model of Object.values(mongoose.models))
    await model.createIndexes();
  console.log(
    "Database indexes created; notification and OTP retention migrations completed; records preserved.",
  );
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Index migration failed",
  );
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
