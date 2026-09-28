import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  scanner: vi.fn(),
  member: vi.fn(),
  checkIn: vi.fn(),
  gym: vi.fn(),
}));
vi.mock("../models/Attendance.js", () => ({
  GymScanner: { findOne: mocks.scanner },
}));
vi.mock("../models/Member.js", () => ({
  MemberProfile: { findOne: mocks.member },
}));
vi.mock("../services/attendanceService.js", () => ({ checkIn: mocks.checkIn }));
vi.mock("../models/Gym.js", () => ({ Gym: { findOne: mocks.gym } }));
import { adminManualCheckIn, memberCheckIn } from "./attendanceController.js";
import { issueGymQr } from "../services/attendanceQrService.js";
beforeEach(() => {
  vi.clearAllMocks();
});

describe("administrator manual attendance", () => {
  const request = (overrides = {}) => ({
    auth: { userId: "admin-user", role: "ADMIN", permissions: ["admin:platform"] },
    params: { gymId: "gym-public-id" },
    body: { memberIdentifier: "MEMBER-1", reason: "Reception correction" },
    idempotencyKey: "admin-check-in",
    ...overrides,
  }) as any;
  it("requires the admin role and permission before resolving another gym", async () => {
    for (const auth of [undefined, { role: "GYM_OWNER", permissions: ["admin:platform"] }, { role: "ADMIN", permissions: [] }]) {
      await expect(adminManualCheckIn(request({ auth }), {} as any)).rejects.toMatchObject({ code: "ROLE_FORBIDDEN" });
    }
    expect(mocks.gym).not.toHaveBeenCalled();
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });
  it("requires a reason and disallows client backdating or gym-id overrides", async () => {
    for (const body of [ { memberIdentifier: "MEMBER-1", reason: " " }, { memberIdentifier: "MEMBER-1", reason: "Correction", occurredAt: "2020-01-01" }, { memberIdentifier: "MEMBER-1", reason: "Correction", gymId: "other-gym" } ]) {
      await expect(adminManualCheckIn(request({ body }), {} as any)).rejects.toThrow();
    }
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });
  it("resolves the authorized gym and records manual provenance without GPS", async () => {
    mocks.gym.mockReturnValue({ select: vi.fn().mockResolvedValue({ _id: "internal-gym-id" }) });
    mocks.checkIn.mockResolvedValue({ duplicate: false, event: {} });
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await adminManualCheckIn(request(), res);
    expect(mocks.gym).toHaveBeenCalledWith({ publicId: "gym-public-id", deletedAt: null });
    expect(mocks.checkIn).toHaveBeenCalledWith({ gymId: "internal-gym-id", memberIdentifier: "MEMBER-1", actorId: "admin-user", actorRole: "ADMIN", reason: "Reception correction", source: "MANUAL", idempotencyKey: "admin-check-in" });
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
describe("member scans gym QR authorization", () => {
  const gym = "507f1f77bcf86cd799439011";
  function request() {
    return {
      auth: { userId: "authenticated-user" },
      body: {
        qrToken: issueGymQr(gym, "gym-identity", 2),
        memberIdentifier: "victim-member",
      },
      idempotencyKey: "request-1",
    } as any;
  }
  it("derives member identity from authenticated user, ignoring a supplied member identifier", async () => {
    mocks.scanner.mockResolvedValue({ _id: "scanner-id" });
    mocks.member.mockReturnValue({
      select: vi.fn().mockResolvedValue({ publicId: "actual-member" }),
    });
    mocks.checkIn.mockResolvedValue({ duplicate: false, event: {} });
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await memberCheckIn(request(), res);
    expect(mocks.member).toHaveBeenCalledWith({
      gymId: gym,
      userId: "authenticated-user",
      status: "ACTIVE",
    });
    expect(mocks.checkIn).toHaveBeenCalledWith(
      expect.objectContaining({
        memberIdentifier: "actual-member",
        memberUserId: "authenticated-user",
        actorId: "authenticated-user",
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
  it("rejects a revoked gym identity before resolving a member", async () => {
    mocks.scanner.mockResolvedValue(null);
    await expect(memberCheckIn(request(), {} as any)).rejects.toMatchObject({
      code: "QR_REVOKED",
    });
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("rejects accounts without an approved gym relationship", async () => {
    mocks.scanner.mockResolvedValue({ _id: "scanner-id" });
    mocks.member.mockReturnValue({ select: vi.fn().mockResolvedValue(null) });
    await expect(memberCheckIn(request(), {} as any)).rejects.toMatchObject({
      code: "MEMBERSHIP_REQUIRED",
    });
    expect(mocks.checkIn).not.toHaveBeenCalled();
  });
});
