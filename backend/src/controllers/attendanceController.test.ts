import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  scanner: vi.fn(),
  member: vi.fn(),
  checkIn: vi.fn(),
}));
vi.mock("../models/Attendance.js", () => ({
  GymScanner: { findOne: mocks.scanner },
}));
vi.mock("../models/Member.js", () => ({
  MemberProfile: { findOne: mocks.member },
}));
vi.mock("../services/attendanceService.js", () => ({ checkIn: mocks.checkIn }));
import { memberCheckIn } from "./attendanceController.js";
import { issueGymQr } from "../services/attendanceQrService.js";
beforeEach(() => {
  vi.clearAllMocks();
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
