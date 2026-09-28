import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    WHATSAPP_APP_SECRET: "meta-app-secret-for-unit-tests",
    WHATSAPP_VERIFY_TOKEN: "verify-token-for-unit-tests",
    WHATSAPP_WEBHOOK_RETENTION_DAYS: 30,
    WHATSAPP_MODE: "disabled",
    WHATSAPP_DEFAULT_LANGUAGE: "en_US",
  },
}));

import { verifyWhatsAppChallenge, verifyWhatsAppSignature } from "./whatsappWebhookService.js";

describe("WhatsApp webhook authentication", () => {
  it("returns the exact challenge only for the configured verification token", () => {
    expect(verifyWhatsAppChallenge({
      "hub.mode": "subscribe",
      "hub.verify_token": "verify-token-for-unit-tests",
      "hub.challenge": "exact-challenge-123",
    })).toBe("exact-challenge-123");
    expect(() => verifyWhatsAppChallenge({
      "hub.mode": "subscribe",
      "hub.verify_token": "forged-token",
      "hub.challenge": "challenge",
    })).toThrowError(expect.objectContaining({ code: "WHATSAPP_WEBHOOK_VERIFICATION_FAILED" }));
  });

  it("authenticates the exact raw bytes and rejects missing, malformed or changed bodies", () => {
    const raw = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');
    const signature = `sha256=${createHmac("sha256", "meta-app-secret-for-unit-tests").update(raw).digest("hex")}`;
    expect(() => verifyWhatsAppSignature(raw, signature)).not.toThrow();
    expect(() => verifyWhatsAppSignature(Buffer.from(`${raw.toString()} `), signature)).toThrowError(
      expect.objectContaining({ code: "WHATSAPP_SIGNATURE_INVALID" }),
    );
    expect(() => verifyWhatsAppSignature(raw)).toThrowError(
      expect.objectContaining({ code: "WHATSAPP_SIGNATURE_MISSING" }),
    );
    expect(() => verifyWhatsAppSignature(raw, "sha256=short")).toThrowError(
      expect.objectContaining({ code: "WHATSAPP_SIGNATURE_MISSING" }),
    );
  });
});
