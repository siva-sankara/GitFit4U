import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  user: vi.fn(),
  assignment: vi.fn(),
  gym: vi.fn(),
  verify: vi.fn(),
}));
vi.mock("../models/Auth.js", () => ({
  Session: { findOne: mocks.session },
  RoleAssignment: { findOne: mocks.assignment },
}));
vi.mock("../models/User.js", () => ({ User: { findById: mocks.user } }));
vi.mock("../models/Gym.js", () => ({ Gym: { findById: mocks.gym } }));
vi.mock("../services/tokenService.js", () => ({
  verifyAccessToken: mocks.verify,
}));
import { requireAuth, requireGymContext } from "./auth.js";

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
