import { useId, useState } from "react";
import { createPortal } from "react-dom";

export function gymDate(value: string | undefined, timezone = "Asia/Kolkata") {
  return value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: timezone,
        day: "2-digit",
        month: "short",
        year: "numeric",
      }).format(new Date(value))
    : "Not recorded";
}
export function membershipPresentation(
  member: Record<string, any>,
  timezone: string,
  now = new Date(),
) {
  const subscription = member.currentSubscriptionId;
  const end = subscription?.endsAt ? new Date(subscription.endsAt) : null;
  const dateKey = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(date);
  const days =
    end && Number.isFinite(end.getTime())
      ? Math.round(
          (Date.parse(dateKey(end)) - Date.parse(dateKey(now))) / 86400000,
        )
      : null;
  let state = subscription?.status || (member.directAccess ? "ACTIVE" : "NONE");
  if (member.status === "ARCHIVED") state = "CANCELLED";
  else if (["INACTIVE", "SUSPENDED"].includes(member.status)) state = "DEACTIVATED";
  else if (end && end < now && ["ACTIVE", "GRACE"].includes(state))
    state = "EXPIRED";
  else if (state === "ACTIVE" && days !== null && days >= 0 && days <= 7)
    state = "EXPIRING";
  const labels: Record<string, string> = {
    ACTIVE: "Active",
    EXPIRING: "Expiring soon",
    FROZEN: "Frozen",
    EXPIRED: "Expired",
    CANCELLED: "Cancelled",
    DEACTIVATED: "Deactivated",
    NONE: "Not enrolled",
    GRACE: "Grace period",
    PENDING_PAYMENT: "Payment pending",
  };
  return {
    state,
    label: labels[state] || state,
    daysRemaining: days,
    plan:
      subscription?.planSnapshot?.name ||
      (member.directAccess ? "Approved direct access" : "No membership"),
  };
}
export function MembershipStatusDot({
  member,
  timezone,
  now,
}: {
  member: Record<string, any>;
  timezone: string;
  now?: Date;
}) {
  const id = useId(),
    [position, setPosition] = useState<{ top: number; left: number } | null>(
      null,
    );
  const view = membershipPresentation(member, timezone, now);
  const show = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    setPosition({
      top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 190)),
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 288)),
    });
  };
  return (
    <>
      <button
        type="button"
        className={`membership-status-trigger status-${view.state.toLowerCase()}`}
        aria-label={`Membership status: ${view.label}. ${view.plan}`}
        aria-describedby={position ? id : undefined}
        onFocus={(event) => show(event.currentTarget)}
        onBlur={() => setPosition(null)}
        onMouseEnter={(event) => show(event.currentTarget)}
        onMouseLeave={() => setPosition(null)}
        onClick={(event) => show(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setPosition(null);
        }}
      >
        <span aria-hidden="true" />
      </button>
      {position &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="membership-status-tooltip"
            style={position}
          >
            <strong>Membership status</strong>
            <dl>
              <dt>Status</dt>
              <dd>{view.label}</dd>
              <dt>Plan</dt>
              <dd>{view.plan}</dd>
              <dt>Started</dt>
              <dd>
                {gymDate(member.currentSubscriptionId?.startsAt, timezone)}
              </dd>
              <dt>Expires</dt>
              <dd>{gymDate(member.currentSubscriptionId?.endsAt, timezone)}</dd>
            </dl>
            {view.state === "EXPIRING" && (
              <p>
                {view.daysRemaining === 0
                  ? "Expires today"
                  : `Expires in ${view.daysRemaining} days`}
              </p>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
