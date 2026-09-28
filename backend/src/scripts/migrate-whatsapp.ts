import mongoose from "mongoose";
import { env } from "../config/env.js";
import {
  WhatsAppConnection,
  WhatsAppConsent,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppOnboardingSession,
  WhatsAppOutbox,
  WhatsAppTemplate,
  WhatsAppWebhookReceipt,
} from "../models/WhatsApp.js";

const apply = process.argv.includes("--apply");
const models = [
  WhatsAppConnection,
  WhatsAppConsent,
  WhatsAppConversation,
  WhatsAppMessage,
  WhatsAppOutbox,
  WhatsAppWebhookReceipt,
  WhatsAppTemplate,
  WhatsAppOnboardingSession,
];

try {
  await mongoose.connect(env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10_000 });
  const duplicatePhones = await WhatsAppConnection.aggregate([
    { $group: { _id: "$phoneNumberId", count: { $sum: 1 } } },
    { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
    { $limit: 1 },
  ]);
  const duplicateBindings = await WhatsAppConnection.aggregate([
    { $group: { _id: "$bindingKey", count: { $sum: 1 } } },
    { $match: { _id: { $ne: null }, count: { $gt: 1 } } },
    { $limit: 1 },
  ]);
  const conflicts = [
    ...(duplicatePhones.length ? ["duplicate Meta phone-number bindings"] : []),
    ...(duplicateBindings.length ? ["duplicate tenant sender bindings"] : []),
  ];
  if (apply && conflicts.length)
    throw new Error(`WHATSAPP_INDEX_CONFLICTS: ${conflicts.join(", ")}`);
  if (apply) for (const model of models) await model.createIndexes();
  console.log(JSON.stringify({
    mode: apply ? "applied" : "dry-run",
    safeToApply: conflicts.length === 0,
    conflicts,
    collections: models.map((model) => model.collection.name),
    note: "Dry-run first, then use --apply before enabling the WhatsApp worker.",
  }));
} catch (error: any) {
  console.error(JSON.stringify({ error: "WHATSAPP_MIGRATION_FAILED", reason: error.message }));
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
