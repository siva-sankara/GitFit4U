import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import { useCurrentUser } from "../../api/hooks";
import { Avatar } from "../../components/Avatar";
import { MediaImageEditor } from "../../components/MediaImageEditor";
import { addCalendarDays, gymCalendarDate } from "../../services/gymCalendar";
import {
  gymDate,
  MembershipStatusDot,
  membershipPresentation,
} from "../../components/MembershipStatusDot";
import "../../styles/member-management.css";
import { MemberQuickActions } from "../../components/MemberQuickActions";
import { MemberInvitationStatus } from "../../components/MemberInvitationStatus";
import { navigationSessionScope, useMemberListState } from "../../services/navigationSession";

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
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  uploadGymId,
}: {
  member?: MemberRow;
  onSaved: () => void;
  onClose: () => void;
  endpoint?: string;
  plansEndpoint?: string;
  timezone?: string;
  uploadGymId?: string;
}) {
  const edit = !!member;
  const [planId, setPlanId] = useState("");
  const [photo, setPhoto] = useState<{ id: string | null; url?: string }>();
  const [imageBusy, setImageBusy] = useState(false);
  const today = gymCalendarDate(new Date(), timezone);
  const [startsAt, setStartsAt] = useState(
    today,
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
      ? gymDate(addCalendarDays(startsAt, plan.durationDays) + "T00:00:00Z", "UTC")
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
    if (imageBusy || save.isPending) return;
    const form = new FormData(event.currentTarget),
      text = (name: string) => String(form.get(name) || "").trim();
    const emergencyName = text("emergencyName"),
      emergencyPhone = text("emergencyPhone");
    save.mutate({
      name: text("name"),
      ...(text("email") ? { email: text("email") } : {}),
      ...(text("phone") ? { phone: text("phone") } : {}),
      ...(photo ? { avatarAttachmentId: photo.id } : {}),
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
            startsAt,
            payment: {
              amountMinor: totalMinor,
              method: text("method"),
              paidAt: text("paidAt"),
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
        if (!save.isPending && !imageBusy) onClose();
      }}
      wide
    >
      <form className="modal-form member-management-form" onSubmit={submit}>
        <p className="full-width">
          {edit
            ? "These details are stored in this gym's member record. Account sign-in details remain managed by the member."
            : "The selected plan, membership and offline receipt are saved together. New members receive an email to set their own password; existing members sign in and accept a secure gym invitation."}
        </p>
        {(
          [
            ["name", "Full name", "text"],
            ["email", "Email", "email"],
            ["phone", "Phone number", "tel"],
            ["fitnessGoal", "Fitness goal", "text"],
          ] as const
        ).map(([key, label, type]) => (
          <label className="field" key={key}>
            <span>{label}</span>
            <input
              className="input"
              name={key}
              type={type}
              required={key === "name" || (!edit && key === "email")}
              maxLength={200}
              defaultValue={
                member?.contact?.[key] ||
                member?.userId?.[key] ||
                member?.[key] ||
                ""
              }
            />
          </label>
        ))}
        {(endpoint.startsWith("/api/v1/owner/") || uploadGymId) && <div className="full-width">
          <MediaImageEditor purpose="MEMBER_AVATAR" label="Gym member photo" gymId={uploadGymId}
            previewUrl={photo === undefined ? member?.contact?.avatarUrl : photo.url}
            onChange={(id, url) => setPhoto({ id, url })} onBusyChange={setImageBusy} />
          <small>This recognition photo belongs to this gym; it does not change the member's account photo.</small>
        </div>}
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
                defaultValue={today}
                max={today}
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
            disabled={save.isPending || imageBusy || (!edit && !plan)}
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
            disabled={save.isPending || imageBusy}
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
  const listScope = navigationSessionScope(session.data?.data.context);
  const [{ page, search, status, planId, trainerId }, setList] = useMemberListState(listScope);
  const [debounced, setDebounced] = useState({ scope: listScope, search });
  const debouncedSearch = debounced.scope === listScope ? debounced.search : search;
  const [create, setCreate] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced({ scope: listScope, search }), 300);
    return () => window.clearTimeout(timer);
  }, [search, listScope]);
  const plans = useQuery({
    queryKey: ["api", "/api/v1/owner/plans"],
    enabled: session.data?.data.context.permissions.includes("gym:read"),
    queryFn: () => apiRequest<ApiEnvelope<MemberRow[]>>("/api/v1/owner/plans"),
  });
  const trainers = useQuery({
    queryKey: ["api", "/api/v1/owner/trainers"],
    enabled: session.data?.data.context.permissions.includes("gym:read"),
    queryFn: () =>
      apiRequest<ApiEnvelope<MemberRow[]>>("/api/v1/owner/trainers"),
  });
  const client = useQueryClient(),
    navigate = useNavigate();
  const path =
    "/api/v1/owner/members?" +
    new URLSearchParams({
      page: String(page),
      limit: "20",
      q: debouncedSearch,
      status: status === "JOIN_REQUESTED" ? status : "",
      membershipStatus: status === "JOIN_REQUESTED" ? "" : status,
      planId,
      trainerId,
    });
  const query = useQuery({
    queryKey: ["api", path],
    queryFn: () => apiRequest<ApiEnvelope<MemberRow[]>>(path),
    retry: false,
  });
  const timezone = query.data?.meta?.timezone || "Asia/Kolkata";
  const now = query.data?.meta?.serverNow
    ? new Date(query.data.meta.serverNow)
    : new Date();
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Gym operations</span>
          <h1>Members</h1>
          <p>Manage member details, memberships and join requests.</p>
        </div>
        {canManage && (
          <button className="btn btn-primary" disabled={query.isPending || query.isError} onClick={() => setCreate(true)}>
            Create member
          </button>
        )}
      </header>
      <div className="panel member-filter-toolbar">
        <label className="search-field">
          <span className="sr-only">Search members</span>
          <input
            placeholder="Search name, phone or member code"
            value={search}
            onChange={(e) => {
              setList({ search: e.target.value, page: 1 });
            }}
          />
        </label>
        <select
          className="select"
          aria-label="Membership status"
          value={status}
          onChange={(e) => {
            setList({ status: e.target.value, page: 1 });
          }}
        >
          <option value="">All statuses</option>
          {[
            "JOIN_REQUESTED",
            "ACTIVE",
            "EXPIRING",
            "FROZEN",
            "EXPIRED",
            "CANCELLED",
            "DEACTIVATED",
            "GRACE",
            "PENDING_PAYMENT",
            "NONE",
          ].map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Membership plan"
          value={planId}
          onChange={(event) => {
            setList({ planId: event.target.value, page: 1 });
          }}
        >
          <option value="">All plans</option>
          {plans.data?.data.map((plan) => (
            <option key={plan.publicId} value={plan.publicId}>
              {plan.name}
            </option>
          ))}
        </select>
        <select
          className="select"
          aria-label="Assigned trainer"
          value={trainerId}
          onChange={(event) => {
            setList({ trainerId: event.target.value, page: 1 });
          }}
        >
          <option value="">All trainers</option>
          <option value="none">Not assigned</option>
          {trainers.data?.data.map((trainer) => (
            <option key={trainer._id} value={trainer._id}>
              {trainer.name}
            </option>
          ))}
        </select>
      </div>
      {(plans.isError || trainers.isError) && (
        <p role="alert">
          Some filter options could not load.{" "}
          {plans.error?.message || trainers.error?.message}
        </p>
      )}
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
                <th>Membership</th>
                <th>Expires</th>
                <th>Visits (30 days)</th>
                {canReadFinance && <th>Payment</th>}
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.data.map((row) => (
                <tr
                  key={row.publicId}
                  className={
                    membershipPresentation(row, timezone, now).state ===
                    "EXPIRING"
                      ? "member-expiring-row"
                      : undefined
                  }
                  onDoubleClick={() =>
                    navigate("/owner/members/" + row.publicId)
                  }
                >
                  <td>
                    <div className="member-identity">
                      <Avatar
                        name={memberName(row)}
                        src={row.contact?.avatarUrl || row.userId?.avatarUrl}
                        thumbnailSrc={row.contact?.avatarThumbnailUrl || (!row.contact?.avatarUrl ? row.userId?.avatarThumbnailUrl : undefined)}
                      />
                      <strong>{memberName(row)}</strong>
                    </div>
                    <MemberInvitationStatus member={row} canManage={canManage} />
                    <small>
                      Trainer: {row.assignedTrainerId?.name || "Not assigned"}
                    </small>
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
                    <div className="member-plan-status">
                      <span>
                        {membershipPresentation(row, timezone, now).plan}
                      </span>
                      <MembershipStatusDot
                        member={row}
                        timezone={timezone}
                        now={now}
                      />
                    </div>
                  </td>
                  <td>
                    {gymDate(row.currentSubscriptionId?.endsAt, timezone)}
                    {membershipPresentation(row, timezone, now).state ===
                      "EXPIRING" && (
                      <small>
                        {membershipPresentation(row, timezone, now)
                          .daysRemaining === 0
                          ? "Expires today"
                          : `Expires in ${membershipPresentation(row, timezone, now).daysRemaining} days`}
                      </small>
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
                  <td>{gymDate(row.joinedAt, timezone)}</td>
                  <td><MemberQuickActions member={row} /></td>
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
          <button disabled={page <= 1} onClick={() => setList({ page: page - 1 })}>
            Previous
          </button>
          <span>Page {page}</span>
          <button
            disabled={page >= (query.data?.meta?.pages || 1)}
            onClick={() => setList({ page: page + 1 })}
          >
            Next
          </button>
        </div>
      </footer>
      {create && (
        <MemberEditor
          timezone={timezone}
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
