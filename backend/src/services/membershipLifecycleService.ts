import mongoose, { type ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { Payment, Subscription, SubscriptionEvent } from "../models/Commerce.js";
import { Refund } from "../models/Business.js";
import { MemberProfile } from "../models/Member.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { emitDomainEvent } from "./domainEventService.js";

const DAY = 86_400_000;
export type MembershipAction =
  "freeze" | "reactivate" | "activate" | "cancel" | "deactivate" | "expire";

function finishFreeze(subscription: any, now: Date) {
  const period = subscription.freezePeriods?.[subscription.freezePeriods.length - 1];
  if (!period)
    throw new AppError(409, "INVALID_SUBSCRIPTION_TRANSITION", "This membership has no freeze period. Contact support to repair its history.");
  const start = new Date(period.startsAt), end = new Date(period.endsAt);
  const granted = period.extendedDays ?? Math.max(0, Math.ceil((end.getTime() - start.getTime()) / DAY));
  const actualEnd = new Date(Math.min(now.getTime(), end.getTime()));
  const used = Math.max(0, Math.ceil((actualEnd.getTime() - start.getTime()) / DAY));
  subscription.endsAt = new Date(new Date(subscription.endsAt).getTime() - Math.max(0, granted - used) * DAY);
  subscription.renewalAt = subscription.endsAt;
  period.endsAt = actualEnd;
  period.extendedDays = used;
  period.resumedAt = now;
}

// Dates already include the planned freeze extension. Early resumption returns
// unused whole days while retaining each day (or part-day) actually frozen.
export function applyMembershipTransition(
  subscription: any,
  action: MembershipAction,
  input: { endsAt?: Date; reason?: string; actorId?: string; allowRestore?: boolean },
  now = new Date(),
) {
  const fail = (message: string) => {
    throw new AppError(409, "INVALID_SUBSCRIPTION_TRANSITION", message);
  };
  if (action === "freeze") {
    if (
      subscription.status !== "ACTIVE" ||
      !subscription.startsAt ||
      subscription.startsAt > now ||
      !subscription.endsAt ||
      subscription.endsAt <= now
    )
      fail("Only a current active membership can be frozen.");
    const end = input.endsAt && new Date(input.endsAt);
    const days = end ? Math.ceil((end.getTime() - now.getTime()) / DAY) : NaN;
    if (!Number.isFinite(days) || days < 1)
      throw new AppError(
        422,
        "INVALID_FREEZE_DATES",
        "Select a future freeze end date.",
      );
    const used = (subscription.freezePeriods || []).reduce(
      (total: number, period: any) =>
        total +
        Math.max(
          0,
          Math.ceil(
            (new Date(period.endsAt).getTime() -
              new Date(period.startsAt).getTime()) /
              DAY,
          ),
        ),
      0,
    );
    const allowed = Number(subscription.planSnapshot?.freezeDaysAllowed || 0);
    if (days + used > allowed)
      throw new AppError(
        422,
        "FREEZE_ALLOWANCE_EXCEEDED",
        `This plan has ${Math.max(0, allowed - used)} freeze days remaining.`,
      );
    subscription.freezePeriods ||= [];
    subscription.freezePeriods.push({
      startsAt: now,
      endsAt: end,
      extendedDays: days,
      reason: input.reason,
    });
    subscription.endsAt = new Date(
      new Date(subscription.endsAt).getTime() + days * DAY,
    );
    subscription.renewalAt = subscription.endsAt;
    subscription.status = "FROZEN";
  } else if (action === "reactivate" || action === "activate") {
    if (!["FROZEN", "GRACE"].includes(subscription.status) &&
      !(input.allowRestore && ["DEACTIVATED", "CANCELLED", "ACTIVE"].includes(subscription.status)))
      fail(
        "This membership cannot be reactivated without an eligible paid entitlement. Renew it or contact gym management.",
      );
    if (subscription.status === "FROZEN") finishFreeze(subscription, now);
    if (!subscription.endsAt || subscription.endsAt <= now)
      fail("The membership has expired. Renew it to restore access.");
    subscription.status = "ACTIVE";
    subscription.reactivatedAt = now;
    subscription.reactivatedBy = input.actorId;
    subscription.reactivationReason = input.reason;
  } else if (action === "cancel" || action === "deactivate") {
    if (
      !["ACTIVE", "FROZEN", "GRACE", "PENDING_PAYMENT", ...(action === "cancel" ? ["DEACTIVATED"] : [])].includes(
        subscription.status,
      )
    )
      fail("This membership is already inactive.");
    if (subscription.status === "FROZEN") finishFreeze(subscription, now);
    if (action === "deactivate") {
      subscription.status = "DEACTIVATED";
      subscription.deactivatedAt = now;
      subscription.deactivatedBy = input.actorId;
      subscription.deactivationReason = input.reason;
    } else {
      subscription.status = "CANCELLED";
      subscription.cancelledAt = now;
      subscription.cancelledBy = input.actorId;
      subscription.cancellationReason = input.reason;
    }
  } else if (action === "expire") {
    if (
      !["ACTIVE", "GRACE", "FROZEN"].includes(subscription.status) ||
      !subscription.endsAt ||
      subscription.endsAt > now ||
      (subscription.status === "FROZEN" &&
        subscription.freezePeriods?.some(
          (period: any) => new Date(period.endsAt) > now,
        ))
    )
      fail("Only elapsed memberships can expire.");
    subscription.status = "EXPIRED";
  } else fail("Unsupported membership action.");
  return subscription;
}

type TransitionInput = {
  publicId: string;
  gymId?: string;
  userId?: string;
  actorId?: string;
  actorRole?: string;
  action: MembershipAction;
  endsAt?: Date;
  reason?: string;
};
function requireManagement(input: { actorRole?: string; actorId?: string; gymId?: string }) {
  if (!input.actorId || !["ADMIN", "GYM_OWNER"].includes(input.actorRole || "") ||
    (input.actorRole === "GYM_OWNER" && !input.gymId))
    throw new AppError(403, "ACCESS_MANAGEMENT_FORBIDDEN", "Only an authorized gym owner or administrator can restore or deactivate gym access.");
}
async function validAccessAccount(member: any, session: ClientSession) {
  if (member.invitation?.status === "PENDING")
    throw new AppError(409, "INVITATION_PENDING", "The member must accept their invitation before gym access can be restored.");
  if (member.status === "ARCHIVED")
    throw new AppError(409, "MEMBER_ARCHIVED", "Archived members cannot be reactivated. Contact an administrator.");
  if (!(await Gym.exists({ _id: member.gymId, status: "ACTIVE", deletedAt: null }).session(session)))
    throw new AppError(409, "GYM_NOT_ACTIVE", "Activate the gym before restoring member access.");
  if (!(await User.exists({ _id: member.userId, status: { $nin: ["BLOCKED", "DISABLED"] } }).session(session)))
    throw new AppError(409, "MEMBER_ACCOUNT_UNAVAILABLE", "This member's account cannot receive gym access.");
}
async function eligiblePayment(subscription: any, session: ClientSession) {
  // Lock the authoritative receipt in this transaction. Refund processing also
  // writes this document, so a concurrent refund cannot bypass this check.
  const payment = subscription.latestPaymentId && await Payment.findOneAndUpdate({
    _id: subscription.latestPaymentId, subscriptionId: subscription._id,
    gymId: subscription.gymId, payerId: subscription.userId,
    purpose: "MEMBERSHIP", status: "CAPTURED", capturedAt: { $ne: null },
  }, { $inc: { "metadata.accessRevision": 1 } }, { session, returnDocument: "after" });
  if (!payment || await Refund.exists({ paymentId: payment._id, status: { $in: ["REQUESTED", "PROCESSING", "PROCESSED"] } }).session(session))
    throw new AppError(409, "PAYMENT_REQUIRED", "This membership has no eligible captured payment, or has a refund in progress or completed. Renew or contact support.");
}
async function validatePaidRestoration(subscription: any, member: any, session: ClientSession, now: Date) {
  await validAccessAccount(member, session);
  if (!subscription.endsAt || subscription.endsAt <= now)
    throw new AppError(409, "RENEWAL_REQUIRED", "This membership has expired. A new paid renewal is required to restore access.");
  if (!subscription.startsAt || subscription.startsAt > now)
    throw new AppError(409, "MEMBERSHIP_NOT_STARTED", "This paid membership has not started. Access can resume on its recorded start date.");
  if (String(member.currentSubscriptionId || "") !== String(subscription._id))
    throw new AppError(409, "MEMBERSHIP_SUPERSEDED", "A different membership cycle is current. Open the current membership instead.");
  await eligiblePayment(subscription, session);
}
async function recordTransition(subscription: any, input: TransitionInput, session: ClientSession, now: Date, allowRestore = false) {
  const before = { status: subscription.status, startsAt: subscription.startsAt, endsAt: subscription.endsAt };
  applyMembershipTransition(subscription, input.action, { ...input, allowRestore }, now);
  await subscription.save({ session });
  const [event] = await SubscriptionEvent.create([{ subscriptionId: subscription._id, actorId: input.actorId,
    type: input.action.toUpperCase(), occurredAt: now,
    payload: { before, after: { status: subscription.status, startsAt: subscription.startsAt, endsAt: subscription.endsAt }, reason: input.reason },
  }], { session });
  const eventName = subscription.status === "FROZEN" ? "membership.frozen"
    : subscription.status === "DEACTIVATED" ? "membership.deactivated"
    : subscription.status === "CANCELLED" ? "membership.cancelled"
    : subscription.status === "EXPIRED" ? "membership.expired" : "membership.reactivated";
  if (subscription.userId) await emitDomainEvent({ event: eventName, userId: subscription.userId,
    gymId: subscription.gymId, entityId: subscription.publicId, occurrenceId: String(event._id), actionUrl: "/app/subscriptions", session });
}
function recordMemberAccess(member: any, active: boolean, actorId: string, reason: string | undefined, now: Date) {
  if (active) {
    member.status = "ACTIVE";
    member.reactivatedAt = now;
    member.reactivatedBy = actorId;
    member.reactivationReason = reason;
  } else {
    member.directAccessBeforeDeactivation ||= member.directAccess;
    member.directAccess = false;
    member.deactivatedAt = now;
    member.deactivatedBy = actorId;
    member.deactivationReason = reason;
  }
}
/** Shared by existing owner/admin member PATCH routes; caller saves member. */
export async function transitionMemberAccess(member: any, status: string, input: { actorId: string; actorRole: string; reason?: string }, session: ClientSession) {
  if (status === member.status) return;
  requireManagement({ ...input, gymId: String(member.gymId) });
  const now = new Date();
  if (status === "ACTIVE") {
    await validAccessAccount(member, session);
    if (member.status === "JOIN_REQUESTED")
      throw new AppError(409, "JOIN_APPROVAL_REQUIRED", "Use Approve join request to grant gym access.");
    if (member.currentSubscriptionId) {
      const subscription = await Subscription.findOne({ _id: member.currentSubscriptionId, memberProfileId: member._id, gymId: member.gymId, type: "GYM_MEMBERSHIP" }).session(session);
      if (!subscription) throw new AppError(409, "RENEWAL_REQUIRED", "The membership record is unavailable. Renew or contact support.");
      await validatePaidRestoration(subscription, member, session, now);
      await recordTransition(subscription, { publicId: subscription.publicId, ...input, action: "reactivate" }, session, now, true);
    } else if (!(member.directAccessBeforeDeactivation || (member.approvedAt && member.approvedBy))) {
      throw new AppError(409, "ACCESS_APPROVAL_REQUIRED", "No paid membership or previous direct-access approval can be restored.");
    } else member.directAccess = true;
    recordMemberAccess(member, true, input.actorId, input.reason, now);
    // Paid subscription transition emits its own notification; the access-only
    // branch has no SubscriptionEvent and uses its own immutable occurrence ID.
    if (!member.currentSubscriptionId) await emitDomainEvent({ event: "membership.reactivated", userId: member.userId, gymId: member.gymId, entityId: member.publicId, occurrenceId: nanoid(), actionUrl: "/app/attendance", session });
    return;
  }
  if (!["INACTIVE", "SUSPENDED", "ARCHIVED"].includes(status))
    throw new AppError(409, "INVALID_MEMBER_TRANSITION", "Choose a valid member access state.");
  if (member.status === "ARCHIVED")
    throw new AppError(409, "MEMBER_ARCHIVED", "Archived member records cannot be restored through access controls.");
  const memberships = await Subscription.find({ gymId: member.gymId, memberProfileId: member._id, type: "GYM_MEMBERSHIP",
    status: { $in: ["ACTIVE", "FROZEN", "GRACE", "PENDING_PAYMENT", ...(status === "ARCHIVED" ? ["DEACTIVATED"] : [])] },
  }).session(session);
  for (const subscription of memberships)
    await recordTransition(subscription, { publicId: subscription.publicId, ...input, action: status === "ARCHIVED" ? "cancel" : "deactivate" }, session, now);
  recordMemberAccess(member, false, input.actorId, input.reason, now);
  member.status = status;
  if (!memberships.length) await emitDomainEvent({ event: "membership.deactivated", userId: member.userId, gymId: member.gymId, entityId: member.publicId, occurrenceId: nanoid(), actionUrl: "/app/attendance", session });
}

export async function transitionMembership(input: TransitionInput) {
  return mongoose.connection.transaction(async (session) => {
    const subscription = await Subscription.findOne({
      publicId: input.publicId,
      type: "GYM_MEMBERSHIP",
      ...(input.gymId ? { gymId: input.gymId } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
    }).session(session);
    if (!subscription)
      throw new AppError(
        404,
        "SUBSCRIPTION_NOT_FOUND",
        "Membership not found.",
      );
    const member = await MemberProfile.findOne({ _id: subscription.memberProfileId, gymId: subscription.gymId, userId: subscription.userId }).session(session);
    const restoring = ["reactivate", "activate"].includes(input.action);
    const restoresAccess = restoring && (["CANCELLED", "DEACTIVATED"].includes(subscription.status) || (member && member.status !== "ACTIVE"));
    const now = new Date();
    if (restoresAccess || input.action === "deactivate") requireManagement(input);
    if (restoresAccess) {
      if (!member) throw new AppError(409, "MEMBER_NOT_FOUND", "This membership has no matching member access record.");
      await validatePaidRestoration(subscription, member, session, now);
    }
    // Preserve legacy freeze history that predates payment links, but never
    // reopen a linked entitlement whose receipt has been refunded or revoked.
    if (restoring && !restoresAccess && subscription.latestPaymentId)
      await eligiblePayment(subscription, session);
    if (input.userId && member?.status !== "ACTIVE")
      throw new AppError(403, "ACCESS_DEACTIVATED", "Gym management must restore your access before you can change this membership.");
    await recordTransition(subscription, input, session, now, restoresAccess);
    if (member && (restoresAccess || input.action === "deactivate")) {
      recordMemberAccess(member, restoresAccess, input.actorId!, input.reason, now);
      if (!restoresAccess) member.status = "INACTIVE";
      await member.save({ session });
    }
    return subscription;
  });
}
