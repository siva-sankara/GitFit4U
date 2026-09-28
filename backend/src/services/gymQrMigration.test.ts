import { expect, it } from "vitest";
import { inspectGymQrIdentities } from "./gymQrMigration.js";
it("diagnoses legacy identities and missing gyms without emitting public QR references", () => {
  const report = inspectGymQrIdentities([{ _id: "one", gymId: "gym", kind: "GYM_IDENTITY", publicId: "printed-secret-reference", secretVersion: 2 }], ["gym", "new-gym"]);
  expect(report).toMatchObject({ safeToApply: true, legacyPayloadsToSave: 1, gymsWithoutIdentity: 1 });
  expect(JSON.stringify(report)).not.toContain("printed-secret-reference");
});
it("blocks duplicate gym identities, public references, payloads and orphan records", () => {
  const report = inspectGymQrIdentities([
    { _id: "one", gymId: "gym", kind: "GYM_IDENTITY", publicId: "abcdefghijklmnopqrstuvwx", qrPayload: "getfit4u:gym:abcdefghijklmnopqrstuvwx" },
    { _id: "two", gymId: "gym", kind: "GYM_IDENTITY", publicId: "abcdefghijklmnopqrstuvwx", qrPayload: "getfit4u:gym:abcdefghijklmnopqrstuvwx" },
    { _id: "orphan", gymId: "missing", kind: "GYM_IDENTITY", publicId: "orphan-reference" },
  ], ["gym"]);
  expect(report).toMatchObject({ safeToApply: false, duplicateGymIdentities: [["one", "two"]], duplicatePublicReferences: [["one", "two"]], duplicatePayloads: [["one", "two"]], invalidIdentities: ["orphan"] });
});
it("blocks a stored payload that points at a different identity instead of replacing it", () => {
  expect(inspectGymQrIdentities([{ _id: "mismatched", gymId: "gym", kind: "GYM_IDENTITY", publicId: "abcdefghijklmnopqrstuvwx", qrPayload: "getfit4u:gym:xxxxxxxxxxxxxxxxxxxxxxxx" }], ["gym"]))
    .toMatchObject({ safeToApply: false, invalidIdentities: ["mismatched"] });
});
