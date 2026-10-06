import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256 } from "../utils/crypto.js";

const mocks = vi.hoisted(() => ({
  userLock: vi.fn(),
  grantExists: vi.fn(),
  consume: vi.fn(),
  revokeGrants: vi.fn(),
  createGrant: vi.fn(),
  identity: vi.fn(),
  sessions: vi.fn(),
  hash: vi.fn(),
  otp: vi.fn(),
  clearCookie: vi.fn(),
}));
vi.mock("../models/User.js", () => ({
  User: { findOneAndUpdate: mocks.userLock },
}));
vi.mock("../models/Auth.js", () => ({
  AuthIdentity: { findOneAndUpdate: mocks.identity },
  Session: { updateMany: mocks.sessions },
  RoleAssignment: {},
  PasswordResetGrant: {
    exists: mocks.grantExists,
    findOneAndUpdate: mocks.consume,
    updateMany: mocks.revokeGrants,
    create: mocks.createGrant,
  },
  OtpChallenge: {},
  PendingAuthOperation: {},
}));
vi.mock("bcrypt", () => ({ default: { hash: mocks.hash } }));
vi.mock("../services/otpService.js", () => ({
  verifyOtp: mocks.otp,
  requestOtp: vi.fn(),
  normalizePhone: vi.fn(),
}));
vi.mock("../services/tokenService.js", () => ({
  createSession: vi.fn(),
  setRefreshCookie: vi.fn(),
  clearRefreshCookie: mocks.clearCookie,
  rotateRefreshToken: vi.fn(),
  signAccessToken: vi.fn(),
}));
vi.mock("../services/domainEventService.js", () => ({
  emitDomainEvent: vi.fn(),
}));
import { resetPassword, verifyRecoveryOtp } from "./authController.js";

const session = {} as any;
const token = "recovery-public.long-random-token-secret";
const request = () =>
  ({ body: { resetToken: token, password: "ValidPassword123" } }) as any;
const response = () => ({ json: vi.fn() }) as any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(
    async (callback: any) => callback(session),
  );
  mocks.grantExists.mockResolvedValue({ _id: "grant" });
  mocks.consume.mockResolvedValue({ _id: "grant", userId: "user" });
  mocks.userLock.mockResolvedValue({
    _id: "user",
    email: "current@example.com",
    status: "ACTIVE",
  });
  mocks.hash.mockResolvedValue("new-password-hash");
});
afterEach(() => vi.restoreAllMocks());

