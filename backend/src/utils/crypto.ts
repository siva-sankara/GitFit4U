import crypto from "node:crypto";
import { env } from "../config/env.js";

export function randomDigits(length = 6): string {
  const lower = 10 ** (length - 1);
  const upper = 10 ** length;
  return crypto.randomInt(lower, upper).toString();
}

export function hashOtp(challengeId: string, code: string): string {
  return crypto
    .createHmac("sha256", env.JWT_ACCESS_SECRET)
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

export function safeEqualHex(left: string, right: string): boolean {
  const a = Buffer.from(left, "hex");
  const b = Buffer.from(right, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function verifyHmacSha256(payload: Buffer, signature: string, secret: string): boolean {
  const expected = crypto.createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
