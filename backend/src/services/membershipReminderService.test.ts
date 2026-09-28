import { afterEach, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { Subscription, MembershipPlan } from "../models/Commerce.js";
import { Notification } from "../models/Engagement.js";
import { AuditLog } from "../models/Operations.js";
import * as events from "./domainEventService.js";
import { MemberProfile } from "../models/Member.js";
import { Gym } from "../models/Gym.js";
import { gymInput } from "../routes/inputSchemas.js";
import {
  localDateKey,
  reminderWindow,
  reminderStillCurrent,
  scheduleMembershipReminders,
} from "./membershipReminderService.js";
afterEach(() => vi.restoreAllMocks());
const expiry = new Date("2026-10-10T10:00:00Z");
it.each([
  [-8, false],
  [-7, true],
  [-1, true],
  [0, true],
  [1, true],
  [7, true],
  [8, false],
])(
  "uses the seven-calendar-day before/after window offset=%s",
  (offset, eligible) => {
    const result = reminderWindow(
      new Date(expiry.getTime() + offset * 86400000),
      expiry,
      "Asia/Kolkata",
    );
    expect(Boolean(result)).toBe(eligible);
    if (result) expect(result.daysRemaining).toBe(offset === 0 ? 0 : -offset);
  },
);
function scheduledSetup() {
  const gym = { _id: "gym", publicId: "gym-public", slug: "real-gym", name: "Actual Gym", timezone: "Asia/Kolkata", membershipReminders: { postExpiryDays: 7 } };
  const record = {
    _id: "subscription",
    publicId: "membership-public",
    gymId: "gym",
    userId: "user",
    memberProfileId: "member",
    type: "GYM_MEMBERSHIP",
    status: "ACTIVE",
    endsAt: expiry,
    planSnapshot: { name: "Gold", benefits: ["Classes"] },
  };
  const cursorQuery: any = {};
  for (const method of ["select", "sort", "lean"])
    cursorQuery[method] = () => cursorQuery;
  cursorQuery.cursor = () =>
    (async function* () {
      yield record;
    })();
  vi.spyOn(Subscription, "find").mockReturnValue(cursorQuery);
  vi.spyOn(Gym, "findOne").mockReturnValue({
    select: () => ({
      lean: async () => gym,
    }),
  } as never);
  const duplicate = vi.spyOn(Notification, "exists").mockResolvedValue(null);
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(
    async (fn: any) => fn({}),
  );
  const lock = vi
    .spyOn(Subscription, "findOneAndUpdate")
    .mockResolvedValue(record as never);
  const member = vi
    .spyOn(MemberProfile, "findOneAndUpdate")
    .mockResolvedValue({ _id: "member" } as never);
  const plans: any = {};
  for (const method of ["select", "sort", "limit", "session"])
    plans[method] = () => plans;
  plans.lean = async () => [
    {
      publicId: "plan",
      name: "Renewal Gold",
      durationDays: 30,
      priceMinor: 50000,
      benefits: ["Classes"],
    },
  ];
  vi.spyOn(MembershipPlan, "find").mockReturnValue(plans);
  const emit = vi
    .spyOn(events, "emitDomainEvent")
    .mockResolvedValue({ upsertedCount: 1 } as never);
  const audit = vi.spyOn(AuditLog, "create").mockResolvedValue([] as never);
  return { record, gym, duplicate, member, emit, audit, lock };
}
it("records a daily, cycle-specific reminder and audit with real plan details", async () => {
  const { emit, audit } = scheduledSetup();
  await scheduleMembershipReminders(new Date("2026-10-05T10:00:00Z"));
  expect(emit).toHaveBeenCalledWith(
    expect.objectContaining({
      event: "membership.renewal_reminder",
      occurrenceId: `${expiry.toISOString()}:2026-10-05`,
      actionUrl: "/gyms/real-gym#membership-plans",
      details: expect.objectContaining({
        metadata: expect.objectContaining({
          gymName: "Actual Gym",
          planName: "Gold",
          daysRemaining: 5,
          availablePlans: expect.any(Array),
        }),
      }),
      session: expect.any(Object),
    }),
  );
  expect(audit).toHaveBeenCalledWith(
    [expect.objectContaining({ action: "notification.reminder.scheduled" })],
    { session: expect.any(Object) },
  );
});
it("binds platform reminders to their gym public identity, not the recipient's active tenant", async () => {
  const { record, emit } = scheduledSetup();
  record.type = "PLATFORM";
  vi.spyOn(Gym, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
  vi.spyOn(Subscription, "exists").mockReturnValue({ session: async () => null } as never);
  await scheduleMembershipReminders(new Date("2026-10-05T10:00:00Z"));
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({
    event: "platform.expiring", actionUrl: "/platform-renewal?gym=gym-public",
    details: expect.objectContaining({ metadata: expect.objectContaining({ gymPublicId: "gym-public" }) }),
  }));
});
it("does not requeue an already scheduled day even if the user deleted its inbox copy", async () => {
  const { duplicate, emit, lock } = scheduledSetup();
  duplicate.mockResolvedValue({
    _id: "existing-archived-notification",
  } as never);
  await scheduleMembershipReminders(new Date("2026-10-05T10:00:00Z"));
  expect(duplicate.mock.calls[0][0]).not.toHaveProperty("archivedAt");
  expect(lock).not.toHaveBeenCalled();
  expect(emit).not.toHaveBeenCalled();
});
it("stops the previous cycle when renewal changes the current subscription inside the job transaction", async () => {
  const { member, emit, audit } = scheduledSetup();
  member.mockResolvedValue(null);
  await scheduleMembershipReminders(new Date("2026-10-05T10:00:00Z"));
  expect(emit).not.toHaveBeenCalled();
  expect(audit).not.toHaveBeenCalled();
});
it("schedules post-expiry reminders but excludes day eight", async () => {
  const { emit } = scheduledSetup();
  await scheduleMembershipReminders(new Date("2026-10-17T10:00:00Z"));
  expect(emit.mock.calls[0][0].details?.message).toContain(
    "expired 7 day(s) ago",
  );
  emit.mockClear();
  await scheduleMembershipReminders(new Date("2026-10-18T10:00:00Z"));
  expect(emit).not.toHaveBeenCalled();
});
it("uses gym-local date rather than browser or server midnight", () => {
  expect(localDateKey(new Date("2026-10-01T20:00:00Z"), "Asia/Kolkata")).toBe(
    "2026-10-02",
  );
  expect(
    reminderWindow(
      new Date("2026-10-03T20:00:00Z"),
      new Date("2026-10-11T00:00:00Z"),
      "Asia/Kolkata",
    )?.daysRemaining,
  ).toBe(7);
});
it("counts calendar days across daylight-saving transitions", () => {
  expect(
    reminderWindow(
      new Date("2026-11-01T04:00:00Z"),
      new Date("2026-11-08T05:00:00Z"),
      "America/New_York",
    )?.daysRemaining,
  ).toBe(7);
});
it("does not suppress unrelated business notifications", async () =>
  expect(await reminderStillCurrent({})).toBe(true));
it("suppresses an old queued expiry cycle after an end-date change", async () => {
  vi.spyOn(Subscription, "findOne").mockReturnValue({
    lean: async () => null,
  } as never);
  expect(
    await reminderStillCurrent({
      metadata: {
        reminderCycle: true,
        subscriptionId: "old",
        cycleEndsAt: expiry.toISOString(),
      },
    }),
  ).toBe(false);
});
it("suppresses an old subscription after renewal replaced the member's current pointer", async () => {
  const now = new Date();
  vi.spyOn(Subscription, "findOne").mockReturnValue({
    lean: async () => ({
      _id: "old-sub",
      type: "GYM_MEMBERSHIP",
      gymId: "gym",
      memberProfileId: "member",
      endsAt: now,
    }),
  } as never);
  vi.spyOn(Gym, "findOne").mockReturnValue({
    select: () => ({ lean: async () => ({ timezone: "UTC" }) }),
  } as never);
  const pointer = vi.spyOn(MemberProfile, "exists").mockResolvedValue(null);
  expect(
    await reminderStillCurrent({
      metadata: {
        reminderCycle: true,
        subscriptionId: "old",
        cycleEndsAt: now.toISOString(),
      },
    }),
  ).toBe(false);
  expect(pointer.mock.calls[0][0]).toMatchObject({
    currentSubscriptionId: "old-sub",
  });
});
it("accepts only typed, bounded follow-up settings, including zero", () => {
  for (const postExpiryDays of [-1, 8, 2.5, "3"]) expect(gymInput.partial().safeParse({ membershipReminders: { postExpiryDays } }).success).toBe(false);
  for (const postExpiryDays of [0, 3, 7]) expect(gymInput.partial().safeParse({ membershipReminders: { postExpiryDays } }).success).toBe(true);
  expect(gymInput.partial().safeParse({ membershipReminders: { postExpiryDays: 3, enabled: false } }).success).toBe(false);
});
it("shortens follow-ups without changing the seven-day pre-expiry schedule", () => {
  expect(reminderWindow(new Date("2026-10-13T10:00:00Z"), expiry, "UTC", 3)).not.toBeNull();
  expect(reminderWindow(new Date("2026-10-14T10:00:00Z"), expiry, "UTC", 3)).toBeNull();
  expect(reminderWindow(new Date("2026-10-03T10:00:00Z"), expiry, "UTC", 0)).not.toBeNull();
  expect(reminderWindow(new Date("2026-10-10T09:59:59Z"), expiry, "UTC", 0)).not.toBeNull();
  expect(reminderWindow(expiry, expiry, "UTC", 0)).toBeNull();
  expect(reminderWindow(new Date("2026-10-18T10:00:00Z"), expiry, "UTC", 99)).toBeNull();
});
it("does not queue reminders outside the gym setting while leaving platform reminders independent", async () => {
  const { gym, emit, record } = scheduledSetup();
  gym.membershipReminders.postExpiryDays = 3;
  await scheduleMembershipReminders(new Date("2026-10-14T10:00:00Z"));
  expect(emit).not.toHaveBeenCalled();
  gym.membershipReminders.postExpiryDays = 0;
  await scheduleMembershipReminders(expiry);
  expect(emit).not.toHaveBeenCalled();
  record.type = "PLATFORM";
  vi.spyOn(Gym, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
  vi.spyOn(Subscription, "exists").mockReturnValue({ session: async () => null } as never);
  await scheduleMembershipReminders(new Date("2026-10-14T10:00:00Z"));
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({ event: "platform.expiring" }));
});
it("suppresses a queued renewal reminder when the gym shortens its follow-up window", async () => {
  vi.spyOn(Subscription, "findOne").mockReturnValue({ lean: async () => ({ _id: "sub", type: "GYM_MEMBERSHIP", gymId: "gym", memberProfileId: "member", endsAt: expiry }) } as never);
  const settings = { postExpiryDays: 7 };
  vi.spyOn(Gym, "findOne").mockReturnValue({ select: () => ({ lean: async () => ({ timezone: "UTC", membershipReminders: settings }) }) } as never);
  vi.spyOn(MemberProfile, "exists").mockResolvedValue({ _id: "member" } as never);
  const note = { metadata: { reminderCycle: true, subscriptionId: "sub", cycleEndsAt: expiry.toISOString() } }, now = new Date("2026-10-14T10:00:00Z");
  expect(await reminderStillCurrent(note, now)).toBe(true);
  settings.postExpiryDays = 3;
  expect(await reminderStillCurrent(note, now)).toBe(false);
});
