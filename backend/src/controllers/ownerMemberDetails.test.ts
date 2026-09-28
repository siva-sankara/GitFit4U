import { afterEach, expect, it, vi } from "vitest";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { Payment } from "../models/Commerce.js";
import { AttendanceEvent } from "../models/Attendance.js";
import { getMember } from "./ownerController.js";
vi.mock("../services/userMediaService.js", () => ({
  withUserMedia: vi.fn(async (rows) => rows),
  withTrainerMedia: vi.fn(async (rows) => rows),
  withMemberMedia: vi.fn(async (rows) => rows),
}));
function query(value: unknown) {
  const chain: any = { lean: vi.fn().mockResolvedValue(value) };
  for (const key of ["select", "populate", "sort", "limit"]) chain[key] = vi.fn().mockReturnValue(chain);
  return chain;
}
afterEach(() => vi.restoreAllMocks());
it("returns the gym route identifier and bounded payment history only within the authorized member context", async () => {
  const gym = query({ publicId: "gym-public", timezone: "Asia/Kolkata" });
  const payments = query([]);
  vi.spyOn(Gym, "findById").mockReturnValue(gym);
  vi.spyOn(MemberProfile, "findOne").mockReturnValue(query({ _id: "member-internal", publicId: "member-public", userId: { _id: "payer-internal" }, gymId: "gym-internal", status: "ACTIVE" }));
  vi.spyOn(Payment, "find").mockReturnValue(payments);
  vi.spyOn(AttendanceEvent, "find").mockReturnValue(query([]));
  const res = { json: vi.fn() };
  await getMember({ params: { id: "member-public" }, auth: { role: "ADMIN", gymId: "gym-internal", permissions: ["admin:platform"] } } as any, res as any);
  expect(MemberProfile.findOne).toHaveBeenCalledWith({ publicId: "member-public", gymId: "gym-internal" });
  expect(Payment.find).toHaveBeenCalledWith({ payerId: "payer-internal", gymId: "gym-internal" });
  expect(payments.limit).toHaveBeenCalledWith(50);
  expect(gym.select).toHaveBeenCalledWith(expect.stringContaining("publicId"));
  expect(res.json.mock.calls[0][0].data).toMatchObject({ gymPublicId: "gym-public", timezone: "Asia/Kolkata" });
});
