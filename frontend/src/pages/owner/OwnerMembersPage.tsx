import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import { useCurrentUser } from "../../api/hooks";
import "../../styles/member-management.css";

export type MemberRow = Record<string, any>;
export const memberName = (row: MemberRow) =>
  row.contact?.name || row.userId?.name || "Member";
export const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    (amount || 0) / 100,
  );
export function MemberEditor({
  member,
  onSaved,
  onClose,
  endpoint = "/api/v1/owner/members",
  plansEndpoint = "/api/v1/owner/plans",
}: {
  member?: MemberRow;
  onSaved: () => void;
  onClose: () => void;
  endpoint?: string;
  plansEndpoint?: string;
}) {
  const edit = !!member;
  const [planId, setPlanId] = useState("");
  const [startsAt, setStartsAt] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const plans = useQuery({
    queryKey: ["api", plansEndpoint],
    queryFn: () => apiRequest<ApiEnvelope<MemberRow[]>>(plansEndpoint),
    enabled: !edit,
  });
  const activePlans = (plans.data?.data || []).filter(
    (plan) => plan.status === "ACTIVE",
  );
  const plan = activePlans.find((plan) => plan.publicId === planId);
  const discounted = plan
    ? plan.priceMinor - Math.min(plan.discountMinor || 0, plan.priceMinor)
    : 0;
  const totalMinor =
    discounted +
    Math.round((discounted * (plan?.taxRateBasisPoints || 0)) / 10000);
  const end =
    plan && startsAt
      ? new Date(
          new Date(startsAt).getTime() + plan.durationDays * 86400000,
        ).toLocaleDateString()
      : "Select a plan";
  const save = useMutation({
    mutationFn: (body: object) =>
      apiRequest(endpoint + (edit ? "/" + member.publicId : ""), {
        method: edit ? "PATCH" : "POST",
        body: JSON.stringify(body),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: onSaved,
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      text = (name: string) => String(form.get(name) || "").trim();
    const emergencyName = text("emergencyName"),
      emergencyPhone = text("emergencyPhone");
    save.mutate({
      name: text("name"),
      ...(text("email") ? { email: text("email") } : {}),
      ...(text("phone") ? { phone: text("phone") } : {}),
      ...(text("avatarUrl") ? { avatarUrl: text("avatarUrl") } : {}),
      fitnessGoal: text("fitnessGoal"),
      medicalNotes: text("medicalNotes"),
      ...(emergencyName && emergencyPhone
        ? {
            emergencyContact: {
              name: emergencyName,
              phone: emergencyPhone,
              relationship: text("relationship"),
            },
          }
        : {}),
      ...(!edit
        ? {
            planId,
            startsAt: new Date(startsAt).toISOString(),
            payment: {
              amountMinor: totalMinor,
              method: text("method"),
              paidAt: new Date(text("paidAt")).toISOString(),
              reference: text("reference"),
              notes: text("notes"),
            },
          }
        : {}),
    });
  }
  return (
    <Modal
      open
      title={edit ? "Edit gym member" : "Create member and membership"}
      onClose={() => {
        if (!save.isPending) onClose();
      }}
      wide
    >
      <form className="modal-form member-management-form" onSubmit={submit}>
        <p className="full-width">
          {edit
            ? "These details are stored in this gym's member record. Account sign-in details remain managed by the member."
            : "The selected plan, membership and offline receipt are saved together. New members verify their phone with an OTP to access their account."}
        </p>
        {(
          [
            ["name", "Full name", "text"],
            ["email", "Email", "email"],
            ["phone", "Phone number", "tel"],
            ["avatarUrl", "Profile image URL", "url"],
            ["fitnessGoal", "Fitness goal", "text"],
          ] as const
        ).map(([key, label, type]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              className="input"
              name={key}
              type={type}
              required={key === "name" || (!edit && key === "phone")}
              maxLength={key === "avatarUrl" ? 2000 : 200}
              defaultValue={
                member?.contact?.[key] ||
                member?.userId?.[key] ||
                member?.[key] ||
                ""
              }
            />
          </label>
        ))}
        <label className="field">
          <span>Emergency contact name</span>
          <input
            className="input"
            name="emergencyName"
            defaultValue={member?.emergencyContact?.name}
          />
        </label>
        <label className="field">
          <span>Emergency phone</span>
          <input
            className="input"
            name="emergencyPhone"
            type="tel"
            defaultValue={member?.emergencyContact?.phone}
          />
        </label>
        <label className="field">
          <span>Relationship</span>
          <input
            className="input"
            name="relationship"
            defaultValue={member?.emergencyContact?.relationship}
          />
        </label>
        <label className="field full-width">
          <span>Medical information (private to gym management)</span>
          <textarea
            className="textarea"
            name="medicalNotes"
            maxLength={2000}
            defaultValue={member?.medicalNotes}
          />
        </label>
        {!edit && (
          <>
            <label className="field">
              <span>Membership plan</span>
              <select
                className="select"
                required
                value={planId}
                onChange={(e) => setPlanId(e.target.value)}
              >
                <option value="">Select an active gym plan</option>
                {activePlans.map((plan) => (
                  <option key={plan.publicId} value={plan.publicId}>
                    {plan.name} ({plan.durationDays} days)
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Start date</span>
              <input
                className="input"
                type="date"
                required
                value={startsAt}
                onChange={(e) => setStartsAt(e.target.value)}
              />
            </label>
            <p className="full-width">
              Membership ends: <strong>{end}</strong> · Offline amount:{" "}
              <strong>{formatMoney(totalMinor)}</strong>
            </p>
            <label className="field">
              <span>Offline payment method</span>
              <select className="select" name="method">
                {["CASH", "UPI", "CARD_POS", "BANK_TRANSFER", "OTHER"].map(
                  (value) => (
                    <option key={value}>{value}</option>
                  ),
                )}
              </select>
            </label>
            <label className="field">
              <span>Payment date</span>
              <input
                className="input"
                name="paidAt"
                type="date"
                required
                defaultValue={new Date().toISOString().slice(0, 10)}
                max={new Date().toISOString().slice(0, 10)}
              />
            </label>
            <label className="field">
              <span>Transaction/reference number</span>
              <input className="input" name="reference" maxLength={120} />
            </label>
            <label className="field">
              <span>Payment notes</span>
              <input className="input" name="notes" maxLength={1000} />
            </label>
            {plans.isError && (
              <p className="form-alert full-width" role="alert">
                {plans.error.message}
              </p>
            )}
            {!plans.isPending && !activePlans.length && (
              <p className="full-width">
                Create an active membership plan before recording a paid
                membership. Plan-free join requests can be approved from member
                details.
              </p>
            )}
          </>
        )}
        {save.isError && (
          <p className="form-alert full-width" role="alert">
            {save.error.message}
          </p>
        )}
        <div className="heading-actions full-width">
          <button
            className="btn btn-primary"
            disabled={save.isPending || (!edit && !plan)}
          >
            {save.isPending
              ? "Saving..."
              : edit
                ? "Save member"
                : "Create membership and record payment"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={save.isPending}
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}
export function OwnerMembersPage() {
  const session = useCurrentUser();
  const canReadFinance =
    session.data?.data.context.permissions.includes("finance:read");
  const canManage =
    session.data?.data.context.permissions.includes("member:write");
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [create, setCreate] = useState(false);
  const client = useQueryClient(),
    navigate = useNavigate();
  const path =
    "/api/v1/owner/members?" +
    new URLSearchParams({ page: String(page), limit: "20", q: search, status });
  const query = useQuery({
    queryKey: ["api", path],
    queryFn: () => apiRequest<ApiEnvelope<MemberRow[]>>(path),
    retry: false,
  });
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Gym operations</span>
          <h1>Members</h1>
          <p>Manage member details, memberships and join requests.</p>
        </div>
        {canManage && (
          <button className="btn btn-primary" onClick={() => setCreate(true)}>
            Create member
          </button>
        )}
      </header>
      <div className="panel heading-actions" style={{ padding: 16 }}>
        <label className="search-field">
          <span className="sr-only">Search members</span>
          <input
            placeholder="Search name, phone or member code"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <select
          className="select"
          aria-label="Member status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">All statuses</option>
          {[
            "JOIN_REQUESTED",
            "ACTIVE",
            "INACTIVE",
            "SUSPENDED",
            "ARCHIVED",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
      </div>
      {query.isPending ? (
        <p role="status">Loading members...</p>
      ) : query.isError ? (
        <div role="alert" className="panel state-card">
          <p>{query.error.message}</p>
          <button
            className="btn btn-secondary"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      ) : (
        <section className="panel member-management-scroll">
          <table className="member-management-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Member code</th>
                <th>Phone</th>
                <th>Plan</th>
                <th>Expires</th>
                <th>Membership</th>
                <th>Visits (30 days)</th>
                {canReadFinance && <th>Payment</th>}
                <th>Joined</th>
                <th>Member status</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.data.map((row) => (
                <tr
                  key={row.publicId}
                  onDoubleClick={() =>
                    navigate("/owner/members/" + row.publicId)
                  }
                >
                  <td>
                    <strong>{memberName(row)}</strong>
                    <small>
                      <Link to={"/owner/members/" + row.publicId}>
                        {canManage ? "View / Edit" : "View"}
                      </Link>
                    </small>
                  </td>
                  <td>{row.memberCode}</td>
                  <td>
                    {row.contact?.phone || row.userId?.phone || "Not provided"}
                    <small>{row.contact?.email || row.userId?.email}</small>
                  </td>
                  <td>
                    {row.currentSubscriptionId?.planSnapshot?.name ||
                      (row.directAccess
                        ? "Approved direct access"
                        : "No membership")}
                  </td>
                  <td>
                    {row.currentSubscriptionId?.endsAt
                      ? new Date(
                          row.currentSubscriptionId.endsAt,
                        ).toLocaleDateString()
                      : "Not started"}
                  </td>
                  <td>
                    {row.currentSubscriptionId?.status ? (
                      <StatusBadge status={row.currentSubscriptionId.status} />
                    ) : row.directAccess ? (
                      "Direct access"
                    ) : (
                      "Not enrolled"
                    )}
                  </td>
                  <td>{row.attendanceVisits30Days || 0}</td>
                  {canReadFinance && (
                    <td>
                      {row.currentSubscriptionId?.latestPaymentId?.status ? (
                        <StatusBadge
                          status={
                            row.currentSubscriptionId.latestPaymentId.status
                          }
                        />
                      ) : (
                        "No payment"
                      )}
                    </td>
                  )}
                  <td>
                    {row.joinedAt
                      ? new Date(row.joinedAt).toLocaleDateString()
                      : "Not recorded"}
                  </td>
                  <td>
                    <StatusBadge status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!query.data?.data.length && (
            <p className="state-card">No members match your filters.</p>
          )}
        </section>
      )}
      <footer className="table-footer panel">
        <span>{query.data?.meta?.total || 0} members</span>
        <div>
          <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={page >= (query.data?.meta?.pages || 1)}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </footer>
      {create && (
        <MemberEditor
          onClose={() => setCreate(false)}
          onSaved={() => {
            setCreate(false);
            void client.invalidateQueries({ queryKey: ["api"] });
          }}
        />
      )}
    </div>
  );
}
