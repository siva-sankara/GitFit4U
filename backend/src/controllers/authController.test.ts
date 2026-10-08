import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  createUser: vi.fn(),
  findUser: vi.fn(),
  countUsers: vi.fn(),
  findById: vi.fn(),
  findIdentity: vi.fn(),
  updateIdentity: vi.fn(),
  createIdentity: vi.fn(),
  pendingUpdateMany: vi.fn(),
  pendingCreate: vi.fn(),
  pendingFindOne: vi.fn(),
  pendingFindOneAndUpdate: vi.fn(),
  pendingUpdateOne: vi.fn(),
  requestOtp: vi.fn(),
  invalidateOtp: vi.fn(),
  otpFindOne: vi.fn(),
  findAssignment: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
  verifyOtp: vi.fn(),
  createSession: vi.fn(),
  setRefreshCookie: vi.fn(),
  rotateRefreshToken: vi.fn(),
  emitEvent: vi.fn(),
  onboarding: vi.fn(),
  googleToken: vi.fn(),
  findSession: vi.fn(),
  revokeSession: vi.fn(),
  revokeDevices: vi.fn(),
  clearCookie: vi.fn(),
}));
vi.mock("../models/User.js", () => ({
  User: {
    exists: mocks.exists,
    create: mocks.createUser,
    findOne: mocks.findUser,
    countDocuments: mocks.countUsers,
    findById: mocks.findById,
  },
}));
vi.mock("../models/Auth.js", () => ({
  AuthIdentity: { findOne: mocks.findIdentity, findOneAndUpdate: mocks.updateIdentity, create: mocks.createIdentity },
  PendingAuthOperation: {
    updateMany: mocks.pendingUpdateMany,
    create: mocks.pendingCreate,
    findOne: mocks.pendingFindOne,
    findOneAndUpdate: mocks.pendingFindOneAndUpdate,
    updateOne: mocks.pendingUpdateOne,
  },
  OtpChallenge: { findOne: mocks.otpFindOne },
  RoleAssignment: { findOne: mocks.findAssignment },
  Session: { findOne: mocks.findSession, findOneAndUpdate: mocks.revokeSession },
  PasswordResetGrant: {},
}));
vi.mock("bcrypt", () => ({
  default: { hash: mocks.hash, compare: mocks.compare },
}));
vi.mock("../services/otpService.js", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  verifyOtp: mocks.verifyOtp,
  requestOtp: mocks.requestOtp,
  invalidateOtpOperation: mocks.invalidateOtp,
}));
vi.mock("../services/tokenService.js", () => ({
  createSession: mocks.createSession,
  setRefreshCookie: mocks.setRefreshCookie,
  clearRefreshCookie: mocks.clearCookie,
  rotateRefreshToken: mocks.rotateRefreshToken,
  signAccessToken: vi.fn(),
}));
vi.mock("../services/domainEventService.js", () => ({
  emitDomainEvent: mocks.emitEvent,
}));
vi.mock("google-auth-library", () => ({ OAuth2Client: class { verifyIdToken = mocks.googleToken; } }));
vi.mock("../services/ownerOnboardingService.js", () => ({ getOwnerOnboarding: mocks.onboarding }));
vi.mock("../models/Collaboration.js", () => ({ DeviceToken: { updateMany: mocks.revokeDevices } }));
import { register, verifySignupOtp, passwordLogin, otpRequest, otpVerify, googleLogin, switchRole, logout, refresh } from "./authController.js";
import { sha256 } from "../utils/crypto.js";
import { env } from "../config/env.js";
import type { Request, Response } from "express";
const request = (body: object) =>
  ({ body, header: vi.fn(), ip: "127.0.0.1" }) as unknown as Request;
const response = () => ({ json: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() }) as unknown as Response;
const databaseSession = {} as any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(
    async (callback: any) => callback(databaseSession),
  );
  mocks.countUsers.mockResolvedValue(0);
  mocks.pendingUpdateMany.mockResolvedValue({});
  mocks.pendingCreate.mockResolvedValue({
    _id: "pending-operation-id",
    publicId: "pending-operation-public-id",
  });
  mocks.requestOtp.mockResolvedValue({
    challengeId: "signup-challenge-public-id",
    maskedPhone: "+91••••••3210",
    expiresInSeconds: 300,
    resendInSeconds: 60,
    deliveryStatus: "SUBMITTED",
  });
});
afterEach(() => vi.restoreAllMocks());

