import mongoose from "mongoose";
import { env } from "./env.js";

let pendingConnection: Promise<void> | undefined;

export async function connectDatabase(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;

  mongoose.set("strictQuery", true);
  if (!pendingConnection) {
    // Concurrent requests on a cold instance share the same connection attempt.
    pendingConnection = mongoose.connect(env.MONGO_URI, {
      autoIndex: env.NODE_ENV !== "production",
      serverSelectionTimeoutMS: 10_000
    }).then(() => undefined).finally(() => {
      // A failed attempt must not prevent a later request from retrying.
      pendingConnection = undefined;
    });
  }
  await pendingConnection;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
