import { describe, expect, it } from "vitest";
import { beforeEach, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  findUser: vi.fn(),
  select: vi.fn(),
  session: vi.fn(),
  lean: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../models/User.js", () => ({ User: { findById: mocks.findUser } }));
vi.mock("../models/Engagement.js", () => ({
  Notification: { updateOne: mocks.update },
}));
import {
  emitDomainEvent,
  notificationEvents,
  notificationPayload,
} from "./domainEventService.js";
beforeEach(() => {
  vi.resetAllMocks();
  mocks.findUser.mockReturnValue({ select: mocks.select });
  mocks.select.mockReturnValue({ session: mocks.session });
  mocks.session.mockReturnValue({ lean: mocks.lean });
  mocks.lean.mockResolvedValue({ status: "ACTIVE" });
});
describe("domain notification contracts", () => {
  it("deduplicates retries without suppressing later state transitions", () => {
    expect(
      notificationPayload("membership.reactivated", "sub", "event1").dedupeKey,
    ).toBe(
      notificationPayload("membership.reactivated", "sub", "event1").dedupeKey,
    );
    expect(
      notificationPayload("membership.reactivated", "sub", "event2").dedupeKey,
    ).not.toBe(
      notificationPayload("membership.reactivated", "sub", "event1").dedupeKey,
    );
  });
  it("covers the lifecycle and keeps private message bodies out of push copy", () => {
    for (const event of Object.keys(
      notificationEvents,
    ) as (keyof typeof notificationEvents)[]) {
      expect(notificationPayload(event, "record").message).toBeTruthy();
    }
    expect(
      notificationPayload("message.received", "message").message,
    ).toContain("Open your conversations");
  });
});
describe("notification recipient policy and durable deduplication", () => {
  const event = {
    event: "account.registered" as const,
    userId: "recipient",
    entityId: "account",
  };
  it("retains welcome messages for pending accounts but does not send push before verification", async () => {
    mocks.lean.mockResolvedValue({
      status: "PENDING_VERIFICATION",
      notificationPreferences: { push: true },
    });
    await emitDomainEvent(event);
    expect(mocks.update.mock.calls[0][1].$setOnInsert).toMatchObject({
      channels: ["IN_APP"],
      pushStatus: "NOT_REQUESTED",
    });
  });
  it.each(["DISABLED", "BLOCKED"])(
    "does not deliver notifications to %s accounts",
    async (status) => {
      mocks.lean.mockResolvedValue({ status });
      await emitDomainEvent(event);
      expect(mocks.update).not.toHaveBeenCalled();
    },
  );
  it.each([
    { push: false },
    { push: true, categories: ["PAYMENT"] },
    { categories: [] },
  ])(
    "respects push preferences while preserving the inbox: %j",
    async (notificationPreferences) => {
      mocks.lean.mockResolvedValue({
        status: "ACTIVE",
        notificationPreferences,
      });
      await emitDomainEvent(event);
      expect(mocks.update.mock.calls[0][1].$setOnInsert).toMatchObject({
        channels: ["IN_APP"],
        pushStatus: "NOT_REQUESTED",
      });
    },
  );
  it("enqueues push for an allowed active-account category", async () => {
    mocks.lean.mockResolvedValue({
      status: "ACTIVE",
      notificationPreferences: { categories: ["SYSTEM"] },
    });
    await emitDomainEvent(event);
    expect(mocks.update.mock.calls[0][1].$setOnInsert).toMatchObject({
      channels: ["IN_APP", "PUSH"],
      pushStatus: "QUEUED",
    });
  });
  it("uses one insert-only upsert identity for retries without resetting read or delivery state", async () => {
    await emitDomainEvent(event);
    await emitDomainEvent(event);
    const [first, second] = mocks.update.mock.calls;
    expect(first[0]).toEqual(second[0]);
    expect(first[0]).toEqual({
      userId: "recipient",
      dedupeKey: "account.registered:account:once",
    });
    expect(Object.keys(first[1])).toEqual(["$setOnInsert"]);
    expect(first[1].$setOnInsert).not.toHaveProperty("readAt");
    expect(first[2]).toEqual({ upsert: true });
  });
  it("keeps notification reads and writes inside the supplied transaction and rejects external action URLs", async () => {
    const session = {} as any;
    await emitDomainEvent({
      ...event,
      actionUrl: "//external.example/account",
      session,
    });
    expect(mocks.session).toHaveBeenCalledWith(session);
    expect(mocks.update.mock.calls[0][2]).toEqual({ upsert: true, session });
    expect(mocks.update.mock.calls[0][1].$setOnInsert.actionUrl).toBe(
      "/notifications",
    );
  });
});