it.each([true, false, undefined])("only marks explicit foreground activity when refreshing (activity=%s)", async (activity) => {
  const expiresAt = new Date(Date.now() + 3 * 86_400_000);
  mocks.rotateRefreshToken.mockResolvedValue({ accessToken: "access", refreshToken: "rotated", sessionId: "session", expiresAt });
  const res = response();
  await refresh({ cookies: { gfu_refresh: "session.synthetic" }, body: { activity } } as unknown as Request, res);
  expect(mocks.rotateRefreshToken).toHaveBeenCalledWith("session.synthetic", { activity: activity === true });
  expect(mocks.setRefreshCookie).toHaveBeenCalledWith(res, "rotated", expiresAt);
  expect(res.json).toHaveBeenCalledWith({ success: true, data: { accessToken: "access" } });
});

it("revokes logout using current or grace-bounded previous cookie proof without trusting the public session id", async () => {
  mocks.revokeSession.mockReturnValue({ select: () => ({ lean: async () => ({ publicId:"session", userId:"user" }) }) });
  const res = { status:vi.fn().mockReturnThis(), send:vi.fn() } as unknown as Response;
  await logout({ cookies:{ gfu_refresh:"session.synthetic-secret" } } as unknown as Request, res);
  expect(mocks.revokeSession).toHaveBeenCalledWith({ publicId:"session", revokedAt:null, $or:[
    { refreshTokenHash:sha256("session.synthetic-secret") },
    { previousRefreshTokenHash:sha256("session.synthetic-secret"), refreshGraceUntil:{ $gt:expect.any(Date) } },
  ] }, { $set:{ revokedAt:expect.any(Date), revokeReason:"LOGOUT" } }, { returnDocument:"after" });
  expect(mocks.revokeDevices).toHaveBeenCalledWith({ sessionId:"session", userId:"user", revokedAt:null }, { $set:{ revokedAt:expect.any(Date) } });
  expect(mocks.clearCookie).toHaveBeenCalledWith(res);
});

