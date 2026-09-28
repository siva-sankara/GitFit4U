import { afterEach, expect, it, vi } from "vitest";
import { classReminderDue, classReminderStillCurrent } from "./classReminderService.js";
import { ClassBooking, ClassSession } from "../models/Engagement.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { gymInput } from "../routes/inputSchemas.js";
const now = new Date("2030-01-01T10:00:00Z");
afterEach(() => vi.restoreAllMocks());
it("uses one-hour defaults for legacy gyms and the configured reminder window", () => {
  expect(classReminderDue(new Date("2030-01-01T11:00:00Z"), undefined, now)).toBe(true);
  expect(classReminderDue(new Date("2030-01-01T11:00:01Z"), undefined, now)).toBe(false);
  expect(classReminderDue(new Date("2030-01-01T10:30:00Z"), { leadMinutes: 15 }, now)).toBe(false);
  expect(classReminderDue(new Date("2030-01-01T10:30:00Z"), { leadMinutes: 30 }, now)).toBe(true);
});
it("does not remind disabled gyms, started classes or past classes", () => {
  expect(classReminderDue(new Date("2030-01-01T10:01:00Z"), { enabled: false }, now)).toBe(false);
  expect(classReminderDue(now, undefined, now)).toBe(false);
  expect(classReminderDue(new Date("2030-01-01T09:59:00Z"), undefined, now)).toBe(false);
});
it("requires a typed complete reminder setting and bounded integer minutes", () => {
  for (const leadMinutes of [0, 14, 1441, 60.5, "60"]) expect(gymInput.partial().safeParse({ classReminders: { enabled: true, leadMinutes } }).success).toBe(false);
  expect(gymInput.partial().safeParse({ classReminders: { enabled: true, leadMinutes: 60 } }).success).toBe(true);
});
it("skips queued reminders after cancellation, rescheduling, or a changed booking cycle", async () => {
  const id = "507f1f77bcf86cd799439011", start = new Date("2030-01-01T10:30:00Z"), bookedAt = new Date("2030-01-01T09:30:00Z");
  const note = { event: "class.reminder", entityId: id, userId: "user", gymId: "gym", dedupeKey: `class.reminder:${id}:${bookedAt.toISOString()}:${start.toISOString()}` };
  const booking = vi.spyOn(ClassBooking, "findOne").mockReturnValue({ lean: async () => null } as any);
  expect(await classReminderStillCurrent(note, now)).toBe(false);
  booking.mockReturnValue({ lean: async () => ({ _id: id, bookedAt, gymId: "gym", memberProfileId: "member", sessionId: "class" }) } as any);
  vi.spyOn(MemberProfile, "exists").mockResolvedValue({ _id: "member" } as any);
  const session = vi.spyOn(ClassSession, "findOne").mockReturnValue({ lean: async () => ({ startsAt: start }) } as any);
  const gym = vi.spyOn(Gym, "findOne").mockReturnValue({ select: () => ({ lean: async () => ({ classReminders: { enabled: true } }) }) } as any);
  expect(await classReminderStillCurrent(note, now)).toBe(true);
  session.mockReturnValue({ lean: async () => ({ startsAt: new Date(start.getTime() + 60000) }) } as any);
  expect(await classReminderStillCurrent(note, now)).toBe(false);
  session.mockReturnValue({ lean: async () => ({ startsAt: start }) } as any);
  gym.mockReturnValue({ select: () => ({ lean: async () => ({ classReminders: { enabled: false } }) }) } as any);
  expect(await classReminderStillCurrent(note, now)).toBe(false);
  expect(await classReminderStillCurrent({ event: "class.cancelled" }, now)).toBe(true);
});
