import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ClassBooking, ClassSession, Trainer } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { classInput } from "../routes/inputSchemas.js";
import { saveGymClass } from "./classManagementService.js";
import { emitDomainEvents } from "./domainEventService.js";
vi.mock("./domainEventService.js", () => ({ emitDomainEvents: vi.fn() }));
const session = {} as any;
const query = (value: unknown) =>
  ({ session: vi.fn().mockResolvedValue(value) }) as any;
const body = () => ({
  name: "Strength circuit",
  category: "STRENGTH",
  trainerId: null,
  startsAt: new Date(Date.now() + 86400000),
  endsAt: new Date(Date.now() + 90000000),
  capacity: 12,
  room: "",
  status: "SCHEDULED",
});
let existing: any;
beforeEach(() => {
  vi.clearAllMocks();
  existing = {
    ...body(),
    _id: "class-db",
    publicId: "class-public",
    gymId: "gym-a",
    bookedCount: 2,
    version: 3,
    save: vi.fn(),
  };
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(
    async (callback: any) => callback(session),
  );
  vi.spyOn(ClassSession, "findOne").mockReturnValue(query(existing));
  vi.spyOn(ClassSession, "create").mockResolvedValue([existing] as any);
  vi.spyOn(Trainer, "exists").mockReturnValue(query({ _id: "trainer" }));
  vi.spyOn(ClassBooking, "find").mockReturnValue(
    query([{ memberProfileId: "member-a" }]),
  );
  vi.spyOn(ClassBooking, "updateMany").mockResolvedValue({
    modifiedCount: 1,
  } as any);
  vi.spyOn(MemberProfile, "find").mockReturnValue({
    select: vi.fn().mockReturnValue(query([{ userId: "member-user" }])),
  } as any);
});
afterEach(() => vi.restoreAllMocks());
it("accepts blank optional room and trainer fields without weakening required fields", () => {
  expect(classInput.parse({ ...body(), trainerId: "" })).toMatchObject({
    room: "",
    trainerId: undefined,
  });
  expect(classInput.safeParse({ ...body(), capacity: "12" }).success).toBe(
    false,
  );
});
it("attaches backwards schedule errors to endsAt so the form displays the cause", () => {
  const result = classInput.safeParse({ ...body(), endsAt: new Date(0) });
  expect(result.success).toBe(false);
  if (!result.success)
    expect(result.error.flatten().fieldErrors.endsAt).toContain(
      "End time must be later than start time.",
    );
});
it("creates a class with server-controlled tenant and public identifier", async () => {
  await saveGymClass({
    gymId: "gym-a",
    body: { ...body(), gymId: "forged-tenant", publicId: "forged-id" },
  });
  expect(ClassSession.create).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        gymId: "gym-a",
        publicId: expect.not.stringContaining("forged"),
      }),
    ],
    { session },
  );
});
it("rejects a trainer outside the authorized gym or with inactive status", async () => {
  vi.mocked(Trainer.exists).mockReturnValue(query(null));
  await expect(
    saveGymClass({
      gymId: "gym-a",
      body: { ...body(), trainerId: "507f1f77bcf86cd799439011" },
    }),
  ).rejects.toMatchObject({ code: "TRAINER_INVALID" });
  expect(Trainer.exists).toHaveBeenCalledWith({
    _id: "507f1f77bcf86cd799439011",
    gymId: "gym-a",
    status: "ACTIVE",
  });
  expect(ClassSession.create).not.toHaveBeenCalled();
});
it("rejects capacity reductions below booked members", async () => {
  await expect(
    saveGymClass({
      gymId: "gym-a",
      publicId: "class-public",
      body: { ...body(), capacity: 1 },
    }),
  ).rejects.toMatchObject({ code: "CLASS_CAPACITY_TOO_SMALL" });
  expect(existing.save).not.toHaveBeenCalled();
});
it("rejects cross-tenant edits", async () => {
  vi.mocked(ClassSession.findOne).mockReturnValue(query(null));
  await expect(
    saveGymClass({
      gymId: "other-gym",
      publicId: "class-public",
      body: body(),
    }),
  ).rejects.toMatchObject({ code: "CLASS_NOT_FOUND" });
  expect(ClassSession.findOne).toHaveBeenCalledWith({
    gymId: "other-gym",
    publicId: "class-public",
  });
});
it("cancels bookings and emits one centralized batch in the same transaction while retaining history", async () => {
  await saveGymClass({
    gymId: "gym-a",
    publicId: "class-public",
    body: {},
    cancel: true,
    reason: "Trainer unavailable",
  });
  expect(existing.status).toBe("CANCELLED");
  expect(existing.bookedCount).toBe(0);
  expect(existing.save).toHaveBeenCalledWith({ session });
  expect(ClassBooking.updateMany).toHaveBeenCalledWith(
    { sessionId: "class-db", status: { $in: ["BOOKED", "WAITLISTED"] } },
    { $set: { status: "CANCELLED", cancelledAt: expect.any(Date) } },
    { session },
  );
  expect(emitDomainEvents).toHaveBeenCalledWith([
    expect.objectContaining({
      event: "class.cancelled",
      userId: "member-user",
      actionUrl: "/app/classes",
      session,
    }),
  ]);
});
it("replaying cancellation does not repeat booking changes or notifications", async () => {
  existing.status = "CANCELLED";
  await saveGymClass({
    gymId: "gym-a",
    publicId: "class-public",
    body: {},
    cancel: true,
  });
  expect(ClassBooking.updateMany).not.toHaveBeenCalled();
  expect(emitDomainEvents).not.toHaveBeenCalled();
});
it("prevents creating past classes and prematurely completing future classes", async () => {
  await expect(
    saveGymClass({
      gymId: "gym-a",
      body: { ...body(), startsAt: new Date(0) },
    }),
  ).rejects.toMatchObject({ code: "CLASS_START_PAST" });
  await expect(
    saveGymClass({
      gymId: "gym-a",
      publicId: "class-public",
      body: { ...body(), status: "COMPLETED" },
    }),
  ).rejects.toMatchObject({ code: "CLASS_NOT_ENDED" });
});
