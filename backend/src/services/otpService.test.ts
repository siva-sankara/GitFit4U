import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashOtp } from "../utils/crypto.js";
import { env } from "../config/env.js";

const mocks = vi.hoisted(() => ({
  findOne: vi.fn(),
  countDocuments: vi.fn(),
  updateMany: vi.fn(),
  create: vi.fn(),
  updateOne: vi.fn(),
  findOneAndUpdate: vi.fn(),
  send: vi.fn(),
  queueDeliveries: vi.fn(),
  deliverChallenge: vi.fn(),
  recordMobileStatus: vi.fn(),
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
vi.mock("./authOtpDeliveryService.js", () => ({
  queueAuthOtpDeliveries: mocks.queueDeliveries,
  deliverAuthOtpChallenge: mocks.deliverChallenge,
  recordAuthOtpMobileStatus: mocks.recordMobileStatus,
}));

import { normalizePhone, requestOtp, verifyOtp } from "./otpService.js";

const originalDualDelivery = env.AUTH_OTP_DUAL_DELIVERY_ENABLED;

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
  env.AUTH_OTP_DUAL_DELIVERY_ENABLED = false;
  requestQuery();
  mocks.countDocuments.mockResolvedValue(0);
  mocks.updateMany.mockResolvedValue({ modifiedCount: 0 });
  mocks.create.mockImplementation(async (value) => ({ _id: "mongo-challenge", ...value }));
  mocks.updateOne.mockResolvedValue({ matchedCount: 1 });
  mocks.send.mockResolvedValue({ providerMessageId: "wamid.otp" });
  mocks.deliverChallenge.mockResolvedValue({
    rows: [
      { channel: "MOBILE", status: "SUBMITTED" },
      { channel: "EMAIL", status: "SUBMITTED" },
    ],
    deliveryStatus: "SUBMITTED",
    hasAccepted: true,
    allFailed: false,
  });
});
afterEach(() => {
  vi.useRealTimers();
  env.AUTH_OTP_DUAL_DELIVERY_ENABLED = originalDualDelivery;
});

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

describe("isolated development signup and login transport", () => {
  it("returns only the current simulated code, stores its HMAC, and uses the real verifier", async () => {
    const original = { mode: env.OTP_MODE, enabled: env.OTP_DEV_PREVIEW_ENABLED };
    try {
      env.OTP_MODE = "development_preview"; env.OTP_DEV_PREVIEW_ENABLED = true;
      const result = await requestOtp("9876543210", "SIGNUP", { pendingOperationId: "signup-operation", ipAddress: "127.0.0.1" });
      const code = result.developmentPreview!.code;
      expect(code).toMatch(/^\d{6}$/); expect(result.deliveryStatus).toBe("SIMULATED");
      expect(mocks.send).not.toHaveBeenCalled();
      const stored = mocks.create.mock.calls[0][0];
      expect(stored.codeHash).toBe(hashOtp(result.challengeId, code));
      expect(stored).not.toHaveProperty("code"); expect(stored).not.toHaveProperty("developmentPreview");
      const row = { ...stored, _id: "challenge", attempts: 0, maxAttempts: 5, deliveryStatus: "SIMULATED" };
      verificationQuery(row); mocks.findOneAndUpdate.mockResolvedValue({ ...row, consumedAt: new Date() });
      await expect(verifyOtp(result.challengeId, code, { expectedPurpose: "SIGNUP", pendingOperationId: "signup-operation" })).resolves.toMatchObject({ simulated: true });
      verificationQuery({ ...row, consumedAt: new Date() });
      await expect(verifyOtp(result.challengeId, code)).rejects.toMatchObject({ code: "OTP_INVALID" });
      env.OTP_MODE = "whatsapp"; verificationQuery(row);
      await expect(verifyOtp(result.challengeId, code)).rejects.toMatchObject({ code: "OTP_INVALID" });
    } finally { env.OTP_MODE = original.mode; env.OTP_DEV_PREVIEW_ENABLED = original.enabled; }
  });
  it("keeps the prior usable challenge when replacement delivery fails", async () => {
    mocks.send.mockRejectedValue(new Error("Provider unavailable"));
    await expect(requestOtp("9876543210", "LOGIN")).rejects.toThrow("Provider unavailable");
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
  it("issues a single-use login preview without messaging and rejects it once previews are disabled", async () => {
    const original = { mode: env.OTP_MODE, enabled: env.OTP_DEV_PREVIEW_ENABLED };
    try {
      env.OTP_MODE = "development_preview"; env.OTP_DEV_PREVIEW_ENABLED = true;
      const result = await requestOtp("9876543210", "LOGIN", { ipAddress: "127.0.0.1" });
      const code = result.developmentPreview!.code;
      expect(code).toMatch(/^\d{6}$/);
      expect(mocks.send).not.toHaveBeenCalled();
      const stored = mocks.create.mock.calls[0][0];
      expect(stored.codeHash).toBe(hashOtp(result.challengeId, code));
      expect(stored).not.toHaveProperty("code");
      const row = { ...stored, _id: "challenge", attempts: 0, maxAttempts: 5, deliveryStatus: "SIMULATED" };
      verificationQuery(row); mocks.findOneAndUpdate.mockResolvedValue({ ...row, consumedAt: new Date() });
      await expect(verifyOtp(result.challengeId, code, { expectedPurpose: "LOGIN" })).resolves.toMatchObject({ simulated: true, purpose: "LOGIN" });
      verificationQuery({ ...row, consumedAt: new Date() });
      await expect(verifyOtp(result.challengeId, code)).rejects.toMatchObject({ code: "OTP_INVALID" });
      env.OTP_DEV_PREVIEW_ENABLED = false; verificationQuery(row);
      await expect(verifyOtp(result.challengeId, code)).rejects.toMatchObject({ code: "OTP_INVALID" });
    } finally { env.OTP_MODE = original.mode; env.OTP_DEV_PREVIEW_ENABLED = original.enabled; }
  });
  it.each(["ACCOUNT_RECOVERY", "STEP_UP"] as const)("does not expose a test code for %s", async purpose => {
    const original = { mode: env.OTP_MODE, enabled: env.OTP_DEV_PREVIEW_ENABLED };
    try {
      env.OTP_MODE = "development_preview"; env.OTP_DEV_PREVIEW_ENABLED = true;
      await expect(requestOtp("9876543210", purpose)).rejects.toMatchObject({ code: "PREVIEW_PURPOSE_FORBIDDEN" });
      expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
    } finally { env.OTP_MODE = original.mode; env.OTP_DEV_PREVIEW_ENABLED = original.enabled; }
  });
  it("never adds a preview to the normal production transport response", async () => {
    const result = await requestOtp("9876543210", "LOGIN");
    expect(result).not.toHaveProperty("developmentPreview");
    expect(JSON.stringify(result)).not.toContain(mocks.send.mock.calls[0][1]);
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

  it("invalidates earlier codes only after a replacement is accepted", async () => {
    await requestOtp("+919876543210", "LOGIN", { ipAddress: "203.0.113.11" });
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        purpose: "LOGIN",
        consumedAt: null,
      }),
      { $set: { consumedAt: expect.any(Date) } },
    );
    expect(mocks.updateMany.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.send.mock.invocationCallOrder[0]);
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

  it("allows only one concurrent replacement to claim the prior challenge", async () => {
    requestQuery({
      _id: "previous-challenge",
      resendAvailableAt: new Date(Date.now() - 1_000),
    });
    mocks.findOneAndUpdate.mockResolvedValue(null);
    await expect(
      requestOtp("+919876543210", "LOGIN", { ipAddress: "203.0.113.16" }),
    ).rejects.toMatchObject({
      code: "OTP_RESEND_IN_PROGRESS",
      details: { retryAfterSeconds: 2 },
    });
    expect(mocks.create).not.toHaveBeenCalled();
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

  it("allows verification after an uncertain submission because the same code may still arrive", async () => {
    const stored = challenge({ deliveryStatus: "UNKNOWN" });
    verificationQuery(stored);
    mocks.findOneAndUpdate.mockResolvedValue({ ...stored, consumedAt: new Date() });
    await expect(verifyOtp(stored.publicId, "123456")).resolves.toMatchObject({
      phone: stored.phone,
    });
  });
});

describe("shared mobile and Microsoft 365 OTP delivery", () => {
  it("queues one generated signup code for both channels without returning it", async () => {
    const previous = env.AUTH_OTP_DUAL_DELIVERY_ENABLED;
    env.AUTH_OTP_DUAL_DELIVERY_ENABLED = true;
    try {
      const result = await requestOtp("9876543210", "SIGNUP", {
        pendingOperationId: "signup-operation",
        email: "member@example.com",
        ipAddress: "203.0.113.20",
      });
      expect(mocks.queueDeliveries).toHaveBeenCalledOnce();
      const queued = mocks.queueDeliveries.mock.calls[0][0];
      expect(queued).toMatchObject({
        phone: "+919876543210",
        email: "member@example.com",
        purpose: "SIGNUP",
      });
      expect(queued.code).toMatch(/^\d{6}$/);
      expect(mocks.create.mock.calls[0][0].codeHash).toBe(
        hashOtp(result.challengeId, queued.code),
      );
      expect(result).toMatchObject({
        dualDelivery: true,
        maskedEmail: expect.stringContaining("@example.com"),
        deliveryStatus: "SUBMITTED",
      });
      expect(JSON.stringify(result)).not.toContain(queued.code);
      expect(mocks.send).not.toHaveBeenCalled();
    } finally {
      env.AUTH_OTP_DUAL_DELIVERY_ENABLED = previous;
    }
  });

  it("continues signup when email is accepted and WhatsApp fails", async () => {
    const previous = env.AUTH_OTP_DUAL_DELIVERY_ENABLED;
    env.AUTH_OTP_DUAL_DELIVERY_ENABLED = true;
    mocks.deliverChallenge.mockResolvedValueOnce({
      rows: [
        {
          channel: "MOBILE",
          status: "FAILED",
          lastErrorCode: "WHATSAPP_AUTH_NOT_CONFIGURED",
        },
        { channel: "EMAIL", status: "SUBMITTED" },
      ],
      deliveryStatus: "SUBMITTED",
      hasAccepted: true,
      allFailed: false,
    });
    try {
      await expect(
        requestOtp("9876543210", "SIGNUP", {
          pendingOperationId: "signup-operation",
          email: "member@example.com",
          ipAddress: "203.0.113.21",
        }),
      ).resolves.toMatchObject({
        dualDelivery: true,
        deliveryStatus: "SUBMITTED",
        channelDelivery: {
          mobile: {
            status: "FAILED",
          },
          email: { status: "SUBMITTED" },
        },
      });
      expect(mocks.send).not.toHaveBeenCalled();
    } finally {
      env.AUTH_OTP_DUAL_DELIVERY_ENABLED = previous;
    }
  });

  it("fails the request only when neither WhatsApp nor email accepts the code", async () => {
    const previous = env.AUTH_OTP_DUAL_DELIVERY_ENABLED;
    env.AUTH_OTP_DUAL_DELIVERY_ENABLED = true;
    mocks.deliverChallenge.mockResolvedValueOnce({
      rows: [
        { channel: "MOBILE", status: "FAILED" },
        { channel: "EMAIL", status: "FAILED" },
      ],
      deliveryStatus: "FAILED",
      hasAccepted: false,
      allFailed: true,
    });
    try {
      await expect(
        requestOtp("9876543210", "SIGNUP", {
          pendingOperationId: "signup-operation",
          email: "member@example.com",
          ipAddress: "203.0.113.22",
        }),
      ).rejects.toMatchObject({ code: "OTP_DELIVERY_FAILED" });
    } finally {
      env.AUTH_OTP_DUAL_DELIVERY_ENABLED = previous;
    }
  });

  it("supports an email-only account-recovery challenge", async () => {
    const previous = env.AUTH_OTP_DUAL_DELIVERY_ENABLED;
    env.AUTH_OTP_DUAL_DELIVERY_ENABLED = true;
    mocks.deliverChallenge.mockResolvedValueOnce({
      rows: [{ channel: "EMAIL", status: "SUBMITTED" }],
      deliveryStatus: "SUBMITTED",
      hasAccepted: true,
      allFailed: false,
    });
    try {
      const result = await requestOtp(undefined, "ACCOUNT_RECOVERY", {
        userId: "account-id",
        email: "member@example.com",
        sendMobile: false,
        ipAddress: "203.0.113.23",
      });
      expect(mocks.queueDeliveries).toHaveBeenCalledWith(
        expect.objectContaining({
          phone: undefined,
          email: "member@example.com",
          sendMobile: false,
          purpose: "ACCOUNT_RECOVERY",
        }),
      );
      expect(result).toMatchObject({ deliveryStatus: "SUBMITTED" });
      expect(result).not.toHaveProperty("maskedEmail");
      expect(result).not.toHaveProperty("maskedPhone");
    } finally {
      env.AUTH_OTP_DUAL_DELIVERY_ENABLED = previous;
    }
  });

  it("does not disclose the registered email or dual-channel enrollment during login", async () => {
    const previous = env.AUTH_OTP_DUAL_DELIVERY_ENABLED;
    env.AUTH_OTP_DUAL_DELIVERY_ENABLED = true;
    try {
      const result = await requestOtp("9876543210", "LOGIN", {
        userId: "account-id",
        email: "private@example.com",
      });
      expect(result).not.toHaveProperty("maskedEmail");
      expect(result).not.toHaveProperty("dualDelivery");
      expect(result).not.toHaveProperty("channelDelivery");
    } finally {
      env.AUTH_OTP_DUAL_DELIVERY_ENABLED = previous;
    }
  });
});
