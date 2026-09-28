import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { checkIn } from "./attendanceService.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { Subscription } from "../models/Commerce.js";
import { AttendanceEvent, AttendanceProjection, StreakProjection } from "../models/Attendance.js";
import { emitDomainEvent } from "./domainEventService.js";
vi.mock("./domainEventService.js", () => ({ emitDomainEvent: vi.fn() }));
const scope = (value: unknown) => ({ session: vi.fn().mockResolvedValue(value) }) as any;
const gymId = "507f1f77bcf86cd799439011", memberId = "507f1f77bcf86cd799439012";
const input = { gymId, memberIdentifier: "MEMBER-1", actorId: "507f1f77bcf86cd799439014", actorRole: "GYM_OWNER", source: "MANUAL" as const, reason: "Camera unavailable" };
beforeEach(() => {
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (work: any) => work({}));
  vi.spyOn(Gym, "findById").mockReturnValue(scope({ _id: gymId, status: "ACTIVE", timezone: "Asia/Kolkata", attendanceLocationRequired: true }));
  vi.spyOn(MemberProfile, "findOne").mockReturnValue(scope({ _id: memberId, userId: "507f1f77bcf86cd799439013", currentSubscriptionId: "sub" }));
  vi.spyOn(Subscription, "findOne").mockReturnValue(scope({ _id: "sub", status: "ACTIVE" }));
  vi.spyOn(AttendanceEvent, "findOne").mockReturnValue(scope(null));
  vi.spyOn(AttendanceEvent, "create").mockImplementation(async (rows: any) => [{ ...rows[0], _id: "event" }] as any);
  vi.spyOn(AttendanceProjection, "findOneAndUpdate").mockResolvedValue({} as any);
  vi.spyOn(StreakProjection, "findOne").mockReturnValue(scope(null));
  vi.spyOn(StreakProjection, "findOneAndUpdate").mockResolvedValue({} as any);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
it("records manual attendance without coordinates or location permission and preserves audit data", async () => {
  const result = await checkIn(input);
  expect(result.duplicate).toBe(false);
  expect(AttendanceEvent.create).toHaveBeenCalledWith([expect.objectContaining({ source: "MANUAL", createdBy: input.actorId, createdByRole: "GYM_OWNER", reason: "Camera unavailable", occurredAt: expect.any(Date), locationEvidence: undefined })], expect.anything());
  expect(emitDomainEvent).toHaveBeenCalledOnce();
});
it("still requires fresh location for QR attendance when configured by the gym", async () => {
  await expect(checkIn({ ...input, source: "QR" })).rejects.toMatchObject({ code: "LOCATION_REQUIRED" });
  expect(AttendanceEvent.create).not.toHaveBeenCalled();
});
it("retains membership validation and duplicate protection for manual entry", async () => {
  vi.mocked(Subscription.findOne).mockReturnValue(scope(null));
  await expect(checkIn(input)).rejects.toMatchObject({ code: "MEMBERSHIP_NOT_ACTIVE" });
  expect(AttendanceEvent.create).not.toHaveBeenCalled();
  vi.mocked(Subscription.findOne).mockReturnValue(scope({ _id: "sub" }));
  vi.mocked(AttendanceEvent.findOne).mockReturnValue(scope({ publicId: "already-recorded" }));
  expect((await checkIn(input)).duplicate).toBe(true);
  expect(AttendanceEvent.create).not.toHaveBeenCalled();
});
