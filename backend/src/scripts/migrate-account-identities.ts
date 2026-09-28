import "dotenv/config";
import mongoose from "mongoose";
import { inspectAccountIdentities } from "../services/accountIdentityMigration.js";
import { normalizeEmail } from "../utils/accountIdentity.js";

// Diagnostic by default. No model imports/autoIndex or secret-bearing error logs.
const apply = process.argv.includes("--apply");
let connection: mongoose.Connection | undefined;
try {
  if (apply && !process.argv.includes("--maintenance-confirmed"))
    throw new Error("Apply requires --maintenance-confirmed after stopping all account writes and taking a backup.");
  if (!process.env.MONGO_URI) throw new Error("MONGO_URI must name the intended database.");
  connection = await mongoose.createConnection(process.env.MONGO_URI, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 10000 }).asPromise();
  const users = connection.collection("users"), identities = connection.collection("authidentities");
  const [accounts, authIdentities, indexes, gyms, registrations] = await Promise.all([
    users.find({}, { projection: { _id: 1, email: 1, phone: 1, roles: 1, activeRole: 1, status: 1 } }).toArray(),
    identities.find({}, { projection: { _id: 1, userId: 1, provider: 1, providerSubject: 1 } }).toArray(),
    users.listIndexes().toArray().catch((error: { code?: number }) => { if (error.code === 26) return []; throw error; }),
    connection.collection("gyms").aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
    connection.collection("gymregistrations").aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]).toArray(),
  ]);
  const analysis = inspectAccountIdentities(accounts as any, authIdentities as any);
  console.log(JSON.stringify({ mode: apply ? "apply" : "diagnostic", ...analysis.report,
    identityIndexes: indexes.filter(index => Object.keys(index.key).length === 1 && (index.key.email || index.key.phone)).map(index => ({ name: index.name, key: index.key, unique: Boolean(index.unique), sparse: Boolean(index.sparse), partial: index.partialFilterExpression })),
    gyms, registrations,
  }, null, 2));
  if (!analysis.report.safeToApply) {
    process.exitCode = 1;
    console.error("Migration blocked. Resolve reported record IDs through verified account recovery/support; no users were changed or merged.");
  } else if (apply) {
    await connection.transaction(async session => {
      for (const update of analysis.updates) await users.updateOne({ _id: update.id as any }, {
        ...(Object.keys(update.set).length ? { $set: update.set } : {}),
        ...(Object.keys(update.unset).length ? { $unset: update.unset } : {}),
      }, { session });
      for (const update of analysis.identityUpdates)
        await identities.updateOne({ _id: update.id as any }, { $set: { providerSubject: update.subject } }, { session });
      // Preserve invitation binding while applying the same email-case policy.
      const invitations = connection!.collection("accountinvitations");
      for await (const invitation of invitations.find({ email: { $type: "string" } }, { session, projection: { email: 1 } })) {
        const email = normalizeEmail(invitation.email);
        if (email !== invitation.email) await invitations.updateOne({ _id: invitation._id }, { $set: { email } }, { session });
      }
    });
    for (const field of ["email", "phone"] as const) {
      const existing = indexes.find(index => Object.keys(index.key).length === 1 && index.key[field] === 1);
      if (existing && !existing.unique) await users.dropIndex(existing.name!);
      if (!existing?.unique) await users.createIndex({ [field]: 1 }, { name: `${field}_1`, unique: true, sparse: true });
    }
    await identities.createIndex({ provider: 1, providerSubject: 1 }, { unique: true });
    const verified = await users.listIndexes().toArray();
    if (!["email", "phone"].every(field => verified.some(index => Object.keys(index.key).length === 1 && index.key[field] === 1 && index.unique)))
      throw new Error("Both independent unique indexes must be present before reopening traffic.");
    console.log("Canonical identities saved; separate email and phone unique indexes verified. Roles and gym relationships were preserved. Owner onboarding is derived from existing registration and gym records.");
  } else console.log("Read-only diagnostic complete. Review this report, take a backup and stop account writes before running --apply --maintenance-confirmed.");
} catch (error) {
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "UNKNOWN";
  console.error(`Identity migration did not complete (code ${code}). Inspect database connectivity/index permissions and the diagnostic report; no contact values or connection details are printed.`);
  process.exitCode = 1;
} finally {
  await connection?.close();
}
