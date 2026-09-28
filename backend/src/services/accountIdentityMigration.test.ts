import { describe, expect, it } from "vitest";
import { inspectAccountIdentities } from "./accountIdentityMigration.js";
import { User } from "../models/User.js";
describe("canonical account identity rollout", () => {
  it("detects independent email and phone collisions without exposing contact values", () => {
    const result = inspectAccountIdentities([
      { _id: "a", email: " Person+tag@Example.com ", phone: "9876543210" },
      { _id: "b", email: "person+tag@example.com", phone: "+919876543211" },
      { _id: "c", email: "other@example.com", phone: "+91 98765 43210" },
    ]);
    expect(result.report.safeToApply).toBe(false);
    expect(result.report.conflicts).toEqual([{ field: "email", accountIds: ["a", "b"] }, { field: "phone", accountIds: ["a", "c"] }]);
    expect(JSON.stringify(result.report)).not.toContain("example.com");
    expect(JSON.stringify(result.report)).not.toContain("98765");
  });
  it("preserves international identities and missing invitation contacts, normalizes subjects consistently", () => {
    const result = inspectAccountIdentities([
      { _id: "a", email: " Owner@Example.com ", phone: "+1 (415) 555-2671", roles: ["USER", "GYM_OWNER"], status: "ACTIVE" },
      { _id: "b", email: "invited@example.com", phone: null, status: "PENDING_VERIFICATION" },
      { _id: "c", email: "", phone: "09876543210" },
    ], [{ _id: "identity", userId: "a", provider: "PASSWORD", providerSubject: "Owner@Example.com" }]);
    expect(result.report.safeToApply).toBe(true);
    expect(result.report.missing).toEqual({ email: 1, phone: 1 });
    expect(result.updates[0].set).toEqual({ email: "owner@example.com", phone: "+14155552671" });
    expect(result.updates[1].unset).toEqual({ phone: 1 });
    expect(result.identityUpdates).toEqual([{ id: "identity", subject: "owner@example.com" }]);
    expect(result.report.roleCounts).toEqual({ USER: 1, GYM_OWNER: 1 });
  });
  it("blocks malformed legacy contacts and mismatched identity ownership without guessing", () => {
    const result = inspectAccountIdentities([{ _id: "a", email: "valid@example.com", phone: "call 9876543210" }], [{ _id: "id", userId: "a", provider: "PASSWORD", providerSubject: "different@example.com" }]);
    expect(result.report.safeToApply).toBe(false);
    expect(result.report.invalid.map(issue => issue.field)).toEqual(["phone", "authIdentity"]);
  });
  it("rejects a PHONE identity whose subject is an email even when that email belongs to its account", () => {
    const result = inspectAccountIdentities([{ _id: "a", email: "valid@example.com" }], [{ _id: "id", userId: "a", provider: "PHONE", providerSubject: "valid@example.com" }]);
    expect(result.report.safeToApply).toBe(false);
    expect(result.report.invalid).toEqual([expect.objectContaining({ field: "authIdentity", recordId: "id" })]);
  });
  it("defines independent unique sparse account indexes and canonicalizes all model writes", async () => {
    const indexes = User.schema.indexes();
    for (const field of ["email", "phone"])
      expect(indexes).toContainEqual([expect.objectContaining({ [field]: 1 }), expect.objectContaining({ unique: true, sparse: true })]);
    const account = new User({ publicId: "model-check", email: " Name+Tag@Example.com ", phone: "9876543210" });
    expect(account.email).toBe("name+tag@example.com");
    expect(account.phone).toBe("+919876543210");
    await expect(account.validate()).resolves.toBeUndefined();
    const legacy = new User({ publicId: "legacy", email: null, phone: null });
    expect(legacy.email).toBeUndefined();
    expect(legacy.phone).toBeUndefined();
  });
  it("preserves administrative search regexes while canonicalizing equality queries", () => {
    const phone = /9876/;
    expect(User.find({ phone }).cast(User)).toEqual({ phone });
    expect(User.find({ phone: "9876543210" }).cast(User)).toEqual({ phone: "+919876543210" });
    expect(User.find({ email: " Mixed@Example.com " }).cast(User)).toEqual({ email: "mixed@example.com" });
  });
});
