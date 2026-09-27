import { useState } from "react";
import { useCurrentUser } from "../../api/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { StatusBadge } from "../../components/StatusBadge";
import { Modal } from "../../components/Modal";
import {
  MemberEditor,
  memberName,
  formatMoney,
  type MemberRow,
} from "./OwnerMembersPage";

export function OwnerMemberDetailsPage({ id }: { id: string }) {
  const session = useCurrentUser();
  const canManage =
    session.data?.data.context.permissions.includes("member:write");
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
        }>
      >(path),
    retry: false,
  });
  const trainers = useQuery({
    queryKey: ["api", "/api/v1/owner/trainers"],
    queryFn: () =>
      apiRequest<ApiEnvelope<MemberRow[]>>("/api/v1/owner/trainers"),
  });
  const [edit, setEdit] = useState(false),
    [action, setAction] = useState(""),
    [reason, setReason] = useState(""),
    [days, setDays] = useState(1);
  const member = query.data?.data.member,
    subscription = member?.currentSubscriptionId;
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
    if (action === "archive")
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
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Member details</span>
          <h1>{memberName(member)}</h1>
          <p>{member.memberCode}</p>
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
      </header>
      <section className="panel">
        <dl className="member-summary-grid">
          {(member.contact?.avatarUrl || member.userId?.avatarUrl) && (
            <div>
              <img
                className="member-management-avatar"
                src={member.contact?.avatarUrl || member.userId?.avatarUrl}
                alt="Member profile"
              />
            </div>
          )}
          <div>
            <dt>Email</dt>
            <dd>
              {member.contact?.email || member.userId?.email || "Not provided"}
            </dd>
          </div>
          <div>
            <dt>Phone</dt>
            <dd>
              {member.contact?.phone || member.userId?.phone || "Not provided"}
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
      <section className="panel" style={{ padding: 24 }}>
        <h2>Gym access and membership</h2>
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
                    ? new Date(subscription.startsAt).toLocaleDateString()
                    : "Pending"}
                </dd>
              </div>
              <div>
                <dt>End date</dt>
                <dd>
                  {subscription.endsAt
                    ? new Date(subscription.endsAt).toLocaleDateString()
                    : "Pending"}
                </dd>
              </div>
            </dl>
            <div className="heading-actions">
              {canManage &&
                subscription.status === "ACTIVE" &&
                Number(subscription.planSnapshot?.freezeDaysAllowed) > 0 && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAction("freeze")}
                  >
                    Freeze
                  </button>
                )}
              {canManage &&
                ["FROZEN", "GRACE"].includes(subscription.status) && (
                  <button
                    className="btn btn-primary"
                    onClick={() => setAction("reactivate")}
                  >
                    Reactivate
                  </button>
                )}
              {canManage &&
                ["ACTIVE", "FROZEN", "GRACE"].includes(subscription.status) && (
                  <button
                    className="btn btn-secondary"
                    onClick={() => setAction("deactivate")}
                  >
                    Deactivate membership
                  </button>
                )}
            </div>
          </>
        ) : (
          <p>
            {member.directAccess
              ? "Direct gym access approved without a paid membership plan."
              : "No paid membership has been created."}
          </p>
        )}
        {canManage && member.status === "JOIN_REQUESTED" && (
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
          <select
            className="select"
            value={member.assignedTrainerId || ""}
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
        </label>
        {trainers.isError && <p role="alert">{trainers.error.message}</p>}
        {canManage && member.status !== "ARCHIVED" && (
          <button
            className="btn btn-secondary"
            style={{ marginTop: 16 }}
            onClick={() => setAction("archive")}
          >
            Archive member
          </button>
        )}
        {update.isError && !action && (
          <p role="alert">{update.error.message}</p>
        )}
      </section>
      <section className="panel member-management-scroll">
        <h2 style={{ padding: 20 }}>Payment history</h2>
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
                  {new Date(
                    payment.capturedAt || payment.createdAt,
                  ).toLocaleDateString()}
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
      <section className="panel member-management-scroll">
        <h2 style={{ padding: 20 }}>Recent attendance</h2>
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
                <td>{new Date(event.occurredAt).toLocaleString()}</td>
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
      {edit && (
        <MemberEditor
          member={member}
          onClose={() => setEdit(false)}
          onSaved={saved}
        />
      )}
      <Modal
        open={!!action}
        title={
          action === "archive"
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
                ? "Unused freeze days are returned and membership dates are recalculated."
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
