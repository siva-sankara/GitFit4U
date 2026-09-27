import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Subscription, SubscriptionEvent, Payment } from "../models/Commerce.js";
import { Refund } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { emitDomainEvent } from "./domainEventService.js";
import { transitionMembership, transitionMemberAccess } from "./membershipLifecycleService.js";
vi.mock("./domainEventService.js", () => ({ emitDomainEvent: vi.fn() }));
const now = new Date("2026-09-27T10:00:00Z"), session = {} as any;
const gymId = "507f1f77bcf86cd799439011", userId = "507f1f77bcf86cd799439012", ownerId = "507f1f77bcf86cd799439013";
const scoped = (value: unknown) => ({ session: vi.fn().mockResolvedValue(value) }) as any;
let member: any, subscription: any;
const owner = { publicId: "subscription", gymId, actorId: ownerId, actorRole: "GYM_OWNER" };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(now); vi.clearAllMocks();
  subscription = { _id: "507f1f77bcf86cd799439014", publicId: "subscription", type: "GYM_MEMBERSHIP", memberProfileId: "507f1f77bcf86cd799439015", userId, gymId,
    latestPaymentId: "507f1f77bcf86cd799439016", status: "ACTIVE", startsAt: new Date("2026-09-01T10:00:00Z"), endsAt: new Date("2026-10-01T10:00:00Z"), save: vi.fn().mockResolvedValue(undefined) };
  member = { _id: subscription.memberProfileId, publicId: "member", userId, gymId, currentSubscriptionId: subscription._id, status: "ACTIVE", directAccess: false, save: vi.fn().mockResolvedValue(undefined) };
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (work: any) => work(session));
  vi.spyOn(Subscription, "findOne").mockImplementation(() => scoped(subscription));
  vi.spyOn(Subscription, "find").mockImplementation(() => scoped([subscription]));
  vi.spyOn(SubscriptionEvent, "create").mockResolvedValue([{ _id: "event" }] as any);
  vi.spyOn(MemberProfile, "findOne").mockImplementation(() => scoped(member));
  vi.spyOn(Gym, "exists").mockReturnValue(scoped({ _id: gymId }));
  vi.spyOn(User, "exists").mockReturnValue(scoped({ _id: userId }));
  vi.spyOn(Payment, "findOneAndUpdate").mockResolvedValue({ _id: subscription.latestPaymentId } as any);
  vi.spyOn(Refund, "exists").mockReturnValue(scoped(null));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });
it("audits deactivate/reactivate, restores access and keeps the original paid interval", async () => {
  const end = subscription.endsAt.getTime();
  await transitionMembership({ ...owner, action: "deactivate", reason: "Temporary hold" });
  expect(member.status).toBe("INACTIVE"); expect(subscription.status).toBe("DEACTIVATED");
  await transitionMembership({ ...owner, action: "reactivate", reason: "Hold resolved" });
  expect(member.status).toBe("ACTIVE"); expect(subscription.status).toBe("ACTIVE");
  expect(subscription.endsAt.getTime()).toBe(end);
  expect(member).toMatchObject({ deactivatedAt: now, deactivatedBy: ownerId, reactivatedAt: now, reactivatedBy: ownerId });
  expect(SubscriptionEvent.create).toHaveBeenCalledWith([expect.objectContaining({ actorId: ownerId, type: "REACTIVATE", occurredAt: now, payload: expect.objectContaining({ reason: "Hold resolved" }) })], { session });
  expect(emitDomainEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "membership.deactivated", session }));
  expect(emitDomainEvent).toHaveBeenCalledWith(expect.objectContaining({ event: "membership.reactivated", session }));
  expect(Payment.findOneAndUpdate).toHaveBeenCalledWith(expect.objectContaining({ status: "CAPTURED", subscriptionId: subscription._id, payerId: userId }), { $inc: { "metadata.accessRevision": 1 } }, expect.objectContaining({ session }));
});
it("keeps owner tenant scope and rejects the wrong owner without a write", async () => {
  vi.mocked(Subscription.findOne).mockReturnValue(scoped(null));
  await expect(transitionMembership({ ...owner, gymId: "507f1f77bcf86cd799439099", action: "reactivate" })).rejects.toMatchObject({ statusCode: 404 });
  expect(Subscription.findOne).toHaveBeenCalledWith(expect.objectContaining({ gymId: "507f1f77bcf86cd799439099" }));
  expect(subscription.save).not.toHaveBeenCalled();
});
it.each(["USER", "GYM_STAFF"])("prevents %s from undoing management deactivation", async (actorRole) => {
  subscription.status = "DEACTIVATED"; member.status = "INACTIVE";
  await expect(transitionMembership({ ...owner, actorRole, action: "reactivate" })).rejects.toMatchObject({ statusCode: 403 });
  expect(Payment.findOneAndUpdate).not.toHaveBeenCalled();
});
it.each(["unpaid", "refund", "expired", "superseded"])("rejects %s restoration before membership activation", async (condition) => {
  subscription.status = "CANCELLED"; member.status = "INACTIVE";
  if (condition === "unpaid") vi.mocked(Payment.findOneAndUpdate).mockResolvedValue(null);
  if (condition === "refund") vi.mocked(Refund.exists).mockReturnValue(scoped({ _id: "refund" }));
  if (condition === "expired") subscription.endsAt = new Date(now.getTime() - 1);
  if (condition === "superseded") member.currentSubscriptionId = "other-cycle";
  await expect(transitionMembership({ ...owner, action: "reactivate" })).rejects.toMatchObject({ statusCode: 409 });
  expect(subscription.status).toBe("CANCELLED"); expect(subscription.save).not.toHaveBeenCalled();
  expect(emitDomainEvent).not.toHaveBeenCalled();
});
it("restores previously approved direct access but rejects unapproved or archived profiles", async () => {
  member.currentSubscriptionId = undefined; member.status = "INACTIVE";
  member.approvedAt = now; member.approvedBy = ownerId;
  await transitionMemberAccess(member, "ACTIVE", { actorId: ownerId, actorRole: "GYM_OWNER", reason: "Approved again" }, session);
  expect(member.directAccess).toBe(true); expect(member.status).toBe("ACTIVE");
  expect(Payment.findOneAndUpdate).not.toHaveBeenCalled();
  member.status = "INACTIVE"; member.directAccess = false; member.approvedAt = undefined; member.approvedBy = undefined;
  await expect(transitionMemberAccess(member, "ACTIVE", { actorId: ownerId, actorRole: "GYM_OWNER" }, session)).rejects.toMatchObject({ code: "ACCESS_APPROVAL_REQUIRED" });
  member.status = "ARCHIVED";
  await expect(transitionMemberAccess(member, "ACTIVE", { actorId: ownerId, actorRole: "ADMIN" }, session)).rejects.toMatchObject({ code: "MEMBER_ARCHIVED" });
});
