import "dotenv/config";
import mongoose from "mongoose";
import { createHmac } from "node:crypto";
import { nanoid } from "nanoid";
import { inspectGymQrIdentities } from "../services/gymQrMigration.js";

// No model imports, index creation or record mutation in diagnostic mode.
const apply = process.argv.includes("--apply");
let connection: mongoose.Connection | undefined;
try {
  if (apply && !process.argv.includes("--maintenance-confirmed")) throw new Error("Stop writes and take a backup before applying.");
  if (!process.env.MONGO_URI) throw new Error("Missing database configuration.");
  connection = await mongoose.createConnection(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 }).asPromise();
  const scanners = connection.collection("gymscanners"), gyms = connection.collection("gyms");
  const [rows, gymRows, indexes] = await Promise.all([
    scanners.find({}, { projection: { publicId: 1, gymId: 1, kind: 1, qrPayload: 1, secretVersion: 1 } }).toArray(),
    gyms.find({}, { projection: { _id: 1, deletedAt: 1 } }).toArray(),
    scanners.listIndexes().toArray().catch((error: { code?: number }) => { if (error.code === 26) return []; throw error; }),
  ]);
  const report = inspectGymQrIdentities(rows as any, gymRows.map((row) => row._id));
  console.log(JSON.stringify({ mode: apply ? "apply" : "diagnostic", ...report,
    indexes: indexes.map((index) => ({ name: index.name, key: index.key, unique: Boolean(index.unique), sparse: Boolean(index.sparse), partial: index.partialFilterExpression })),
    legacyCompatibility: "Current stored identity/gym/revision accepts previously printed v2 payloads independently of signing-secret changes. Old revoked revisions remain invalid. Original print bytes can only be reconstructed if the signing secret is unchanged; existing saved payloads are never replaced.",
  }, null, 2));
  if (!report.safeToApply) { process.exitCode = 1; console.error("Migration blocked. Resolve reported records without merging or replacing printed identities."); }
  else if (apply) {
    if (report.legacyPayloadsToSave && !process.env.ATTENDANCE_QR_SECRET) throw new Error("Legacy payload reconstruction requires the current signing secret.");
    // Create required unique indexes before accepting any identity writes. Never
    // drop/rebuild existing incompatible indexes automatically.
    await scanners.createIndex({ publicId: 1 }, { unique: true });
    await scanners.createIndex({ gymId: 1, kind: 1 }, { unique: true, partialFilterExpression: { kind: "GYM_IDENTITY" } });
    await scanners.createIndex({ qrPayload: 1 }, { unique: true, sparse: true });
    for (const row of rows.filter((row) => row.kind === "GYM_IDENTITY" && row.qrPayload === undefined)) {
      const encoded = Buffer.from(JSON.stringify({ v: 2, purpose: "GYM_ATTENDANCE", gymId: String(row.gymId), identityId: row.publicId, revision: row.secretVersion || 1 })).toString("base64url");
      const qrPayload = encoded + "." + createHmac("sha256", process.env.ATTENDANCE_QR_SECRET!).update(encoded).digest("base64url");
      await scanners.updateOne({ _id: row._id, qrPayload: { $exists: false } }, { $set: { qrPayload } });
    }
    for (const gym of gymRows.filter((row) => !row.deletedAt)) {
      const publicId = nanoid(24);
      await scanners.updateOne({ gymId: gym._id, kind: "GYM_IDENTITY" }, { $setOnInsert: { publicId, qrPayload: `getfit4u:gym:${publicId}`, name: "Gym attendance identity", status: "ACTIVE", secretVersion: 1, createdAt: new Date(), updatedAt: new Date() } }, { upsert: true });
    }
    console.log("Saved permanent QR identities and required unique indexes. Existing identity/status/revision values were preserved.");
  } else console.log("Read-only diagnostic complete. No indexes or records changed. Apply only after backup and a maintenance window with --apply --maintenance-confirmed.");
} catch (error) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "UNKNOWN";
  console.error(`Gym QR migration did not complete (code ${code}); no secrets or QR payloads are printed.`); process.exitCode = 1;
} finally { await connection?.close(); }