it("does not revoke device sessions when logout cookie proof does not match", async () => {
  mocks.revokeSession.mockReturnValue({ select: () => ({ lean: async () => null }) });
  const res = { status:vi.fn().mockReturnThis(), send:vi.fn() } as unknown as Response;
  await logout({ cookies:{ gfu_refresh:"session.invalid-secret" } } as unknown as Request, res);
  expect(mocks.revokeDevices).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(204);
});
describe("authentication controller", () => {
  const signup = { name: "Member", email: "member@example.com", phone: "9876543210", password: "StrongPass123", role: "USER" };
  it("persists a pending owner signup and issues no session before WhatsApp verification", async () => {
    mocks.hash.mockResolvedValue("password-hash");
    const res = response();
    await register(request({ ...signup, role: "GYM_OWNER" }), res);
    expect(mocks.pendingCreate).toHaveBeenCalledWith(expect.objectContaining({
      type: "SIGNUP",
      email: "member@example.com",
      phone: "+919876543210",
      role: "GYM_OWNER",
      passwordHash: "password-hash",
    }));
    expect(mocks.requestOtp).toHaveBeenCalledWith(
      "+919876543210",
      "SIGNUP",
      expect.objectContaining({ pendingOperationId: "pending-operation-id" }),
    );
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(202);
  });
  it.each(["isAdmin", "permissions", "approved", "ownerId", "roles"])("rejects forged %s even when controller is invoked directly", async field => {
    await expect(register(request({ ...signup, [field]: true }), response())).rejects.toHaveProperty("name", "ZodError");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it("cancels the pending signup when Meta cannot submit the OTP", async () => {
    const failure = Object.assign(new Error("Template is not approved"), {
      code: "WHATSAPP_AUTH_TEMPLATE_NOT_APPROVED",
    });
    mocks.requestOtp.mockRejectedValue(failure);
    await expect(register(request(signup), response())).rejects.toBe(failure);
    expect(mocks.pendingUpdateOne).toHaveBeenCalledWith(
      { _id: "pending-operation-id", status: "PENDING" },
      { $set: { status: "CANCELLED" } },
    );
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("does not auto-create an account through OTP login without required signup details", async () => {
    mocks.verifyOtp.mockResolvedValue({ purpose: "LOGIN", phone: "+919876543210" });
    mocks.findUser.mockResolvedValue(null);
    await expect(otpVerify(request({ challengeId: "challenge", code: "123456" }), response())).rejects.toMatchObject({ code: "SIGNUP_REQUIRED" });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("atomically creates both password and verified-phone identities after signup OTP verification", async () => {
    const detachSession = vi.fn();
    const operation = {
      _id: "pending-operation-id",
      publicId: "pending-operation-public-id",
      name: "Member",
      email: "member@example.com",
      phone: "+919876543210",
      role: "USER",
      passwordHash: "password-hash",
    };
    mocks.pendingFindOne
      .mockResolvedValueOnce(operation)
      .mockReturnValueOnce({
        select: () => ({ session: async () => operation }),
      });
    mocks.verifyOtp.mockResolvedValue({
      purpose: "SIGNUP",
      phone: operation.phone,
      pendingOperationId: operation._id,
    });
    mocks.exists.mockReturnValue({ session: async () => null });
    mocks.pendingFindOneAndUpdate.mockResolvedValue({ ...operation, status: "COMPLETED" });
    mocks.createUser.mockResolvedValue([{
      _id: "new-user-id",
      publicId: "new-user-public-id",
      roles: ["USER"],
      activeRole: "USER",
      status: "ACTIVE",
      save: vi.fn(),
      $session: detachSession,
    }]);
    mocks.createSession.mockResolvedValue({ accessToken: "access", refreshToken: "refresh" });
    const res = response();
    await verifySignupOtp(
      request({
        operationId: operation.publicId,
        challengeId: "signup-challenge-public-id",
        code: "123456",
      }),
      res,
    );
    expect(mocks.verifyOtp).toHaveBeenCalledWith(
      "signup-challenge-public-id",
      "123456",
      expect.objectContaining({
        expectedPurpose: "SIGNUP",
        pendingOperationId: operation._id,
      }),
    );
    expect(mocks.createIdentity).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ provider: "PASSWORD", passwordHash: "password-hash" }),
        expect.objectContaining({ provider: "PHONE", providerSubject: operation.phone }),
      ]),
      { session: databaseSession },
    );
    expect(mocks.createSession).toHaveBeenCalledOnce();
    expect(detachSession).toHaveBeenCalledWith(null);
  });
  it("never allows WhatsApp OTP to bypass privileged administrator sign-in", async () => {
    mocks.verifyOtp.mockResolvedValue({ purpose: "LOGIN", phone: "+919876543210" });
    mocks.countUsers.mockResolvedValue(1);
    mocks.findUser.mockResolvedValue({
      _id: "admin-user",
      publicId: "admin-public",
      status: "ACTIVE",
      roles: ["ADMIN"],
    });
    await expect(
      otpVerify(request({ challengeId: "challenge", code: "123456" }), response()),
    ).rejects.toMatchObject({ code: "ADMIN_OTP_LOGIN_FORBIDDEN" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.updateIdentity).not.toHaveBeenCalled();
  });
  it("does not auto-create an account through verified Google login without required signup details", async () => {
    const clientId = env.GOOGLE_CLIENT_ID;
    env.GOOGLE_CLIENT_ID = "isolated-test-client";
    mocks.googleToken.mockResolvedValue({ getPayload: () => ({ sub: "google-sub", email: "new@example.com", email_verified: true }) });
    mocks.findIdentity.mockResolvedValue(null);
    mocks.findUser.mockResolvedValue(null);
    try {
      await expect(googleLogin(request({ idToken: "test-verified-by-mock" }), response())).rejects.toMatchObject({ code: "SIGNUP_REQUIRED" });
      expect(mocks.createUser).not.toHaveBeenCalled();
      expect(mocks.createIdentity).not.toHaveBeenCalled();
      expect(mocks.createSession).not.toHaveBeenCalled();
    } finally { env.GOOGLE_CLIENT_ID = clientId; }
  });
  it("normalizes signup identity data into the pending operation without issuing tokens", async () => {
    mocks.hash.mockResolvedValue("hash");
    const res = response();
    await register(
      request({
        name: " Member ",
        email: "MEMBER@example.com",
        phone: "9876543210",
        password: "StrongPass123",
        role: "USER",
      }),
      res,
    );
    expect(mocks.pendingCreate).toHaveBeenCalledWith(expect.objectContaining({
      name: "Member",
      email: "member@example.com",
      phone: "+919876543210",
      role: "USER",
      passwordHash: "hash",
    }));
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.createIdentity).not.toHaveBeenCalled();
    expect(mocks.setRefreshCookie).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ purpose: "SIGNUP" }),
    }));
  });
  it("rejects an existing account before creating credentials", async () => {
    mocks.exists.mockResolvedValue(true);
    await expect(
      register(request({ name: "Member", email: "member@example.com", phone: "9876543210", password: "StrongPass123", role: "USER" }), response()),
    ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mongoose.connection.transaction).not.toHaveBeenCalled();
  });
  it("resolves phone login to the existing password identity", async () => {
    mocks.findUser.mockResolvedValue({ _id: "user1" });
    mocks.findIdentity.mockReturnValue({
      select: vi
        .fn()
        .mockResolvedValue({ userId: "user1", passwordHash: "hash" }),
    });
    mocks.compare.mockResolvedValue(true);
    mocks.findById.mockResolvedValue({
      _id: "user1",
      status: "ACTIVE",
      activeRole: "USER",
      roles: ["USER"],
      save: vi.fn(),
    });
    mocks.createSession.mockResolvedValue({ accessToken: "token" });
    await passwordLogin(
      request({ identifier: "9876543210", password: "StrongPass123" }),
      response(),
    );
    expect(mocks.findIdentity).toHaveBeenCalledWith({
      provider: "PASSWORD",
      userId: "user1",
    });
    expect(mocks.compare).toHaveBeenCalledWith("StrongPass123", "hash");
  });
  it("requires the OTP service to enforce a login-purpose challenge", async () => {
    mocks.verifyOtp.mockRejectedValue(
      Object.assign(new Error("Wrong purpose"), { code: "OTP_PURPOSE_INVALID" }),
    );
    await expect(
      otpVerify(
        request({ challengeId: "challenge", code: "123456" }),
        response(),
      ),
    ).rejects.toMatchObject({ code: "OTP_PURPOSE_INVALID" });
    expect(mocks.verifyOtp).toHaveBeenCalledWith("challenge", "123456", {
      expectedPurpose: "LOGIN",
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
});

describe("local test login previews", () => {
  const original = { mode: env.OTP_MODE, enabled: env.OTP_DEV_PREVIEW_ENABLED };
  beforeEach(() => { env.OTP_MODE = "development_preview"; env.OTP_DEV_PREVIEW_ENABLED = true; });
  afterEach(() => { env.OTP_MODE = original.mode; env.OTP_DEV_PREVIEW_ENABLED = original.enabled; });
  const account = () => ({ _id: "local-test-user", publicId: "local-test-public", developmentTestAccount: true, status: "ACTIVE", roles: ["USER"], activeRole: "USER", save: vi.fn() });
  it("returns the login preview only for an active local test account", async () => {
    mocks.findUser.mockResolvedValue(account());
    mocks.requestOtp.mockResolvedValue({ challengeId: "test-challenge", deliveryStatus: "SIMULATED", developmentPreview: { code: "246810", simulated: true } });
    const res = response();
    await otpRequest(request({ phone: "9876543210" }), res);
    expect(mocks.findUser).toHaveBeenCalledWith({ phone: "+919876543210" });
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining("No WhatsApp message or email was sent"), data: expect.objectContaining({ purpose: "LOGIN", developmentPreview: { code: "246810", simulated: true } }) }));
  });
  it.each([
    { developmentTestAccount: false }, { status: "SUSPENDED" }, { roles: ["ADMIN"] },
  ])("refuses preview requests for an ineligible account: %j", async overrides => {
    mocks.findUser.mockResolvedValue({ ...account(), ...overrides });
    await expect(otpRequest(request({ phone: "9876543210" }), response())).rejects.toMatchObject({ code: "PREVIEW_ACCOUNT_FORBIDDEN" });
    expect(mocks.requestOtp).not.toHaveBeenCalled();
  });
  it("requires signup before test login", async () => {
    mocks.findUser.mockResolvedValue(null);
    await expect(otpRequest(request({ phone: "9876543210" }), response())).rejects.toMatchObject({ code: "SIGNUP_REQUIRED" });
    expect(mocks.requestOtp).not.toHaveBeenCalled();
  });
  it("logs in the test account without marking its phone provider-verified", async () => {
    mocks.verifyOtp.mockResolvedValue({ purpose: "LOGIN", phone: "+919876543210", simulated: true });
    mocks.findUser.mockResolvedValue(account());
    mocks.findIdentity.mockResolvedValue({ userId: "local-test-user", verificationSource: "DEVELOPMENT_SIMULATION" });
    mocks.createSession.mockResolvedValue({ accessToken: "test-access", refreshToken: "test-refresh" });
    await otpVerify(request({ challengeId: "test-challenge", code: "246810" }), response());
    expect(mocks.updateIdentity).not.toHaveBeenCalled();
    expect(mocks.emitEvent).not.toHaveBeenCalled();
    expect(mocks.createSession).toHaveBeenCalledOnce();
  });
  it("rechecks the test-account boundary at verification", async () => {
    mocks.verifyOtp.mockResolvedValue({ purpose: "LOGIN", phone: "+919876543210", simulated: true });
    mocks.findUser.mockResolvedValue({ ...account(), developmentTestAccount: false });
    await expect(otpVerify(request({ challengeId: "test-challenge", code: "246810" }), response())).rejects.toMatchObject({ code: "PREVIEW_ACCOUNT_FORBIDDEN" });
    expect(mocks.createSession).not.toHaveBeenCalled(); expect(mocks.updateIdentity).not.toHaveBeenCalled();
  });
});

