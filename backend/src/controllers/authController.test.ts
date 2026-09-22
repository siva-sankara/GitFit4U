import { beforeEach, describe, expect, it, vi } from "vitest";
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
  Session: {},
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
  clearRefreshCookie: vi.fn(),
  rotateRefreshToken: vi.fn(),
  signAccessToken: vi.fn(),
}));
import { register, passwordLogin, otpVerify } from "./authController.js";
import type { Request, Response } from "express";
const request = (body: object) =>
  ({ body, header: vi.fn(), ip: "127.0.0.1" }) as unknown as Request;
const response = () => ({ json: vi.fn() }) as unknown as Response;
beforeEach(() => vi.resetAllMocks());
describe("authentication controller", () => {
  it("registers a normalized member account and returns a session", async () => {
    mocks.hash.mockResolvedValue("hash");
    mocks.createUser.mockImplementation(async (values) => ({
      ...values,
      _id: "user1",
      save: vi.fn(),
    }));
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
        roles: ["ADMIN"],
      }),
      res,
    );
    expect(mocks.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Member",
        email: "member@example.com",
        phone: "+919876543210",
        roles: ["USER"],
      }),
    );
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ accessToken: "token" }),
      }),
    );
  });
  it("rejects an existing account before creating credentials", async () => {
    mocks.exists.mockResolvedValue(true);
    await expect(
      register(request({ email: "member@example.com" }), response()),
    ).rejects.toMatchObject({ code: "ACCOUNT_EXISTS" });
    expect(mocks.createUser).not.toHaveBeenCalled();
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

  it("falls back to an assigned member role after gym access is revoked", async () => {
    const user = account("GYM_OWNER", ["ADMIN", "GYM_OWNER", "USER"]);
    mocks.findAssignment.mockResolvedValue(null);
    await passwordLogin(request(credentials), response());
    expect(mocks.createSession).toHaveBeenCalledWith(
      expect.objectContaining({ activeRole: "USER", activeGymId: undefined }),
    );
    expect(user.activeRole).toBe("USER");
    expect(user.save).toHaveBeenCalledOnce();
    expect(mocks.setRefreshCookie).toHaveBeenCalledOnce();
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
