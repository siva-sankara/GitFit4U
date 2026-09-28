import { beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { afterEach } from "vitest";
const mocks = vi.hoisted(() => ({
  exists: vi.fn(),
  createUser: vi.fn(),
  findUser: vi.fn(),
  findById: vi.fn(),
  findIdentity: vi.fn(),
  createIdentity: vi.fn(),
  findAssignment: vi.fn(),
  compare: vi.fn(),
  hash: vi.fn(),
  verifyOtp: vi.fn(),
  createSession: vi.fn(),
  setRefreshCookie: vi.fn(),
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
    findById: mocks.findById,
  },
}));
vi.mock("../models/Auth.js", () => ({
  AuthIdentity: { findOne: mocks.findIdentity, create: mocks.createIdentity },
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
}));
vi.mock("../services/tokenService.js", () => ({
  createSession: mocks.createSession,
  setRefreshCookie: mocks.setRefreshCookie,
  clearRefreshCookie: mocks.clearCookie,
  rotateRefreshToken: vi.fn(),
  signAccessToken: vi.fn(),
}));
vi.mock("../services/domainEventService.js", () => ({
  emitDomainEvent: mocks.emitEvent,
}));
vi.mock("google-auth-library", () => ({ OAuth2Client: class { verifyIdToken = mocks.googleToken; } }));
vi.mock("../services/ownerOnboardingService.js", () => ({ getOwnerOnboarding: mocks.onboarding }));
vi.mock("../models/Collaboration.js", () => ({ DeviceToken: { updateMany: mocks.revokeDevices } }));
import { register, passwordLogin, otpVerify, googleLogin, switchRole, logout } from "./authController.js";
import { sha256 } from "../utils/crypto.js";
import { env } from "../config/env.js";
import type { Request, Response } from "express";
const request = (body: object) =>
  ({ body, header: vi.fn(), ip: "127.0.0.1" }) as unknown as Request;
const response = () => ({ json: vi.fn() }) as unknown as Response;
const databaseSession = {} as any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(
    async (callback: any) => callback(databaseSession),
  );
});
afterEach(() => vi.restoreAllMocks());

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
  it("persists a new owner role and returns onboarding without assigning a gym", async () => {
    mocks.createUser.mockImplementation(async values => [{ ...values[0], _id: "owner", save: vi.fn(), $session: vi.fn() }]);
    mocks.createSession.mockResolvedValue({ accessToken: "token", refreshToken: "refresh" });
    mocks.onboarding.mockResolvedValue({ state: "NOT_STARTED" });
    const res = response();
    await register(request({ ...signup, role: "GYM_OWNER" }), res);
    expect(mocks.createUser).toHaveBeenCalledWith([expect.objectContaining({ roles: ["GYM_OWNER"], activeRole: "GYM_OWNER" })], { session: databaseSession });
    expect(mocks.createSession).toHaveBeenCalledWith(expect.objectContaining({ activeRole: "GYM_OWNER", activeGymId: undefined }));
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ user: expect.objectContaining({ onboarding: { state: "NOT_STARTED" } }) }) }));
  });
  it.each(["isAdmin", "permissions", "approved", "ownerId", "roles"])("rejects forged %s even when controller is invoked directly", async field => {
    await expect(register(request({ ...signup, [field]: true }), response())).rejects.toHaveProperty("name", "ZodError");
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
  it.each(["email", "phone"])("returns safe recovery guidance for concurrent %s duplicate-key conflicts", async field => {
    mocks.exists.mockResolvedValue(false);
    mocks.createUser.mockRejectedValue({ code: 11000, keyPattern: { [field]: 1 }, keyValue: { [field]: "private" } });
    await expect(register(request(signup), response())).rejects.toMatchObject({ code: "ACCOUNT_EXISTS", statusCode: 409 });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });
  it("does not auto-create an account through OTP login without required signup details", async () => {
    mocks.verifyOtp.mockResolvedValue({ purpose: "LOGIN", phone: "+919876543210" });
    mocks.findUser.mockResolvedValue(null);
    await expect(otpVerify(request({ challengeId: "challenge", code: "123456" }), response())).rejects.toMatchObject({ code: "SIGNUP_REQUIRED" });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.createSession).not.toHaveBeenCalled();
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
  it("registers a normalized member account and returns a session", async () => {
    mocks.hash.mockResolvedValue("hash");
    const detachSession = vi.fn();
    mocks.createUser.mockImplementation(async (values) => [
      {
        ...values[0],
        _id: "user1",
        save: vi.fn(),
        $session: detachSession,
      },
    ]);
    mocks.createSession.mockResolvedValue({
      accessToken: "token",
      refreshToken: "refresh",
    });
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
    expect(mocks.createUser).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          name: "Member",
          email: "member@example.com",
          phone: "+919876543210",
          roles: ["USER"],
        }),
      ],
      { session: databaseSession },
    );
    expect(mocks.createIdentity).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          userId: "user1",
          provider: "PASSWORD",
          providerSubject: "member@example.com",
          passwordHash: "hash",
        }),
      ],
      { session: databaseSession },
    );
    expect(mocks.emitEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "account.registered",
        userId: "user1",
        session: databaseSession,
      }),
    );
    expect(detachSession).toHaveBeenCalledWith(null);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accessToken: "token" }),
      }),
    );
  });
  it("rejects an existing account before creating credentials", async () => {
    mocks.exists.mockResolvedValue(true);
    await expect(
      register(request({ name: "Member", email: "member@example.com", phone: "9876543210", password: "StrongPass123", role: "USER" }), response()),
    ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mongoose.connection.transaction).not.toHaveBeenCalled();
  });
  it.each(["credentials", "notification"])(
    "does not issue a session if the registration transaction fails at %s",
    async (failure) => {
      mocks.hash.mockResolvedValue("hash");
      mocks.createUser.mockResolvedValue([
        {
          _id: "user1",
          publicId: "new-account",
          roles: ["USER"],
          $session: vi.fn(),
          save: vi.fn(),
        },
      ]);
      const error = new Error("Database write failed");
      if (failure === "credentials")
        mocks.createIdentity.mockRejectedValue(error);
      else mocks.emitEvent.mockRejectedValue(error);
      await expect(
        register(
          request({
            name: "Member",
            email: "member@example.com",
            password: "StrongPass123",
            phone: "9876543210",
            role: "USER",
          }),
          response(),
        ),
      ).rejects.toBe(error);
      expect(mocks.createIdentity.mock.calls[0][1]).toEqual({
        session: databaseSession,
      });
      expect(mocks.createSession).not.toHaveBeenCalled();
      expect(mocks.setRefreshCookie).not.toHaveBeenCalled();
    },
  );
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
  it("does not accept a recovery code as a login code", async () => {
    mocks.verifyOtp.mockResolvedValue({
      purpose: "ACCOUNT_RECOVERY",
      phone: "+919876543210",
    });
    await expect(
      otpVerify(
        request({ challengeId: "challenge", code: "123456" }),
        response(),
      ),
    ).rejects.toMatchObject({ code: "LOGIN_CHALLENGE_REQUIRED" });
    expect(mocks.createSession).not.toHaveBeenCalled();
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
