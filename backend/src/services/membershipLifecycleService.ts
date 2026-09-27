import mongoose from "mongoose";
import { Subscription, SubscriptionEvent } from "../models/Commerce.js";
import { AppError } from "../utils/AppError.js";
import { emitDomainEvent } from "./domainEventService.js";

const DAY = 86_400_000;
export type MembershipAction =
  "freeze" | "reactivate" | "activate" | "cancel" | "deactivate" | "expire";

// Dates already include the planned freeze extension. Early resumption returns
// unused whole days while retaining each day (or part-day) actually frozen.
export function applyMembershipTransition(
  subscription: any,
  action: MembershipAction,
  input: { endsAt?: Date; reason?: string },
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
    if (!["FROZEN", "GRACE"].includes(subscription.status))
      fail(
        "Only frozen or grace-period memberships can be reactivated. Expired or cancelled memberships require renewal.",
      );
    if (subscription.status === "FROZEN") {
      const period =
        subscription.freezePeriods?.[subscription.freezePeriods.length - 1];
      if (!period)
        fail(
          "This membership has no freeze period. Contact support to repair its history.",
        );
      const start = new Date(period.startsAt),
        end = new Date(period.endsAt);
      const granted =
        period.extendedDays ??
        Math.max(0, Math.ceil((end.getTime() - start.getTime()) / DAY));
      const actualEnd = new Date(Math.min(now.getTime(), end.getTime()));
      const used = Math.max(
        0,
        Math.ceil((actualEnd.getTime() - start.getTime()) / DAY),
      );
      subscription.endsAt = new Date(
        new Date(subscription.endsAt).getTime() -
          Math.max(0, granted - used) * DAY,
      );
      subscription.renewalAt = subscription.endsAt;
      period.endsAt = actualEnd;
      period.extendedDays = used;
      period.resumedAt = now;
    }
    if (!subscription.endsAt || subscription.endsAt <= now)
      fail("The membership has expired. Renew it to restore access.");
    subscription.status = "ACTIVE";
  } else if (action === "cancel" || action === "deactivate") {
    if (
      !["ACTIVE", "FROZEN", "GRACE", "PENDING_PAYMENT"].includes(
        subscription.status,
      )
    )
      fail("This membership is already inactive.");
    subscription.status = "CANCELLED";
    subscription.cancelledAt = now;
    subscription.cancellationReason = input.reason;
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

export async function transitionMembership(input: {
  publicId: string;
  gymId?: string;
  userId?: string;
  actorId?: string;
  action: MembershipAction;
  endsAt?: Date;
  reason?: string;
}) {
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
    const before = { status: subscription.status, endsAt: subscription.endsAt };
    applyMembershipTransition(subscription, input.action, input);
    await subscription.save({ session });
    const [event] = await SubscriptionEvent.create(
      [
        {
          subscriptionId: subscription._id,
          actorId: input.actorId,
          type: input.action.toUpperCase(),
          payload: {
            before,
            after: { status: subscription.status, endsAt: subscription.endsAt },
            reason: input.reason,
          },
        },
      ],
      { session },
    );
    const eventName =
      subscription.status === "FROZEN"
        ? "membership.frozen"
        : subscription.status === "CANCELLED"
          ? "membership.cancelled"
          : subscription.status === "EXPIRED"
            ? "membership.expired"
            : "membership.reactivated";
    if (subscription.userId)
      await emitDomainEvent({
        event: eventName,
        userId: subscription.userId,
        gymId: subscription.gymId,
        entityId: subscription.publicId,
        occurrenceId: String(event._id),
        actionUrl: "/app/subscriptions",
        session,
      });
    return subscription;
  });
}
