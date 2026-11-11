import crypto from "node:crypto";
import { env } from "../../config/env.js";

function encryptionKey() {
  if (!env.PAYMENT_TOKEN_ENCRYPTION_KEY)
    throw new Error("Payment-token encryption is not configured.");
  return Buffer.from(env.PAYMENT_TOKEN_ENCRYPTION_KEY, "hex");
}

function associatedData(connectionId: string, purpose: "access" | "refresh") {
  return Buffer.from(`getfit4u:razorpay:${connectionId}:${purpose}`, "utf8");
}

/** AES-256-GCM envelope. The connection and token purpose are authenticated AAD. */
export function encryptPaymentToken(
  value: string,
  connectionId: string,
  purpose: "access" | "refresh",
) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(associatedData(connectionId, purpose));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [
    `v${env.PAYMENT_TOKEN_ENCRYPTION_KEY_VERSION}`,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptPaymentToken(
  envelope: string,
  connectionId: string,
  purpose: "access" | "refresh",
) {
  const [version, iv, tag, encrypted] = envelope.split(".");
  if (
    version !== `v${env.PAYMENT_TOKEN_ENCRYPTION_KEY_VERSION}` ||
    !iv || !tag || !encrypted
  ) throw new Error("Unsupported payment-token encryption envelope.");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAAD(associatedData(connectionId, purpose));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

