import { afterEach, expect, it, vi } from "vitest";
import { GymScanner } from "../models/Attendance.js";
import { permanentGymIdentity } from "./gymQrIdentityService.js";
import { issueGymQr } from "./attendanceQrService.js";
const gymId = "507f1f77bcf86cd799439011";
afterEach(() => vi.restoreAllMocks());
it("returns stored bytes without changing revision, status or encoded content on display", async () => {
  const saved = { publicId: "abcdefghijklmnopqrstuvwx", qrPayload: "previously-printed-bytes", secretVersion: 4, status: "DISABLED" };
  vi.spyOn(GymScanner, "findOneAndUpdate").mockResolvedValue(saved);
  expect(await permanentGymIdentity(gymId)).toBe(saved);
  expect(GymScanner.findOneAndUpdate).toHaveBeenCalledOnce();
  expect(vi.mocked(GymScanner.findOneAndUpdate).mock.calls[0][1]).not.toHaveProperty("$set");
});
it("recovers the winner of competing initial creation using the unique per-gym identity", async () => {
  const saved = { qrPayload: "saved" };
  vi.spyOn(GymScanner, "findOneAndUpdate").mockRejectedValue({ code: 11000 });
  vi.spyOn(GymScanner, "findOne").mockResolvedValue(saved);
  expect(await permanentGymIdentity(gymId)).toBe(saved);
  expect(GymScanner.findOne).toHaveBeenCalledWith({ gymId, kind: "GYM_IDENTITY" });
});
it("fills a legacy payload once while preserving its identity and current revision", async () => {
  const old = { _id: "scanner", publicId: "legacy-identity", secretVersion: 3 };
  const saved = { ...old, qrPayload: issueGymQr(gymId, old.publicId, 3) };
  vi.spyOn(GymScanner, "findOneAndUpdate").mockResolvedValueOnce(old).mockResolvedValueOnce(saved);
  expect(await permanentGymIdentity(gymId)).toBe(saved);
  expect(GymScanner.findOneAndUpdate).toHaveBeenLastCalledWith({ _id: "scanner", qrPayload: { $exists: false } },
    { $set: { qrPayload: saved.qrPayload } }, { returnDocument: "after", overwriteImmutable: true });
});
it("declares database-enforced uniqueness for payload and one identity per gym", () => {
  expect(GymScanner.schema.indexes()).toEqual(expect.arrayContaining([
    [expect.objectContaining({ qrPayload: 1 }), expect.objectContaining({ unique: true, sparse: true })],
    [{ gymId: 1, kind: 1 }, expect.objectContaining({ unique: true, partialFilterExpression: { kind: "GYM_IDENTITY" } })],
  ]));
});
