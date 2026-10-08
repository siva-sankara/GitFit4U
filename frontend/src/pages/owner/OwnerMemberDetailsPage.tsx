import { PageHeader } from "../../components/PageHeader";
import { useEffect, useState } from "react";
import { useCurrentUser } from "../../api/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { StatusBadge } from "../../components/StatusBadge";
import { Modal } from "../../components/Modal";
import { Avatar } from "../../components/Avatar";
import { MemberQuickActions } from "../../components/MemberQuickActions";
import { MemberInvitationStatus } from "../../components/MemberInvitationStatus";
import { gymDate } from "../../components/MembershipStatusDot";
import {
  MemberEditor,
  memberName,
  formatMoney,
  type MemberRow,
} from "./OwnerMembersPage";

export function OwnerMemberDetailsPage({ id }: { id: string }) {
  const location = useLocation();
  const session = useCurrentUser();
  const canManage =
    session.data?.data.context.permissions.includes("member:write");
  const canReadFinance =
    session.data?.data.context.permissions.includes("finance:read");
  const canManageAccess = Boolean(
    canManage &&
    ["GYM_OWNER", "ADMIN"].includes(session.data?.data.context.role || ""),
  );
  const path = "/api/v1/owner/members/" + encodeURIComponent(id),
    client = useQueryClient();
  const query = useQuery({
    queryKey: ["api", path],
    queryFn: () =>
      apiRequest<
        ApiEnvelope<{
          member: MemberRow;
          attendance: MemberRow[];
          payments: MemberRow[];
          timezone: string;
        }>
      >(path),
    retry: false,
  });
  const trainers = useQuery({
    queryKey: ["api", "/api/v1/owner/trainers?limit=100"],
    enabled:
      !!canManage &&
      !!session.data?.data.context.permissions.includes("gym:read"),
    queryFn: () =>
      apiRequest<ApiEnvelope<MemberRow[]>>("/api/v1/owner/trainers?limit=100"),
  });
  const [edit, setEdit] = useState(false),
    [action, setAction] = useState(""),
    [reason, setReason] = useState(""),
    [days, setDays] = useState(1);
  const member = query.data?.data.member,
    subscription = member?.currentSubscriptionId;
  const timezone = query.data?.data.timezone || "Asia/Kolkata";
  const assignedTrainer = member?.assignedTrainerId;
  useEffect(() => {
    if (!member || !location.hash) return;
    const targetId = decodeURIComponent(location.hash.slice(1));
    const timer = window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView?.({
        behavior: "smooth",
        block: "start",
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [location.hash, member]);
  const saved = () => {
    setEdit(false);
    setAction("");
    void client.invalidateQueries({ queryKey: ["api"] });
  };
  const update = useMutation({
    mutationFn: ({
      url,
      body,
      method = "POST",
    }: {
      url: string;
      body: object;
      method?: string;
    }) =>
      apiRequest(url, {
        method,
        body: JSON.stringify(body),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: saved,
  });
  function perform() {
    if (action === "deactivate-access" || action === "reactivate-access")
      update.mutate({
        url: path,
        method: "PATCH",
        body: {
          status: action === "deactivate-access" ? "INACTIVE" : "ACTIVE",
          note: reason,
        },
      });
    else if (action === "archive")
      update.mutate({
        url: path,
        method: "PATCH",
        body: { status: "ARCHIVED", note: reason },
      });
    else if (action === "approve" || action === "reject")
      update.mutate({ url: path + "/join/" + action, body: {} });
    else
      update.mutate({
        url:
          "/api/v1/owner/subscriptions/" + subscription.publicId + "/" + action,
        body: {
          reason,
          ...(action === "freeze"
            ? { endsAt: new Date(Date.now() + days * 86400000).toISOString() }
            : {}),
        },
      });
  }
  if (query.isPending) return <p role="status">Loading member details...</p>;
  if (query.isError || !member)
    return (
      <div className="panel state-card" role="alert">
        <p>{query.error?.message || "Member unavailable."}</p>
        <button
          className="btn btn-secondary"
          onClick={() => void query.refetch()}
        >
          Retry
        </button>
      </div>
    );
  return (
    <div className="page-stack compact-member-details">
      <PageHeader>
        <div>
          <span className="eyebrow">Member details</span>
          <h1>{memberName(member)}</h1>
          <p>{member.memberCode}</p>
          <MemberQuickActions
            member={member}
            expanded
            ownerMember
            canMessage={Boolean(canManage)}
          />
        </div>
        <div className="heading-actions">
          <Link to="/owner/members" className="btn btn-secondary">
            All members
          </Link>
          {canManage && (
            <button className="btn btn-primary" onClick={() => setEdit(true)}>
              Edit member
            </button>
          )}
        </div>
      </PageHeader>
      <div className="member-detail-grid">
        <section className="panel">
          <h2>Profile and contact</h2>
          <MemberInvitationStatus member={member} canManage={canManage} />
          <dl className="member-summary-grid">
            <div>
              <Avatar
                name={memberName(member)}
                src={member.contact?.avatarUrl || member.userId?.avatarUrl}
                thumbnailSrc={
                  member.contact?.avatarThumbnailUrl ||
                  (!member.contact?.avatarUrl
                    ? member.userId?.avatarThumbnailUrl
                    : undefined)
                }
                size={48}
              />
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                {member.contact?.email ||
                  member.userId?.email ||
                  "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>
                {member.contact?.phone ||
                  member.userId?.phone ||
                  "Not provided"}
              </dd>
            </div>
            <div>
              <dt>Member status</dt>
              <dd>
                <StatusBadge status={member.status} />
              </dd>
            </div>
            <div>
              <dt>Emergency contact</dt>
              <dd>
                {member.emergencyContact?.name || "Not provided"}
                <br />
                {member.emergencyContact?.phone}
              </dd>
            </div>
            <div>
              <dt>Fitness goal</dt>
              <dd>{member.fitnessGoal || "Not provided"}</dd>
            </div>
            <div>
              <dt>Medical information</dt>
              <dd>{member.medicalNotes || "Not provided"}</dd>
            </div>
          </dl>
        </section>
        <section id="member-membership" className="panel">
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <h2>Gym access and membership</h2>
            <div className="heading-actions">
              {canManageAccess &&
                subscription.status === "ACTIVE" &&
                Number(subscription.planSnapshot?.freezeDaysAllowed) > 0 && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAction("freeze")}
                  >
                    Freeze
                  </button>
                )}
              {canManageAccess &&
                member.status !== "ARCHIVED" &&
                ["FROZEN", "DEACTIVATED", "CANCELLED"].includes(
                  subscription.status,
                ) && (
                  <button
                    className="btn btn-primary"
                    onClick={() => setAction("reactivate")}
                  >
                    {subscription.status === "FROZEN"
                      ? "Unfreeze membership"
                      : "Reactivate membership"}
                  </button>
                )}
              {canManageAccess &&
                ["ACTIVE", "FROZEN", "GRACE"].includes(subscription.status) && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAction("deactivate")}
                  >
                    Deactivate membership
                  </button>
                )}
            </div>
          </div>
          {subscription ? (
            <>
              <dl className="member-summary-grid">
                <div>
                  <dt>Plan</dt>
                  <dd>{subscription.planSnapshot?.name}</dd>
                </div>
                <div>
                  <dt>Membership status</dt>
                  <dd>
                    <StatusBadge status={subscription.status} />
                  </dd>
                </div>
                <div>
                  <dt>Start date</dt>
                  <dd>
                    {subscription.startsAt
                      ? gymDate(subscription.startsAt, timezone)
                      : "Pending"}
                  </dd>
                </div>
                <div>
                  <dt>End date</dt>
                  <dd>
                    {subscription.endsAt
                      ? gymDate(subscription.endsAt, timezone)
                      : "Pending"}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p>
              {member.directAccess
                ? "Direct gym access approved without a paid membership plan."
                : "No paid membership has been created."}
            </p>
          )}
          {canManageAccess &&
            member.directAccess &&
            !subscription &&
            ["ACTIVE", "INACTIVE", "SUSPENDED"].includes(member.status) && (
              <button
                className="btn btn-secondary"
                onClick={() =>
                  setAction(
                    member.status === "ACTIVE"
                      ? "deactivate-access"
                      : "reactivate-access",
                  )
                }
              >
                {member.status === "ACTIVE"
                  ? "Deactivate gym access"
                  : "Reactivate gym access"}
              </button>
            )}
          {canManageAccess && member.status === "JOIN_REQUESTED" && (
            <div className="heading-actions">
              <button
                className="btn btn-primary"
                onClick={() => setAction("approve")}
              >
                Approve join request
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setAction("reject")}
              >
                Reject request
              </button>
            </div>
          )}
          <label className="field" style={{ marginTop: 20 }}>
            <span>Assigned trainer</span>
            <div
              style={{
                width: "350px",
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <select
                className="select"
                value={
                  assignedTrainer?._id ||
                  (typeof assignedTrainer === "string" ? assignedTrainer : "")
                }
                disabled={!canManage || update.isPending}
                onChange={(event) =>
                  update.mutate({
                    url: path,
                    method: "PATCH",
                    body: { assignedTrainerId: event.target.value || null },
                  })
                }
              >
                <option value="">Unassigned</option>
                {trainers.data?.data
                  .filter((trainer) => trainer.status === "ACTIVE")
                  .map((trainer) => (
                    <option key={trainer._id} value={trainer._id}>
                      {trainer.name}
                    </option>
                  ))}
              </select>
              {canManageAccess && member.status !== "ARCHIVED" && (
                <button
                  className="btn btn-secondary"
                  style={{ marginTop: 16, width: "auto", flexShrink: 0 }}
                  onClick={() => setAction("archive")}
                >
                  Archive member
                </button>
              )}
            </div>
          </label>
          {trainers.isError && <p role="alert">{trainers.error.message}</p>}

          {update.isError && !action && (
            <p role="alert">{update.error.message}</p>
          )}
        </section>
        <section className="panel">
          <h2>Assigned trainer</h2>
          {assignedTrainer && typeof assignedTrainer === "object" ? (
            <>
              <div className="member-identity">
                <Avatar
                  name={assignedTrainer.name}
                  src={assignedTrainer.photoUrl}
                  thumbnailSrc={assignedTrainer.photoThumbnailUrl}
                  size={44}
                />
                <div>
                  <strong>{assignedTrainer.name}</strong>
                  <small>
                    {assignedTrainer.specializations?.join(", ") ||
                      "General fitness"}
                  </small>
                </div>
              </div>
              <dl className="member-summary-grid">
                <div>
                  <dt>Phone</dt>
                  <dd>
                    {assignedTrainer.phone ||
                      assignedTrainer.userId?.phone ||
                      "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>
                    {assignedTrainer.email ||
                      assignedTrainer.userId?.email ||
                      "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt>Assigned</dt>
                  <dd>{gymDate(member.trainerAssignedAt, timezone)}</dd>
                </div>
                <div>
                  <dt>Status</dt>
                  <dd>
                    <StatusBadge status={assignedTrainer.status} />
                  </dd>
                </div>
                <div>
                  <dt>Qualifications</dt>
                  <dd>
                    {assignedTrainer.qualifications?.join(", ") ||
                      "Not provided"}
                  </dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>
                    {assignedTrainer.availability?.length
                      ? assignedTrainer.availability.map(
                          (slot: MemberRow, index: number) => (
                            <div key={index}>
                              {
                                [
                                  "Sun",
                                  "Mon",
                                  "Tue",
                                  "Wed",
                                  "Thu",
                                  "Fri",
                                  "Sat",
                                ][slot.day]
                              }{" "}
                              {slot.from}–{slot.to}
                            </div>
                          ),
                        )
                      : "Not provided"}
                  </dd>
                </div>
              </dl>
            </>
          ) : (
            <p>
              No trainer assigned. Gym management can select an active trainer
              above.
            </p>
          )}
        </section>
        {canReadFinance && (
          <section
            id="member-payments"
            className="panel member-management-scroll"
          >
            <h2>Payment history</h2>
            <p>
              Latest 50 payments. The Payments page contains the full history.
            </p>
            <table className="member-management-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Amount</th>
                  <th>Method</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {query.data?.data.payments.map((payment) => (
                  <tr key={payment.publicId}>
                    <td>
                      {gymDate(
                        payment.capturedAt || payment.createdAt,
                        timezone,
                      )}
                    </td>
                    <td>{formatMoney(payment.amountMinor)}</td>
                    <td>
                      {payment.provider} {payment.methodCategory}
                    </td>
                    <td>
                      <StatusBadge status={payment.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!query.data?.data.payments.length && (
              <p className="state-card">No payments recorded.</p>
            )}
          </section>
        )}
        <section
          id="member-attendance"
          className="panel member-management-scroll"
        >
          <h2>Recent attendance</h2>
          <table className="member-management-table">
            <thead>
              <tr>
                <th>Date and time</th>
                <th>Event</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.data.attendance.map((event) => (
                <tr key={event.publicId}>
                  <td>
                    {new Date(event.occurredAt).toLocaleString(undefined, {
                      timeZone: timezone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </td>
                  <td>{event.type}</td>
                  <td>{event.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!query.data?.data.attendance.length && (
            <p className="state-card">No attendance recorded.</p>
          )}
        </section>
        {member.ownerNotes?.length > 0 && (
          <section className="panel">
            <h2>Recent management activity</h2>
            <ul>
              {member.ownerNotes
                .slice(-5)
                .reverse()
                .map((note: MemberRow, index: number) => (
                  <li key={index}>
                    <p>{note.text}</p>
                    <small>{gymDate(note.createdAt, timezone)}</small>
                  </li>
                ))}
            </ul>
          </section>
        )}
      </div>
      {edit && (
        <MemberEditor
          member={member}
          timezone={timezone}
          onClose={() => setEdit(false)}
          onSaved={saved}
        />
      )}
      <Modal
        open={!!action}
        title={
          action === "deactivate-access"
            ? "Deactivate gym access"
            : action === "reactivate-access"
              ? "Reactivate gym access"
              : action === "archive"
                ? "Archive member"
                : action === "approve"
                  ? "Approve direct gym access"
                  : action === "reject"
                    ? "Reject join request"
                    : action === "reactivate"
                      ? "Reactivate membership"
                      : action === "freeze"
                        ? "Freeze membership"
                        : "Deactivate membership"
        }
        onClose={() => {
          if (!update.isPending) setAction("");
        }}
      >
        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            perform();
          }}
        >
          <p>
            {action === "archive"
              ? "Gym access ends and current memberships are cancelled. Payment and attendance history remain available. This does not issue a refund."
              : action === "reactivate"
                ? subscription?.status === "FROZEN"
                  ? "Unused freeze days are returned and membership dates are recalculated."
                  : "Restore eligible remaining paid access. Expired, refunded or replaced memberships cannot be reactivated. This does not extend the membership."
                : action === "approve"
                  ? "Grant attendance access without creating a paid plan. This is available only while this gym has no active plans."
                  : "Confirm this change to the member's gym access."}
          </p>
          {action === "freeze" && (
            <label className="field">
              <span>Freeze days</span>
              <input
                className="input"
                type="number"
                min={1}
                max={90}
                required
                value={days}
                onChange={(e) => setDays(Number(e.target.value))}
              />
            </label>
          )}
          {!["approve", "reject"].includes(action) && (
            <label className="field">
              <span>Reason</span>
              <textarea
                className="textarea"
                required
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          {update.isError && <p role="alert">{update.error.message}</p>}
          <button className="btn btn-primary" disabled={update.isPending}>
            {update.isPending ? "Saving..." : "Confirm"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
