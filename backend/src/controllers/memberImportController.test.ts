import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { MembershipPlan } from "../models/Commerce.js";
import { importRow, parseDate } from "./memberImportController.js";

const gymId = "507f1f77bcf86cd799439011";
const actorId = "507f1f77bcf86cd799439012";
const session = { id: "transaction-session" } as any;

function sessionQuery(value: unknown) {
  return { session: vi.fn().mockResolvedValue(value) } as any;
}

const request = { auth: { gymId, userId: actorId } } as any;
const options = {
  duplicateStrategy: "SKIP",
  missingPlanStrategy: "DIRECT",
  newPlanDurationDays: 30,
  newPlanPriceMinor: 0,
  planMappings: {},
  trainerMappings: {},
  batchSize: 25,
} as const;

const row = (overrides: Record<string, unknown> = {}) => ({
  rowNumber: 2,
  duplicateMemberId: undefined,
  errors: [],
  data: {
    name: "Kiran Kumar",
    phone: "+919876543210",
    email: "kiran@example.com",
    planValue: "",
    planId: undefined,
    trainerValue: "",
    trainerId: undefined,
    startDate: "2026-10-06T00:00:00.000Z",
    renewalDate: undefined,
    status: "ACTIVE",
    paymentStatus: "NONE",
    ...overrides,
  },
});

beforeEach(() => {
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (callback: any) => callback(session));
  vi.spyOn(MembershipPlan, "findOne").mockReturnValue(sessionQuery(null));
});

afterEach(() => vi.restoreAllMocks());

it("strictly rejects impossible dates instead of allowing JavaScript date rollover", () => {
  expect(parseDate("2026-02-29")).toBeUndefined();
  expect(parseDate("31/04/2026")).toBeUndefined();
  expect(parseDate("06/10/2026")?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
  expect(parseDate("2026-10-06")?.toISOString()).toBe("2026-10-06T00:00:00.000Z");
});

it("updates the explicitly matched existing member inside a transaction", async () => {
  const existing = {
    set: vi.fn(),
    save: vi.fn().mockResolvedValue(undefined),
  };
  vi.spyOn(MemberProfile, "findOne").mockReturnValue(sessionQuery(existing));
  const input = { ...options, duplicateStrategy: "UPDATE" } as any;
  const result = await importRow(request, { ...row(), duplicateMemberId: "member-existing" }, input, { timezone: "Asia/Kolkata" });
  expect(result).toBe("updated");
  expect(MemberProfile.findOne).toHaveBeenCalledWith({ gymId, publicId: "member-existing" });
  expect(existing.set).toHaveBeenCalledWith("contact.name", "Kiran Kumar");
  expect(existing.set).toHaveBeenCalledWith("contact.phone", "+919876543210");
  expect(existing.save).toHaveBeenCalledWith({ session });
});

it("creates a direct-access member without inventing a paid plan", async () => {
  vi.spyOn(MemberProfile, "findOne").mockReturnValue(sessionQuery(null));
  const user = { _id: "507f1f77bcf86cd799439013", status: "ACTIVE" };
  vi.spyOn(User, "find").mockReturnValue(sessionQuery([user]));
  const created = { _id: "507f1f77bcf86cd799439014", publicId: "member-new" };
  vi.spyOn(MemberProfile, "create").mockResolvedValue([created] as any);
  const result = await importRow(request, row(), options as any, { timezone: "Asia/Kolkata" });
  expect(result).toBe("imported");
  expect(MemberProfile.create).toHaveBeenCalledWith(
    [expect.objectContaining({
      gymId,
      userId: user._id,
      directAccess: true,
    })],
    { session },
  );
});
