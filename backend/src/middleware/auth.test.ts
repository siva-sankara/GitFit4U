import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  ownerExists: vi.fn(),
  assignment: vi.fn(),
  gym: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("../models/Auth.js", () => ({
  Session: { findOne: mocks.session },
  RoleAssignment: { findOne: mocks.assignment },
}));
vi.mock("../models/User.js", () => ({ User: { findById: mocks.user, exists: mocks.ownerExists } }));
vi.mock("../models/Gym.js", () => ({ Gym: { findById: mocks.gym } }));
vi.mock("../services/tokenService.js", () => ({
  verifyAccessToken: mocks.verify,
}));
import { requireAuth, requireGymContext, requireGymRegistration, requirePermission } from "./auth.js";

const response = {} as Response;
const request = (
  method = "PATCH",
  role = "GYM_OWNER",
  gymId: string | undefined = "gym",
) =>
  ({
    method,
    auth: {
      role,
      gymId,
      userId: "user",
      permissions: [],
      sessionId: "session",
    },
  }) as unknown as Request;
const gymResult = (value: unknown) =>
  mocks.gym.mockReturnValue({
    select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(value) }),
  });

beforeEach(() => vi.resetAllMocks());

describe("owner onboarding authorization", () => {
  const authenticated = async (role: string, gymId?: string, status = "ACTIVE") => {
    mocks.verify.mockReturnValue({ sid: "session", sub: "user" });
    mocks.user.mockResolvedValue({ _id: "user", roles: [role], status });
    mocks.session.mockResolvedValue({ publicId: "session", activeRole: role, activeGymId: gymId, expiresAt: new Date(Date.now() + 60_000) });
    const req = { header: () => "Bearer token" } as unknown as Request;
    const next = vi.fn();
    await requireAuth(req, response, next);
    return { req, next };
  };

  it("authenticates a new owner without granting tenant permissions", async () => {
    const { req, next } = await authenticated("GYM_OWNER");
    expect(next).toHaveBeenCalledWith();
    expect(req.auth).toMatchObject({ role: "GYM_OWNER", permissions: [] });
    expect(mocks.assignment).not.toHaveBeenCalled();
    const denied = vi.fn();
    requirePermission("member:write")(req, response, denied);
    expect(denied).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    const noGym = vi.fn();
    await requireGymContext(req, response, noGym);
    expect(noGym).toHaveBeenCalledWith(expect.objectContaining({ code: "GYM_CONTEXT_REQUIRED" }));
  });

  it.each(["GYM_STAFF", "TRAINER"])("does not grant an onboarding exception to %s", async (role) => {
    const { next } = await authenticated(role);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "ROLE_REVOKED" }));
  });

  it("does not bypass a revoked gym assignment", async () => {
    const { next } = await authenticated("GYM_OWNER", "revoked-gym");
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "ROLE_REVOKED" }));
  });

  it("retains account activation requirements", async () => {
    const { next } = await authenticated("GYM_OWNER", undefined, "PENDING_ACTIVATION");
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "SESSION_EXPIRED" }));
  });

  it("rejects an ordinary USER even when requesting the registration URL directly", async () => {
    mocks.ownerExists.mockResolvedValue(null);
    const next = vi.fn();
    await requireGymRegistration(request("POST", "USER"), response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403, code: "ROLE_FORBIDDEN" }));
    expect(mocks.ownerExists).toHaveBeenCalledWith({ _id: "user", status: "ACTIVE", roles: { $in: ["GYM_OWNER", "ADMIN"] } });
  });

  it("preserves authorized owner capability on a multi-role account", async () => {
    mocks.ownerExists.mockResolvedValue({ _id: "user" });
    const next = vi.fn();
    await requireGymRegistration(request("POST", "USER"), response, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("live tenant mutation authorization", () => {
  it.each(["SUSPENDED", "ARCHIVED"])(
    "rejects changes to a %s gym even with an existing authorized session",
    async (status) => {
      gymResult({ status, deletedAt: null });
      const next = vi.fn();
      await requireGymContext(request(), response, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 403, code: "GYM_READ_ONLY" }),
      );
    },
  );

  it.each([null, { status: "ACTIVE", deletedAt: new Date() }])(
    "rejects deleted or missing gyms without falling back to session permissions",
    async (gym) => {
      gymResult(gym);
      const next = vi.fn();
      await requireGymContext(request("POST", "TRAINER"), response, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ code: "GYM_READ_ONLY" }),
      );
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "guards %s independently of an endpoint's permission name",
    async (method) => {
      gymResult({ status: "SUSPENDED" });
      const next = vi.fn();
      await requireGymContext(request(method, "GYM_STAFF"), response, next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ code: "GYM_READ_ONLY" }),
      );
    },
  );

  it.each(["ACTIVE", "INACTIVE"])(
    "does not conflate %s with suspension or block onboarding for absent subscription flags",
    async (status) => {
      gymResult({ status });
      const next = vi.fn();
      await requireGymContext(request(), response, next);
      expect(next).toHaveBeenCalledWith();
    },
  );

  it.each(["GET", "HEAD", "OPTIONS"])(
    "retains %s read-only history without a mutation check",
    async (method) => {
      const next = vi.fn();
      await requireGymContext(request(method), response, next);
      expect(next).toHaveBeenCalledWith();
      expect(mocks.gym).not.toHaveBeenCalled();
    },
  );

  it("leaves authorized administrator remediation outside the tenant suspension guard", async () => {
    const next = vi.fn();
    await requireGymContext(request("PATCH", "ADMIN"), response, next);
    expect(next).toHaveBeenCalledWith();
    expect(mocks.gym).not.toHaveBeenCalled();
  });

  it("still requires an explicit tenant context", async () => {
    const req = request();
    delete req.auth!.gymId;
    const next = vi.fn();
    await requireGymContext(req, response, next);
    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ code: "GYM_CONTEXT_REQUIRED" }),
    );
  });

  it("rechecks a newly switched gym from the stored session, so role switching cannot bypass suspension", async () => {
    mocks.verify.mockReturnValue({
      sid: "session",
      sub: "user",
      gymId: "old-active-gym",
    });
    mocks.user.mockResolvedValue({
      _id: "user",
      status: "ACTIVE",
      roles: ["USER", "GYM_OWNER"],
    });
    mocks.session.mockResolvedValue({
      publicId: "session",
      activeRole: "GYM_OWNER",
      activeGymId: "new-suspended-gym",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.assignment.mockResolvedValue({ permissions: ["gym:update"] });
    gymResult({ status: "SUSPENDED" });
    const req = {
      method: "PATCH",
      header: vi.fn().mockReturnValue("Bearer existing-token"),
    } as unknown as Request;
    const authNext = vi.fn(),
      mutationNext = vi.fn();
    await requireAuth(req, response, authNext);
    expect(authNext).toHaveBeenCalledWith();
    expect(req.auth?.gymId).toBe("new-suspended-gym");
    await requireGymContext(req, response, mutationNext);
    expect(mocks.gym).toHaveBeenCalledWith("new-suspended-gym");
    expect(mutationNext).toHaveBeenCalledWith(
      expect.objectContaining({ code: "GYM_READ_ONLY" }),
    );
  });

  it("keeps authenticated payment recovery available without weakening gym mutations", async () => {
    mocks.verify.mockReturnValue({ sid: "session", sub: "user" });
    mocks.user.mockResolvedValue({
      _id: "user",
      status: "ACTIVE",
      roles: ["USER", "GYM_OWNER"],
    });
    mocks.session.mockResolvedValue({
      publicId: "session",
      activeRole: "GYM_OWNER",
      activeGymId: "suspended-gym",
      expiresAt: new Date(Date.now() + 60_000),
    });
    mocks.assignment.mockResolvedValue({ permissions: ["finance:read"] });
    const req = {
      method: "POST",
      originalUrl: "/api/v1/checkout/platform/orders",
      header: vi.fn().mockReturnValue("Bearer token"),
    } as unknown as Request;
    const next = vi.fn();
    await requireAuth(req, response, next);
    expect(next).toHaveBeenCalledWith();
    expect(mocks.gym).not.toHaveBeenCalled();
  });

  it("fails closed when gym status cannot be checked", async () => {
    const error = new Error("Database unavailable");
    mocks.gym.mockReturnValue({
      select: vi
        .fn()
        .mockReturnValue({ lean: vi.fn().mockRejectedValue(error) }),
    });
    const next = vi.fn();
    await requireGymContext(request(), response, next);
    expect(next).toHaveBeenCalledWith(error);
  });
});
