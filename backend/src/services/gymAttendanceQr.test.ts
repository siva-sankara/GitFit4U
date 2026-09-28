import { describe, expect, it } from "vitest";
import {
  issueGymQr,
  verifyGymQr,
  issueAttendanceQr,
  permanentGymQr,
  parseGymQrReference,
} from "./attendanceQrService.js";
import { attendanceLocalDate } from "./attendanceService.js";
const gym = "507f1f77bcf86cd799439011";
describe("persistent gym QR", () => {
  it("parses the opaque permanent identifier without any expiry or deployment signature", () => {
    const identity = "abcdefghijklmnopqrstuvwx";
    expect(parseGymQrReference(permanentGymQr(identity))).toEqual({ identityId: identity });
    expect(() => parseGymQrReference(permanentGymQr("short"))).toThrow();
  });
  it("retains a printed legacy reference even after the signing secret changes", () => {
    const token = issueGymQr(gym, "legacy-identity", 2);
    const printedWithOldSecret = token.split(".")[0] + "." + "A".repeat(43);
    expect(parseGymQrReference(printedWithOldSecret)).toEqual({ gymId: gym, identityId: "legacy-identity", revision: 2 });
    // Authorization and current-revision checks happen against stored records.
    expect(() => parseGymQrReference(issueAttendanceQr("member", gym).token)).toThrow();
    expect(() => parseGymQrReference("https://unrelated.example/qr")).toThrow();
  });
  it("keeps a stable signed identity across downloads and changes when revoked", () => {
    const token = issueGymQr(gym, "unguessable-identity", 1);
    expect(issueGymQr(gym, "unguessable-identity", 1)).toBe(token);
    expect(verifyGymQr(token)).toMatchObject({
      gymId: gym,
      identityId: "unguessable-identity",
      revision: 1,
      purpose: "GYM_ATTENDANCE",
    });
    expect(issueGymQr(gym, "unguessable-identity", 2)).not.toBe(token);
  });
  it("rejects a changed gym id, non-ascii signature, extra segment and the legacy member token", () => {
    const token = issueGymQr(gym, "identity", 1),
      [payload, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString());
    decoded.gymId = "507f1f77bcf86cd799439022";
    const tampered =
      Buffer.from(JSON.stringify(decoded)).toString("base64url") +
      "." +
      signature;
    for (const invalid of [
      tampered,
      token + ".extra",
      payload + "." + "é".repeat(43),
      issueAttendanceQr("member", gym).token,
    ])
      expect(() => verifyGymQr(invalid)).toThrow();
  });
  it("uses the gym timezone when selecting the duplicate-protection date", () => {
    expect(
      attendanceLocalDate(new Date("2026-09-25T19:00:00Z"), "Asia/Kolkata"),
    ).toBe("2026-09-26");
    expect(
      attendanceLocalDate(new Date("2026-09-25T19:00:00Z"), "America/New_York"),
    ).toBe("2026-09-25");
  });
});
