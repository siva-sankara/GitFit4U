import "dotenv/config";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../config/db.js";

type IndexSpec = {
  collection: string;
  name: string;
  key: Record<string, 1 | -1>;
  unique?: boolean;
  partialFilterExpression?: Record<string, unknown>;
  duplicateMatch?: Record<string, unknown>;
};
const specs: IndexSpec[] = [
  { collection: "invoices", name: "invoice_payment_unique", key: { paymentId: 1 }, unique: true },
  { collection: "offers", name: "offer_gym_code_unique", key: { gymId: 1, code: 1 }, unique: true, partialFilterExpression: { code: { $type: "string" } }, duplicateMatch: { code: { $type: "string" } } },
  { collection: "advertisements", name: "advertisement_eligibility", key: { placements: 1, status: 1, startsAt: 1, endsAt: 1, gymId: 1 } },
  { collection: "payments", name: "payment_offer_reservation", key: { offerId: 1, offerReservationStatus: 1, payerId: 1 } },
  { collection: "conversations", name: "conversation_direct_unique", key: { directKey: 1 }, unique: true, partialFilterExpression: { directKey: { $type: "string" } }, duplicateMatch: { directKey: { $type: "string" } } },
  { collection: "conversations", name: "conversation_support_ticket_unique", key: { supportTicketId: 1 }, unique: true, partialFilterExpression: { supportTicketId: { $type: "objectId" } }, duplicateMatch: { supportTicketId: { $type: "objectId" } } },
  { collection: "attendanceevents", name: "attendance_user_history", key: { userId: 1, type: 1, occurredAt: -1 } },
  { collection: "streakprojections", name: "streak_user_unique", key: { userId: 1 }, unique: true, partialFilterExpression: { scope: "USER" }, duplicateMatch: { scope: "USER" } },
];
const apply = process.argv.includes("--apply");
const same = (left: unknown, right: unknown) => JSON.stringify(left || {}) === JSON.stringify(right || {});
try {
  await connectDatabase();
  const plans: Array<Record<string, unknown>> = [];
  for (const spec of specs) {
    const collection = mongoose.connection.collection(spec.collection);
    const indexes = await collection.listIndexes().toArray().catch((error: any) => {
      if (error?.code === 26) return [];
      throw error;
    });
    const conflict = indexes.find(index => same(index.key, spec.key));
    const compatible = Boolean(conflict && Boolean(conflict.unique) === Boolean(spec.unique) && same(conflict.partialFilterExpression, spec.partialFilterExpression));
    let duplicate = null;
    if (spec.unique) {
      const groupId = Object.fromEntries(Object.keys(spec.key).map(field => [field, `$${field}`]));
      duplicate = (await collection.aggregate([
        ...(spec.duplicateMatch ? [{ $match: spec.duplicateMatch }] : []),
        { $group: { _id: groupId, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
        { $limit: 1 },
      ]).toArray())[0] || null;
    }
    plans.push({ collection: spec.collection, index: spec.name, action: compatible ? "unchanged" : conflict ? `replace ${conflict.name}` : "create", duplicateConflict: Boolean(duplicate) });
    if (!apply || compatible) continue;
    if (duplicate) throw new Error(`Duplicate data blocks ${spec.name}; resolve it before applying this migration.`);
    if (conflict?.name && conflict.name !== "_id_") await collection.dropIndex(conflict.name);
    await collection.createIndex(spec.key, { name: spec.name, ...(spec.unique ? { unique: true } : {}), ...(spec.partialFilterExpression ? { partialFilterExpression: spec.partialFilterExpression } : {}) });
  }
  console.log(JSON.stringify({ mode: apply ? "applied" : "dry-run", dataModified: false, plans }, null, 2));
  if (!apply) console.log("No indexes or records were changed. Re-run with --apply during a maintenance window after taking a backup.");
} catch (error) {
  console.error(error instanceof Error ? error.message : "Account/promotions index migration failed.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
