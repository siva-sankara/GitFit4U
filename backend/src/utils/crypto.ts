import crypto from "node:crypto";
import { env } from "../config/env.js";

export function randomDigits(length = 6): string {
  const lower = 10 ** (length - 1);
  const upper = 10 ** length;
  return crypto.randomInt(lower, upper).toString();
}

export function hashOtp(challengeId: string, code: string): string {
  return crypto
    .createHmac("sha256", env.AUTH_OTP_HMAC_SECRET)
    .update(`${challengeId}:${code}`)
    .digest("hex");
}

export function hashOtpContext(kind: string, value: string): string {
  return crypto
    .createHmac("sha256", env.AUTH_OTP_HMAC_SECRET)
    .update(`${kind}:${value}`)
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

function whatsappEncryptionKey() {
  if (!env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY)
    throw new Error("WhatsApp credential encryption is not configured.");
  return crypto
    .createHash("sha256")
    .update(env.WHATSAPP_CREDENTIAL_ENCRYPTION_KEY, "utf8")
    .digest();
}

/** AES-GCM envelope used only for server-side WhatsApp credentials. */
export function encryptWhatsAppCredential(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", whatsappEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptWhatsAppCredential(envelope: string): string {
  const [version, iv, tag, encrypted] = envelope.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted)
    throw new Error("Invalid WhatsApp credential envelope.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    whatsappEncryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}