describe("login active role resolution", () => {
  it("resolves an omitted active owner gym from authoritative onboarding and validates its assignment", async () => {
    const user = { _id: "user1", roles: ["USER", "GYM_OWNER"], save: vi.fn() };
    const session = { save: vi.fn() } as any;
    mocks.findById.mockResolvedValue(user);
    mocks.onboarding.mockResolvedValue({ state: "ACTIVE", gymId: "owned-gym" });
    mocks.findAssignment.mockResolvedValue({ gymId: "owned-gym" });
    mocks.findSession.mockResolvedValue(session);
    await switchRole({ ...request({ role: "GYM_OWNER" }), auth: { userId: "user1", sessionId: "session" } } as Request, response());
    expect(mocks.findAssignment).toHaveBeenCalledWith({ userId: "user1", role: "GYM_OWNER", gymId: "owned-gym", status: "ACTIVE" });
    expect(session.activeGymId).toBe("owned-gym");
    mocks.findAssignment.mockResolvedValue(null);
    await expect(switchRole({ ...request({ role: "GYM_OWNER" }), auth: { userId: "user1", sessionId: "session" } } as Request, response())).rejects.toMatchObject({ code: "GYM_ACCESS_DENIED" });
    expect(session.save).toHaveBeenCalledTimes(1);
  });
  const credentials = {
    identifier: "member@example.com",
    password: "StrongPass123",
  };
  function account(activeRole: string, roles: string[]) {
    const user = {
      _id: "user1",
      status: "ACTIVE",
      activeRole,
      roles,
      save: vi.fn(),
    };
    mocks.findIdentity.mockReturnValue({
      select: vi
        .fn()
        .mockResolvedValue({ userId: "user1", passwordHash: "hash" }),
    });
    mocks.findById.mockResolvedValue(user);
    mocks.compare.mockResolvedValue(true);
    mocks.createSession.mockResolvedValue({
      accessToken: "token",
      refreshToken: "refresh",
    });
    return user;
  }

  it.each(["GYM_OWNER", "GYM_STAFF", "TRAINER"])(
    "keeps the valid preferred %s role and gym",
    async (role) => {
      account(role, ["USER", role]);
      mocks.findAssignment.mockResolvedValue({ gymId: "gym1" });
      const res = response();
      await passwordLogin(request(credentials), res);
      expect(mocks.findAssignment).toHaveBeenCalledWith({
        userId: "user1",
        role,
        status: "ACTIVE",
        gymId: { $ne: null },
      });
      expect(mocks.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ activeRole: role, activeGymId: "gym1" }),
      );
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            user: expect.objectContaining({
              activeRole: role,
              activeGymId: "gym1",
            }),
          }),
        }),
      );
    },
  );

  it.each(["USER", "ADMIN"])(
    "keeps an assigned preferred %s role without a gym lookup",
    async (role) => {
      account(role, ["USER", "ADMIN"]);
      await passwordLogin(request(credentials), response());
      expect(mocks.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ activeRole: role, activeGymId: undefined }),
      );
      expect(mocks.findAssignment).not.toHaveBeenCalled();
    },
  );

  it("retains owner onboarding without assigning gym access when no gym assignment exists", async () => {
    const user = account("GYM_OWNER", ["ADMIN", "GYM_OWNER", "USER"]);
    mocks.findAssignment.mockResolvedValue(null);
    await passwordLogin(request(credentials), response());
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ activeRole: "GYM_OWNER", activeGymId: undefined }),
    );
    expect(user.activeRole).toBe("GYM_OWNER");
    expect(user.save).toHaveBeenCalledOnce();
    expect(mocks.setRefreshCookie).toHaveBeenCalledOnce();
  });
  it("rejects an active owner whose existing gym assignment is unavailable instead of issuing a misleading onboarding session", async () => {
    account("GYM_OWNER", ["USER", "GYM_OWNER"]);
    mocks.onboarding.mockResolvedValue({ state: "ACTIVE", gymId: "active-gym" });
    mocks.findAssignment.mockResolvedValue(null);
    await expect(passwordLogin(request(credentials), response())).rejects.toMatchObject({ code: "ROLE_ACCESS_UNAVAILABLE", statusCode: 403 });
    expect(mocks.findAssignment).toHaveBeenCalledWith(expect.objectContaining({ role: "GYM_OWNER", gymId: "active-gym", status: "ACTIVE" }));
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it.each(["ADMIN", "OBSOLETE_ROLE"])(
    "does not retain an unassigned stored %s role",
    async (role) => {
      account(role, ["USER"]);
      await passwordLogin(request(credentials), response());
      expect(mocks.createSession).toHaveBeenCalledWith(
        expect.objectContaining({ activeRole: "USER" }),
      );
      expect(mocks.findAssignment).not.toHaveBeenCalled();
    },
  );

  it("rejects a revoked gym role before issuing tokens when no member fallback is assigned", async () => {
    const user = account("GYM_STAFF", ["GYM_STAFF"]);
    mocks.findAssignment.mockResolvedValue(null);
    await expect(
      passwordLogin(request(credentials), response()),
    ).rejects.toMatchObject({
      statusCode: 403,
      code: "ROLE_ACCESS_UNAVAILABLE",
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.setRefreshCookie).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  });

  it("never switches an invalid preferred role to another privileged role", async () => {
    account("GYM_OWNER", ["ADMIN"]);
    await expect(
      passwordLogin(request(credentials), response()),
    ).rejects.toMatchObject({ code: "ROLE_ACCESS_UNAVAILABLE" });
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(mocks.setRefreshCookie).not.toHaveBeenCalled();
    expect(mocks.findAssignment).not.toHaveBeenCalled();
  });

  it("treats an assignment without a gym as unavailable", async () => {
    account("TRAINER", ["TRAINER", "USER"]);
    mocks.findAssignment.mockResolvedValue({ gymId: null });
    await passwordLogin(request(credentials), response());
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ activeRole: "USER", activeGymId: undefined }),
    );
  });
});
