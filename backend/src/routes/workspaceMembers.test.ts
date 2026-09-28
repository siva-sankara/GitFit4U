import express, {
  type ErrorRequestHandler,
  type RequestHandler,
  type Request,
} from "express";
import request from "supertest";
import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../middleware/auth.js", () => {
  const pass: RequestHandler = (_req, _res, next) => next();
  return {
    requireAuth: pass,
    requireGymContext: pass,
    requireGymRegistration: pass,
    requireRole: () => pass,
    requirePermission: () => pass,
  };
});
import { workspaceRoutes } from "./workspaceRoutes.js";
import { MemberProfile } from "../models/Member.js";
import { AttendanceEvent } from "../models/Attendance.js";
const gymId = new mongoose.Types.ObjectId();
const memberId = new mongoose.Types.ObjectId();
const secondMemberId = new mongoose.Types.ObjectId();
const populate = vi.fn();
let find: ReturnType<typeof vi.spyOn>;
let aggregate: ReturnType<typeof vi.spyOn>;
function app(
  permissions: NonNullable<Request["auth"]>["permissions"] = [
    "member:read",
    "finance:read",
  ],
) {
  const instance = express();
  instance.use((req, _res, next) => {
    req.auth = {
      userId: "owner",
      role: "GYM_STAFF",
      gymId: String(gymId),
      sessionId: "session",
      permissions,
    };
    next();
  });
  instance.use("/workspace", workspaceRoutes);
  const errors: ErrorRequestHandler = (error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code });
  instance.use(errors);
  return instance;
}
beforeEach(() => {
  populate.mockClear();
  const cursor = {
    select: vi.fn().mockReturnThis(),
    sort: vi.fn().mockReturnThis(),
    skip: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    populate,
    lean: vi.fn().mockResolvedValue([
      { _id: memberId, gymId, memberCode: "MEM-001" },
      { _id: secondMemberId, gymId, memberCode: "MEM-002" },
    ]),
  };
  find = vi.spyOn(MemberProfile, "find").mockReturnValue(cursor as never);
  vi.spyOn(MemberProfile, "countDocuments").mockResolvedValue(2 as never);
  aggregate = vi
    .spyOn(AttendanceEvent, "aggregate")
    .mockResolvedValue([{ _id: memberId, count: 3 }] as never);
});
afterEach(() => vi.restoreAllMocks());
it("returns attendance counts for the current tenant page using one bounded aggregate", async () => {
  const response = await request(app()).get(
    "/workspace/records/members?page=1&limit=12",
  );
  expect(response.status).toBe(200);
  expect(find).toHaveBeenCalledWith({ $and: [{ gymId: String(gymId) }] });
  expect(
    response.body.data.map(
      (row: { attendanceVisits30Days: number }) => row.attendanceVisits30Days,
    ),
  ).toEqual([3, 0]);
  expect(aggregate).toHaveBeenCalledTimes(1);
  expect(aggregate.mock.calls[0][0][0].$match).toMatchObject({
    gymId: { $in: [gymId, gymId] },
    memberProfileId: { $in: [memberId, secondMemberId] },
    type: "CHECK_IN",
    occurredAt: { $gte: expect.any(Date), $lte: expect.any(Date) },
  });
  expect(response.body.meta).toMatchObject({ page: 1, total: 2 });
});
it("populates only safe payment status fields for authorized finance readers", async () => {
  await request(app()).get("/workspace/records/members");
  expect(populate).toHaveBeenCalledWith({
    path: "currentSubscriptionId",
    select: "publicId planSnapshot status startsAt endsAt latestPaymentId",
    populate: { path: "latestPaymentId", select: "publicId status" },
  });
});
it("does not populate payments for staff without finance permission", async () => {
  const response = await request(app(["member:read"])).get(
    "/workspace/records/members",
  );
  expect(response.status).toBe(200);
  expect(
    populate.mock.calls.some(
      ([options]) => options.populate?.path === "latestPaymentId",
    ),
  ).toBe(false);
});
it("denies members data before database reads when the role lacks member access", async () => {
  const response = await request(app([])).get("/workspace/records/members");
  expect(response.status).toBe(403);
  expect(find).not.toHaveBeenCalled();
  expect(aggregate).not.toHaveBeenCalled();
});
