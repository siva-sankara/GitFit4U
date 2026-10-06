import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashOtp } from "../utils/crypto.js";

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  countDocuments: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  updateOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../models/Auth.js", () => ({
  OtpChallenge: {
    findOne: mocks.findOne,
    countDocuments: mocks.countDocuments,
    updateMany: mocks.updateMany,
    create: mocks.create,
    updateOne: mocks.updateOne,
    findOneAndUpdate: mocks.findOneAndUpdate,
  },
}));
vi.mock("./whatsappAuthOtpService.js", () => ({
  sendWhatsAppAuthenticationOtp: mocks.send,
}));

import { normalizePhone, requestOtp, verifyOtp } from "./otpService.js";

function requestQuery(value: any = null) {
  mocks.findOne.mockReturnValue({
    sort: () => ({ lean: async () => value }),
  });
}

function verificationQuery(value: any) {
  const query: any = {
    session: vi.fn().mockReturnThis(),
    then: (resolve: (result: any) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(value).then(resolve, reject),
  };
  mocks.findOne.mockReturnValue({ select: () => query });
}

function challenge(overrides: Record<string, unknown> = {}) {
  const publicId = "challenge-secure-identifier";
  return {
    _id: "mongo-challenge",
    publicId,
    phone: "+919876543210",
    purpose: "LOGIN",
    codeHash: hashOtp(publicId, "123456"),
    attempts: 0,
    maxAttempts: 5,
    expiresAt: new Date(Date.now() + 300_000),
    deliveryStatus: "SUBMITTED",
    consumedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  requestQuery();
  mocks.countDocuments.mockResolvedValue(0);
  mocks.updateMany.mockResolvedValue({ modifiedCount: 0 });
  mocks.create.mockResolvedValue({});
  mocks.updateOne.mockResolvedValue({ matchedCount: 1 });
  mocks.send.mockResolvedValue({ providerMessageId: "wamid.otp" });
});
afterEach(() => vi.useRealTimers());

describe("normalizePhone", () => {
  it("normalizes an Indian local mobile number", () => {
    expect(normalizePhone("098765 43210")).toBe("+919876543210");
  });

  it("preserves a valid international E.164 number", () => {
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
  });

  it("rejects malformed numbers", () => {
    expect(() => normalizePhone("123")).toThrowError(/valid mobile number/i);
  });
});

describe("persistent WhatsApp OTP challenges", () => {
  it("submits a six-digit code while returning no OTP or plaintext verifier", async () => {
    const result = await requestOtp("9876543210", "LOGIN", {
      ipAddress: "203.0.113.10",
    });
    const sentCode = mocks.send.mock.calls[0][1];
    expect(sentCode).toMatch(/^\d{6}$/);
    expect(result).toMatchObject({
      maskedPhone: expect.stringContaining("3210"),
      expiresInSeconds: 300,
      resendInSeconds: 60,
      deliveryStatus: "SUBMITTED",
    });
    expect(result).not.toHaveProperty("devOtp");
    expect(mocks.create.mock.calls[0][0]).toMatchObject({
      codeHash: hashOtp(result.challengeId, sentCode),
      requestIpHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      deliveryStatus: "PENDING",
    });
    expect(JSON.stringify(mocks.create.mock.calls[0][0])).not.toContain(sentCode);
  });

  it("verifies a correct code once and rejects a replay", async () => {
    const stored = challenge();
    verificationQuery(stored);
    mocks.findOneAndUpdate.mockResolvedValueOnce({ ...stored, consumedAt: new Date() });
    await expect(
      verifyOtp(stored.publicId, "123456", { expectedPurpose: "LOGIN" }),
    ).resolves.toMatchObject({ phone: stored.phone, purpose: "LOGIN" });
    verificationQuery({ ...stored, consumedAt: new Date() });
    await expect(
      verifyOtp(stored.publicId, "123456", { expectedPurpose: "LOGIN" }),
    ).rejects.toMatchObject({ code: "OTP_INVALID" });
  });

  it("counts an incorrect code and locks the fifth incorrect attempt", async () => {
    const stored = challenge({ attempts: 4 });
    verificationQuery(stored);
    mocks.findOneAndUpdate.mockResolvedValue({ ...stored, attempts: 5, consumedAt: new Date() });
    await expect(verifyOtp(stored.publicId, "654321")).rejects.toMatchObject({
      code: "OTP_ATTEMPTS_EXCEEDED",
    });
    expect(mocks.findOneAndUpdate.mock.calls[0][1]).toMatchObject({
      $inc: { attempts: 1 },
      $set: { consumedAt: expect.any(Date) },
    });
  });

  it("rejects an expired challenge before attempting an atomic claim", async () => {
    const stored = challenge({ expiresAt: new Date(Date.now() - 1) });
    verificationQuery(stored);
    await expect(verifyOtp(stored.publicId, "123456")).rejects.toMatchObject({
      code: "OTP_EXPIRED",
    });
    expect(mocks.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("invalidates the earlier code before creating a resend", async () => {
    await requestOtp("+919876543210", "LOGIN", { ipAddress: "203.0.113.11" });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        phone: "+919876543210",
        purpose: "LOGIN",
        consumedAt: null,
      }),
      { $set: { consumedAt: expect.any(Date) } },
    );
  });

  it("enforces the persistent per-phone request limit", async () => {
    mocks.countDocuments.mockResolvedValueOnce(5).mockResolvedValueOnce(0);
    await expect(
      requestOtp("+919876543210", "LOGIN", { ipAddress: "203.0.113.12" }),
    ).rejects.toMatchObject({ code: "OTP_RATE_LIMITED" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("enforces the persistent per-IP request limit", async () => {
    mocks.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(20);
    await expect(
      requestOtp("+919876543210", "LOGIN", { ipAddress: "203.0.113.14" }),
    ).rejects.toMatchObject({ code: "OTP_RATE_LIMITED" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("enforces the 60-second resend cooldown on the backend", async () => {
    requestQuery({ resendAvailableAt: new Date(Date.now() + 30_000) });
    await expect(
      requestOtp("+919876543210", "LOGIN", { ipAddress: "203.0.113.15" }),
    ).rejects.toMatchObject({
      code: "OTP_RESEND_COOLDOWN",
      details: { retryAfterSeconds: expect.any(Number) },
    });
    expect(mocks.countDocuments).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("invalidates the challenge and surfaces a real provider failure", async () => {
    mocks.send.mockRejectedValue(
      Object.assign(new Error("provider failure"), {
        code: "WHATSAPP_AUTH_TEMPLATE_NOT_APPROVED",
      }),
    );
    await expect(
      requestOtp("+919876543210", "LOGIN", { ipAddress: "203.0.113.13" }),
    ).rejects.toMatchObject({ code: "WHATSAPP_AUTH_TEMPLATE_NOT_APPROVED" });
    expect(mocks.updateOne).toHaveBeenLastCalledWith(
      expect.objectContaining({ publicId: expect.any(String) }),
      {
        $set: expect.objectContaining({
          deliveryStatus: "FAILED",
          consumedAt: expect.any(Date),
        }),
      },
    );
  });
});
