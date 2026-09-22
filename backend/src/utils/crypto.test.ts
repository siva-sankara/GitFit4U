import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashOtp, randomDigits, safeEqualHex, sha256, verifyHmacSha256 } from "./crypto.js";

describe("cryptographic helpers", () => {
  it("creates fixed-width numeric OTPs", () => {
    const code = randomDigits(6);
    expect(code).toMatch(/^\d{6}$/);
  });

  it("compares OTP hashes without accepting different values", () => {
    const first = hashOtp("challenge-1", "123456");
    const same = hashOtp("challenge-1", "123456");
    const other = hashOtp("challenge-1", "654321");
    expect(safeEqualHex(first, same)).toBe(true);
    expect(safeEqualHex(first, other)).toBe(false);
  });

  it("verifies provider HMAC signatures", () => {
    const payload = Buffer.from('{"event":"payment.captured"}');
    const secret = "test-webhook-secret";
    const signature = crypto.createHmac("sha256", secret)
      .update(payload)
      .digest("hex");
    expect(verifyHmacSha256(payload, signature, secret)).toBe(true);
    expect(verifyHmacSha256(payload, sha256("wrong"), secret)).toBe(false);
  });
});
