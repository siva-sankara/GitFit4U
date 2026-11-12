import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../config/env.js";
import { AuthOtpDelivery } from "../models/Auth.js";
import {
  authOtpEmailContent,
  decryptAuthOtpDelivery,
  encryptAuthOtpDelivery,
  isRetryableAuthOtpDeliveryError,
  queueAuthOtpDeliveries,
} from "./authOtpDeliveryService.js";

const originalKey = env.AUTH_OTP_DELIVERY_ENCRYPTION_KEY;

beforeEach(() => {
  env.AUTH_OTP_DELIVERY_ENCRYPTION_KEY =
    "test-only-independent-delivery-key-1234567890";
});

afterEach(() => {
  vi.restoreAllMocks();
  env.AUTH_OTP_DELIVERY_ENCRYPTION_KEY = originalKey;
});

describe("authentication OTP delivery envelopes", () => {
  it("encrypts the code with a separate delivery key and rejects no plaintext storage", () => {
    const payload = {
      challengeId: "challenge-public-id",
      version: 1,
      purpose: "LOGIN" as const,
      destination: "+919876543210",
      code: "004281",
      expiresAt: "2026-10-08T10:05:00.000Z",
    };
    const encrypted = encryptAuthOtpDelivery(payload);
    expect(encrypted).not.toContain(payload.code);
    expect(encrypted).not.toContain(payload.destination);
    expect(decryptAuthOtpDelivery(encrypted)).toEqual(payload);
  });

  it("queues mobile and email intents containing the same challenge, code, version and expiry", async () => {
    const insert = vi
      .spyOn(AuthOtpDelivery, "insertMany")
      .mockResolvedValue([] as any);
    const expiresAt = new Date("2026-10-08T10:05:00.000Z");
    await queueAuthOtpDeliveries({
      challenge: {
        _id: "mongo-challenge",
        publicId: "challenge-public-id",
        deliveryVersion: 3,
      },
      phone: "+919876543210",
      email: "member@example.com",
      code: "004281",
      purpose: "SIGNUP",
      expiresAt,
    });
    const rows = insert.mock.calls[0][0] as any[];
    expect(rows.map((row) => row.channel)).toEqual(["MOBILE", "EMAIL"]);
    const payloads = rows.map((row) => decryptAuthOtpDelivery(row.encryptedPayload));
    expect(payloads).toEqual([
      expect.objectContaining({
        challengeId: "challenge-public-id",
        version: 3,
        purpose: "SIGNUP",
        destination: "+919876543210",
        code: "004281",
        expiresAt: expiresAt.toISOString(),
      }),
      expect.objectContaining({
        challengeId: "challenge-public-id",
        version: 3,
        purpose: "SIGNUP",
        destination: "member@example.com",
        code: "004281",
        expiresAt: expiresAt.toISOString(),
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("004281");
    expect(JSON.stringify(rows)).not.toContain("member@example.com");
  });

  it("keeps the OTP out of the subject and renders the remaining challenge expiry", () => {
    const content = authOtpEmailContent(
      "SIGNUP",
      "123456",
      new Date("2026-10-08T10:05:00.000Z"),
      new Date("2026-10-08T10:00:00.000Z"),
    );
    expect(content.subject).toBe("Your GETFIT4U signup verification code");
    expect(content.subject).not.toContain("123456");
    expect(content.html).toContain("123456");
    expect(content.html).toContain("expires in 5 minutes");
    expect(content.html).not.toContain("tracking");
  });

  it("renders a dedicated password-recovery email using the same protected code", () => {
    const content = authOtpEmailContent(
      "ACCOUNT_RECOVERY",
      "654321",
      new Date("2026-10-08T10:05:00.000Z"),
      new Date("2026-10-08T10:00:00.000Z"),
    );
    expect(content.subject).toBe(
      "Your GETFIT4U password recovery verification code",
    );
    expect(content.html).toContain("654321");
    expect(content.html).toContain("password recovery");
  });

  it("does not retry permanent provider configuration failures", () => {
    expect(
      isRetryableAuthOtpDeliveryError({
        statusCode: 503,
        code: "WHATSAPP_AUTH_NOT_CONFIGURED",
      }),
    ).toBe(false);
    expect(
      isRetryableAuthOtpDeliveryError({
        statusCode: 503,
        code: "M365_MAIL_SEND_FORBIDDEN",
      }),
    ).toBe(false);
  });

  it("retries transient provider and rate-limit failures", () => {
    expect(
      isRetryableAuthOtpDeliveryError({
        statusCode: 502,
        code: "WHATSAPP_OTP_PROVIDER_FAILED",
      }),
    ).toBe(true);
    expect(
      isRetryableAuthOtpDeliveryError({
        statusCode: 429,
        code: "M365_RATE_LIMITED",
      }),
    ).toBe(true);
  });
});