describe("atomic password recovery", () => {
  it("consumes the valid token, locks the current active account and resets identity/sessions in one transaction", async () => {
    const res = response();
    await resetPassword(request(), res);
    expect(mocks.grantExists).toHaveBeenCalledWith({
      publicId: "recovery-public",
      tokenHash: sha256(token),
      consumedAt: null,
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(mocks.hash).toHaveBeenCalledWith("ValidPassword123", 12);
    expect(mocks.hash.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(mongoose.connection.transaction).mock.invocationCallOrder[0],
    );
    expect(mocks.consume).toHaveBeenCalledWith(
      {
        publicId: "recovery-public",
        tokenHash: sha256(token),
        consumedAt: null,
        expiresAt: { $gt: expect.any(Date) },
      },
      { $set: { consumedAt: expect.any(Date) } },
      { session, returnDocument: "after" },
    );
    expect(mocks.userLock).toHaveBeenCalledWith(
      { _id: "user", status: "ACTIVE" },
      { $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    expect(mocks.identity).toHaveBeenCalledWith(
      { userId: "user", provider: "PASSWORD" },
      {
        $set: {
          providerSubject: "current@example.com",
          passwordHash: "new-password-hash",
          verifiedAt: expect.any(Date),
        },
      },
      { session, upsert: true, returnDocument: "after", runValidators: true },
    );
    expect(mocks.revokeGrants).toHaveBeenCalledWith(
      { userId: "user", consumedAt: null },
      { $set: { consumedAt: expect.any(Date) } },
      { session },
    );
    expect(mocks.sessions).toHaveBeenCalledWith(
      { userId: "user", revokedAt: null },
      { $set: { revokedAt: expect.any(Date), revokeReason: "PASSWORD_RESET" } },
      { session },
    );
    expect(mocks.clearCookie).toHaveBeenCalledWith(res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });

  it("rejects a missing, expired, consumed or wrong-secret token before expensive hashing", async () => {
    mocks.grantExists.mockResolvedValue(null);
    await expect(resetPassword(request(), response())).rejects.toMatchObject({
      code: "RESET_TOKEN_INVALID",
    });
    expect(mocks.hash).not.toHaveBeenCalled();
    expect(mocks.consume).not.toHaveBeenCalled();
  });

  it("rejects a token invalidated by an administrator while its password hash was being computed", async () => {
    mocks.consume.mockResolvedValue(null);
    await expect(resetPassword(request(), response())).rejects.toMatchObject({
      code: "RESET_TOKEN_INVALID",
    });
    expect(mocks.hash).toHaveBeenCalledOnce();
    expect(mocks.userLock).not.toHaveBeenCalled();
    expect(mocks.identity).not.toHaveBeenCalled();
    expect(mocks.clearCookie).not.toHaveBeenCalled();
  });

  it("allows only one of two concurrent consumers of the same grant to change credentials", async () => {
    mocks.consume
      .mockResolvedValueOnce({ _id: "grant", userId: "user" })
      .mockResolvedValueOnce(null);
    const result = await Promise.allSettled([
      resetPassword(request(), response()),
      resetPassword(request(), response()),
    ]);
    expect(result.filter((value) => value.status === "fulfilled")).toHaveLength(
      1,
    );
    expect(result.find((value) => value.status === "rejected")).toMatchObject({
      reason: { code: "RESET_TOKEN_INVALID" },
    });
    expect(mocks.identity).toHaveBeenCalledOnce();
    expect(mocks.sessions).toHaveBeenCalledOnce();
  });

  it("does not reset credentials for a missing, disabled or pending account", async () => {
    mocks.userLock.mockResolvedValue(null);
    await expect(resetPassword(request(), response())).rejects.toMatchObject({
      code: "RESET_TOKEN_INVALID",
    });
    expect(mocks.userLock.mock.calls[0][0]).toEqual({
      _id: "user",
      status: "ACTIVE",
    });
    expect(mocks.identity).not.toHaveBeenCalled();
  });

  it.each(["identity", "revokeGrants", "sessions"] as const)(
    "does not report success if transaction write %s fails",
    async (step) => {
      const failure = new Error("Write failed");
      mocks[step].mockRejectedValue(failure);
      const res = response();
      await expect(resetPassword(request(), res)).rejects.toBe(failure);
      expect(res.json).not.toHaveBeenCalled();
      expect(mocks.clearCookie).not.toHaveBeenCalled();
    },
  );

  it("uses the phone credential for an active account that has no email", async () => {
    mocks.userLock.mockResolvedValue({
      _id: "user",
      phone: "+919876543210",
      status: "ACTIVE",
    });
    await resetPassword(request(), response());
    expect(mocks.identity.mock.calls[0][1].$set.providerSubject).toBe(
      "+919876543210",
    );
  });
});

describe("recovery grant issuance and administrative identity edits", () => {
  const otpRequest = () =>
    ({ body: { challengeId: "challenge", code: "123456" } }) as any;
  it("issues the grant transactionally after rechecking and locking the verified phone account", async () => {
    mocks.otp.mockResolvedValue({
      purpose: "ACCOUNT_RECOVERY",
      phone: "+919876543210",
    });
    const res = response();
    await verifyRecoveryOtp(otpRequest(), res);
    expect(mocks.userLock).toHaveBeenCalledWith(
      { phone: "+919876543210", status: "ACTIVE" },
      { $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    const issuedToken = res.json.mock.calls[0][0].data.resetToken;
    expect(mocks.createGrant).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: "user",
          tokenHash: sha256(issuedToken),
          expiresAt: expect.any(Date),
        }),
      ],
      { session },
    );
    expect(mocks.userLock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.createGrant.mock.invocationCallOrder[0],
    );
  });

  it("does not mint a grant for a replaced phone or an inactive account", async () => {
    mocks.otp.mockResolvedValue({
      purpose: "ACCOUNT_RECOVERY",
      phone: "+919876543210",
    });
    mocks.userLock.mockResolvedValue(null);
    await expect(
      verifyRecoveryOtp(otpRequest(), response()),
    ).rejects.toMatchObject({ code: "RECOVERY_FAILED" });
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });

  it("requires the OTP service to enforce an account-recovery challenge", async () => {
    mocks.otp.mockRejectedValue(
      Object.assign(new Error("Wrong purpose"), { code: "OTP_PURPOSE_INVALID" }),
    );
    await expect(
      verifyRecoveryOtp(otpRequest(), response()),
    ).rejects.toMatchObject({ code: "OTP_PURPOSE_INVALID" });
    expect(mocks.otp).toHaveBeenCalledWith("challenge", "123456", {
      expectedPurpose: "ACCOUNT_RECOVERY",
    });
    expect(mocks.userLock).not.toHaveBeenCalled();
    expect(mocks.createGrant).not.toHaveBeenCalled();
  });
});
