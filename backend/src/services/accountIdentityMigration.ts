import { z } from "zod";
import { normalizeAccountPhone, normalizeEmail } from "../utils/accountIdentity.js";

type Account = { _id: unknown; email?: unknown; phone?: unknown; roles?: string[]; activeRole?: string; status?: string };
type Identity = { _id: unknown; userId: unknown; provider: string; providerSubject: string };
export function inspectAccountIdentities(accounts: Account[], identities: Identity[] = []) {
  const conflicts: { field: string; accountIds: string[] }[] = [];
  const invalid: { field: string; recordId: string; reason: string }[] = [];
  const updates: { id: unknown; set: Record<string, string>; unset: Record<string, 1> }[] = [];
  const identityUpdates: { id: unknown; subject: string }[] = [];
  const canonical = new Map<string, { email?: string; phone?: string }>();
  const seen = { email: new Map<string, string[]>(), phone: new Map<string, string[]>() };
  const missing = { email: 0, phone: 0 };
  const roleCounts: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  for (const account of accounts) {
    const id = String(account._id), set: Record<string, string> = {}, unset: Record<string, 1> = {};
    const values: { email?: string; phone?: string } = {};
    for (const role of account.roles || []) roleCounts[role] = (roleCounts[role] || 0) + 1;
    const status = account.status || "MISSING";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    for (const field of ["email", "phone"] as const) {
      const value = account[field];
      if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
        missing[field]++;
        if (value !== undefined) unset[field] = 1;
        continue;
      }
      try {
        if (typeof value !== "string") throw new Error("Invalid contact type");
        const normalized = field === "email" ? z.email().parse(normalizeEmail(value)) : normalizeAccountPhone(value);
        values[field] = normalized;
        const ids = seen[field].get(normalized) || [];
        ids.push(id); seen[field].set(normalized, ids);
        if (value !== normalized) set[field] = normalized;
      } catch {
        invalid.push({ field, recordId: id, reason: "Unrecognized legacy contact; verify it without inventing or merging identities." });
      }
    }
    canonical.set(id, values);
    if (Object.keys(set).length || Object.keys(unset).length) updates.push({ id: account._id, set, unset });
  }
  for (const field of ["email", "phone"] as const)
    for (const ids of seen[field].values()) if (ids.length > 1) conflicts.push({ field, accountIds: ids });

  const identitySubjects = new Map<string, string[]>();
  for (const identity of identities) {
    if (!["PASSWORD", "PHONE"].includes(identity.provider)) continue;
    try {
      const contact = canonical.get(String(identity.userId));
      if (!contact) throw new Error("Missing account");
      const subject = identity.provider !== "PHONE" && identity.providerSubject.includes("@")
        ? z.email().parse(normalizeEmail(identity.providerSubject))
        : normalizeAccountPhone(identity.providerSubject);
      if (subject !== contact.email && subject !== contact.phone) throw new Error("Identity contact mismatch");
      const key = `${identity.provider}:${subject}`, ids = identitySubjects.get(key) || [];
      ids.push(String(identity.userId)); identitySubjects.set(key, ids);
      if (subject !== identity.providerSubject) identityUpdates.push({ id: identity._id, subject });
    } catch {
      invalid.push({ field: "authIdentity", recordId: String(identity._id), reason: "Identity does not match a recognized account contact; review before migration." });
    }
  }
  for (const ids of identitySubjects.values()) if (ids.length > 1) conflicts.push({ field: "authIdentity", accountIds: ids });
  return {
    report: { accounts: accounts.length, missing, roleCounts, statusCounts, accountsToNormalize: updates.length, identitiesToNormalize: identityUpdates.length, conflicts, invalid, safeToApply: !conflicts.length && !invalid.length },
    updates, identityUpdates,
  };
}
