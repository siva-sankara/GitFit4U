import { PageHeader } from "../../components/PageHeader";
import { CompactFilters } from "../../components/CompactFilters";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { apiFileDownload, apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { PhoneInput } from "../../components/PhoneInput";
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
import { MemberWhatsAppReminderAction } from "../../components/MemberWhatsAppReminderAction";
import { MemberMoreActions } from "../../components/MemberMoreActions";
import { navigationSessionScope, useMemberListState } from "../../services/navigationSession";
import { BulkActionBar, Pagination, SkeletonTableRows } from "../../components/DataListControls";
import { ImportMembersModal } from "../../components/ImportMembersModal";
import {
  CreditCard,
  Mail,
  Phone,
  Search,
  UserCheck,
  UserPlus,
  Users,
  Clock3,
  Bell,
  Download,
  FileSpreadsheet,
  UserCog,
} from "lucide-react";

export type MemberRow = Record<string, any>;
type MemberSummary = {
  total: number;
  active: number;
  pendingActivation: number;
  paymentDue: number | null;
};
type MemberListEnvelope = ApiEnvelope<MemberRow[]> & {
  meta?: NonNullable<ApiEnvelope<MemberRow[]>["meta"]> & {
    summary?: MemberSummary;
  };
};
export const memberName = (row: MemberRow) =>
  row.contact?.name || row.userId?.name || "Member";
export const formatMoney = (amount: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    (amount || 0) / 100,
  );
function MemberMetric({
  icon,
  label,
  value,
  detail,
  tone,
}: {
  icon: ReactNode;
  label: string;
  value: number | string;
  detail: string;
  tone: "neutral" | "success" | "warning" | "danger";
}) {
  return (
    <article className={`member-metric member-metric--${tone}`}>
      <span className="member-metric-icon" aria-hidden="true">
        {icon}
      </span>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
    </article>
  );
}
export function MemberEditor({
  member,
  onSaved,
  onClose,
  endpoint = "/api/v1/owner/members",
  plansEndpoint = "/api/v1/owner/plans?limit=100",
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
    if (!event.currentTarget.reportValidity()) return;
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
            {key === "phone" ? <PhoneInput name={key}
              defaultValue={member?.contact?.phone || member?.userId?.phone || member?.phone || ""} /> : <input
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
            />}
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
          <PhoneInput
            className="input"
            name="emergencyPhone"
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
  const [
    { page, limit, search, status, planId, trainerId, paymentStatus, sort },
    setList,
  ] = useMemberListState(listScope);
  const [debounced, setDebounced] = useState({ scope: listScope, search });
  const debouncedSearch = debounced.scope === listScope ? debounced.search : search;
  const [create, setCreate] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [bulkAction, setBulkAction] = useState<"trainer" | "notification" | null>(null);
  const [bulkError, setBulkError] = useState("");
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const selectAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced({ scope: listScope, search }), 300);
    return () => window.clearTimeout(timer);
  }, [search, listScope]);
  const plans = useQuery({
    queryKey: ["api", "/api/v1/owner/plans?limit=100"],
    enabled: session.data?.data.context.permissions.includes("gym:read"),
    queryFn: () => apiRequest<ApiEnvelope<MemberRow[]>>("/api/v1/owner/plans?limit=100"),
  });
  const trainers = useQuery({
    queryKey: ["api", "/api/v1/owner/trainers?limit=100"],
    enabled: session.data?.data.context.permissions.includes("gym:read"),
    queryFn: () =>
      apiRequest<ApiEnvelope<MemberRow[]>>("/api/v1/owner/trainers?limit=100"),
  });
  const client = useQueryClient(),
    navigate = useNavigate();
  const path =
    "/api/v1/owner/members?" +
    new URLSearchParams({
      page: String(page),
      limit: String(limit),
      q: debouncedSearch,
      status: status === "JOIN_REQUESTED" ? status : "",
      membershipStatus: status === "JOIN_REQUESTED" ? "" : status,
      planId,
      trainerId,
      paymentStatus: canReadFinance ? paymentStatus : "",
      sort,
    });
  const query = useQuery({
    queryKey: ["api", path],
    queryFn: () => apiRequest<MemberListEnvelope>(path),
    retry: false,
  });
  const timezone = query.data?.meta?.timezone || "Asia/Kolkata";
  const now = query.data?.meta?.serverNow
    ? new Date(query.data.meta.serverNow)
    : new Date();
  const summary = query.data?.meta?.summary;
  const rows = query.data?.data || [];
  const selectedOnPage = rows.filter((row) => selectedIds.has(row.publicId)).length;
  const allOnPageSelected = rows.length > 0 && selectedOnPage === rows.length;
  useEffect(() => {
    setSelectedIds(new Set());
  }, [path]);
  useEffect(() => {
    if (selectAllRef.current)
      selectAllRef.current.indeterminate = selectedOnPage > 0 && !allOnPageSelected;
  }, [allOnPageSelected, selectedOnPage]);
  const toggleMember = (id: string) =>
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const togglePage = () =>
    setSelectedIds(
      allOnPageSelected ? new Set() : new Set(rows.map((row) => row.publicId)),
    );
  const saveDownload = (blob: Blob, extension: "csv" | "xlsx") => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `getfit4u-members-${new Date().toISOString().slice(0, 10)}.${extension}`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const downloadMembers = async (
    format: "csv" | "xlsx",
    scope: "selected" | "filtered",
  ) => {
    setDownloadBusy(true);
    setBulkError("");
    try {
      const blob = await apiFileDownload("/api/v1/owner/members/export", {
        method: "POST",
        body: JSON.stringify({
          memberIds: [...selectedIds],
          format,
          scope,
          filters: {
            q: debouncedSearch || undefined,
            status: status === "JOIN_REQUESTED" ? status : undefined,
            trainerId: trainerId || undefined,
          },
        }),
      });
      saveDownload(blob, format);
    } catch (failure: any) {
      setBulkError(failure.message);
    } finally {
      setDownloadBusy(false);
    }
  };
  const bulkMutation = useMutation({
    mutationFn: ({ endpoint, body }: { endpoint: string; body: Record<string, unknown> }) =>
      apiRequest(endpoint, {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setBulkAction(null);
      setSelectedIds(new Set());
      await client.invalidateQueries({ queryKey: ["api"] });
    },
    onError: (failure) => setBulkError(failure.message),
  });
  return (
    <div className="page-stack owner-members-page">
      <PageHeader>
        <div>
          <h1>Members</h1>
          <p>Manage your gym members, their plans, payments and access.</p>
        </div>
        <div className="heading-actions">
          <button type="button" className="btn btn-secondary" disabled={downloadBusy || query.isPending || query.isError} onClick={() => void downloadMembers("xlsx", "filtered")}><Download size={18} aria-hidden="true" />Download filtered</button>
          {canManage && <button type="button" className="btn btn-secondary" disabled={query.isPending || query.isError} onClick={() => setImportOpen(true)}><FileSpreadsheet size={18} aria-hidden="true" />Import Members</button>}
          {canManage && <button type="button" className="btn btn-primary" disabled={query.isPending || query.isError} onClick={() => setCreate(true)}><UserPlus size={19} aria-hidden="true" />Add Member</button>}
        </div>
      </PageHeader>
      <section className="member-metrics" aria-label="Member summary">
        <MemberMetric
          icon={<Users size={26} />}
          label="Total Members"
          value={summary?.total ?? "—"}
          detail="All registered members"
          tone="neutral"
        />
        <MemberMetric
          icon={<UserCheck size={26} />}
          label="Active Members"
          value={summary?.active ?? "—"}
          detail="With active access"
          tone="success"
        />
        <MemberMetric
          icon={<Clock3 size={26} />}
          label="Pending Activation"
          value={summary?.pendingActivation ?? "—"}
          detail="Invitations not accepted"
          tone="warning"
        />
        {canReadFinance && (
          <MemberMetric
            icon={<CreditCard size={26} />}
            label="Payment Due"
            value={summary?.paymentDue ?? "—"}
            detail="Members with pending payment"
            tone="danger"
          />
        )}
      </section>
      <div className="panel member-filter-toolbar">
        <label className="search-field member-search-field">
          <span className="sr-only">Search members</span>
          <Search size={20} aria-hidden="true" />
          <input
            placeholder="Search members by name, phone, email or ID…"
            value={search}
            onChange={(e) => {
              setList({ search: e.target.value, page: 1 });
            }}
          />
        </label>
        <CompactFilters
          activeCount={[
            status,
            planId,
            trainerId,
            canReadFinance ? paymentStatus : "",
            sort !== "JOINED_DESC" ? sort : "",
          ].filter(Boolean).length}
          onReset={() => setList({ status: "", planId: "", trainerId: "", paymentStatus: "", sort: "JOINED_DESC", page: 1 })}
        >
        <label>
          <span>Status</span>
          <select
            className="select"
            aria-label="Membership status"
            value={status}
            onChange={(e) => setList({ status: e.target.value, page: 1 })}
          >
            <option value="">All</option>
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
            ].map((value) => (
              <option key={value} value={value}>
                {value.toLowerCase().replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Plan</span>
          <select
            className="select"
            aria-label="Membership plan"
            value={planId}
            onChange={(event) => setList({ planId: event.target.value, page: 1 })}
          >
            <option value="">All</option>
            {plans.data?.data.map((plan) => (
              <option key={plan.publicId} value={plan.publicId}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Trainer</span>
          <select
            className="select"
            aria-label="Assigned trainer"
            value={trainerId}
            onChange={(event) => setList({ trainerId: event.target.value, page: 1 })}
          >
            <option value="">All</option>
            <option value="none">Not assigned</option>
            {trainers.data?.data.map((trainer) => (
              <option key={trainer._id} value={trainer._id}>
                {trainer.name}
              </option>
            ))}
          </select>
        </label>
        {canReadFinance && (
          <label>
            <span>Payment</span>
            <select
              className="select"
              aria-label="Payment status"
              value={paymentStatus}
              onChange={(event) => setList({ paymentStatus: event.target.value, page: 1 })}
            >
              <option value="">All</option>
              <option value="CAPTURED">Captured</option>
              <option value="DUE">Due / pending</option>
              <option value="FAILED">Failed</option>
              <option value="NONE">No payment</option>
            </select>
          </label>
        )}
        <label>
          <span>Sort by</span>
          <select
            className="select"
            aria-label="Sort members"
            value={sort}
            onChange={(event) => setList({ sort: event.target.value, page: 1 })}
          >
            <option value="JOINED_DESC">Join date (newest)</option>
            <option value="JOINED_ASC">Join date (oldest)</option>
            <option value="NAME_ASC">Name (A–Z)</option>
            <option value="NAME_DESC">Name (Z–A)</option>
          </select>
        </label>
        </CompactFilters>
      </div>
      {(plans.isError || trainers.isError) && (
        <p role="alert">
          Some filter options could not load.{" "}
          {plans.error?.message || trainers.error?.message}
        </p>
      )}
      <BulkActionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}>
        <button type="button" className="btn btn-secondary" disabled={downloadBusy} onClick={() => void downloadMembers("xlsx", "selected")}><Download size={17} aria-hidden="true" />Download selected</button>
        <button type="button" className="btn btn-secondary" disabled={downloadBusy} onClick={() => void downloadMembers("csv", "selected")}><FileSpreadsheet size={17} aria-hidden="true" />Export CSV</button>
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => setBulkAction("notification")}><Bell size={17} aria-hidden="true" />Send notification</button>}
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => setBulkAction("trainer")}><UserCog size={17} aria-hidden="true" />Assign trainer</button>}
      </BulkActionBar>
      {bulkError && <p className="form-alert" role="alert">{bulkError}</p>}
      {query.isPending ? (
        <SkeletonTableRows rows={8} columns={8} />
      ) : query.isError ? (
        <div role="alert" className="panel state-card">
          <p>{query.error.message}</p>
          <button
            type="button"
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
                <th className="member-select-column">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    checked={allOnPageSelected}
                    onChange={togglePage}
                    aria-label="Select all members on this page"
                  />
                </th>
                <th>Member</th>
                {/* <th>Trainer</th> */}
                <th>Contact</th>
                <th>Plan / Access</th>
                <th>Attendance</th>
                <th style={{width:'200px'}}>Actions</th>
                <th>Join / Renewal</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const presentation = membershipPresentation(row, timezone, now);
                const pendingInvitation = row.invitation?.status === "PENDING";
                const phone = row.contact?.phone || row.userId?.phone;
                const email = row.contact?.email || row.userId?.email;
                const renewal = row.currentSubscriptionId?.renewalAt;
                const selected = selectedIds.has(row.publicId);
                return (
                  <tr
                    key={row.publicId}
                    className={presentation.state === "EXPIRING" ? "member-expiring-row" : undefined}
                    aria-selected={selected}
                    onDoubleClick={() => navigate("/owner/members/" + row.publicId)}
                  >
                    <td className="member-select-column" data-label="Select">
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={() => toggleMember(row.publicId)}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        aria-label={`Select ${memberName(row)}`}
                      />
                    </td>
                    <td data-label="Member">
                      <div className="member-identity">
                        <Avatar
                          name={memberName(row)}
                          src={row.contact?.avatarUrl || row.userId?.avatarUrl}
                          thumbnailSrc={row.contact?.avatarThumbnailUrl || (!row.contact?.avatarUrl ? row.userId?.avatarThumbnailUrl : undefined)}
                          size={46}
                        />
                        <div className="member-primary">
                          <strong title={memberName(row)}>{memberName(row)}</strong>
                          <StatusBadge
                            status={pendingInvitation ? "PENDING_ACTIVATION" : row.status === "JOIN_REQUESTED" ? "JOIN_REQUESTED" : presentation.state}
                          />
                        </div>
                      </div>
                    </td>
                    {/* <td data-label="Trainer">
                      <strong>{row.assignedTrainerId?.name || "Not assigned"}</strong>
                      {row.assignedTrainerId && (
                        <small className="member-trainer-phone">
                          <Phone size={14} aria-hidden="true" />
                          {row.assignedTrainerId.phone ||
                            row.assignedTrainerId.userId?.phone ||
                            "Phone not provided"}
                        </small>
                      )}
                      <small>
                        <Link to={"/owner/members/" + row.publicId}>
                          {canManage ? row.assignedTrainerId ? "View / Edit" : "Assign trainer" : "View member"}
                        </Link>
                      </small>
                    </td> */}
                    <td data-label="Contact">
                      <span className="member-contact-line">
                        <Phone size={15} aria-hidden="true" />
                        {phone || "Not provided"}
                      </span>
                      <small className="member-contact-line">
                        <Mail size={15} aria-hidden="true" />
                        {email || "Not provided"}
                      </small>
                    </td>
                    <td data-label="Plan / Access">
                      <div className="member-plan-status">
                        <span>{presentation.plan}</span>
                        <MembershipStatusDot member={row} timezone={timezone} now={now} />
                      </div>
                    </td>
                    <td data-label="Attendance">
                      <strong>{row.attendanceVisits30Days || 0}</strong>
                    </td>
                    <td data-label="Actions">
                      <div
                        className="member-row-actions"
                        style={{width:'200px'}}
                        onClick={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                      >
                        <MemberQuickActions
                          member={row}
                          actions={["call", "message"]}
                          ownerMember
                          canMessage={Boolean(canManage)}
                        />
                        <MemberWhatsAppReminderAction
                          member={row}
                          canManage={Boolean(canManage)}
                        />
                        <MemberMoreActions
                          member={row}
                          canManage={Boolean(canManage)}
                          canReadFinance={Boolean(canReadFinance)}
                        />
                      </div>
                    </td>
                    <td data-label="Join / Renewal">
                      <strong>{gymDate(row.joinedAt, timezone)}</strong>
                      <small>
                        {renewal
                          ? `Renews ${gymDate(renewal, timezone)}`
                          : row.currentSubscriptionId?.endsAt
                            ? `Ends ${gymDate(row.currentSubscriptionId.endsAt, timezone)}`
                            : "No renewal recorded"}
                      </small>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!query.data?.data.length && (
            <p className="state-card">No members match your filters.</p>
          )}
          <Pagination
            page={page}
            limit={limit}
            total={query.data?.meta?.total || 0}
            loading={query.isFetching}
            onPageChange={(next) => setList({ page: next })}
            onLimitChange={(next) => setList({ limit: next, page: 1 })}
          />
          {/* <footer hidden className="table-footer member-table-footer">
            <span>
              {selectedOnPage > 0 && `${selectedOnPage} selected · `}
              {rows.length} of {query.data?.meta?.total || 0} members shown
            </span>
            <div className="member-pagination">
              <button type="button" disabled={page <= 1} onClick={() => setList({ page: page - 1 })}>
                Previous
              </button>
              <span className="member-page-number" aria-current="page">
                <span className="sr-only">Page </span>{page}
              </span>
              <button
                type="button"
                disabled={page >= (query.data?.meta?.pages || 1)}
                onClick={() => setList({ page: page + 1 })}
              >
                Next
              </button>
            </div>
          </footer> */}
        </section>
      )}
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
      <ImportMembersModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => void client.invalidateQueries({ queryKey: ["api"] })}
      />
      <Modal
        open={bulkAction === "trainer"}
        title="Assign trainer to selected members"
        onClose={() => !bulkMutation.isPending && setBulkAction(null)}
      >
        <form
          className="page-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const trainer = String(new FormData(event.currentTarget).get("trainerId") || "");
            bulkMutation.mutate({
              endpoint: "/api/v1/owner/members/bulk/assign-trainer",
              body: { memberIds: [...selectedIds], trainerId: trainer || null },
            });
          }}
        >
          <p>Update {selectedIds.size} selected members. Only active trainers from this gym are available.</p>
          <label className="field">
            <span>Trainer</span>
            <select className="select" name="trainerId">
              <option value="">Leave unassigned</option>
              {trainers.data?.data.map((trainer) => (
                <option key={trainer._id} value={trainer._id}>{trainer.name}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" disabled={bulkMutation.isPending}>
            {bulkMutation.isPending ? "Assigning…" : "Apply trainer"}
          </button>
        </form>
      </Modal>
      <Modal
        open={bulkAction === "notification"}
        title="Notify selected members"
        onClose={() => !bulkMutation.isPending && setBulkAction(null)}
      >
        <form
          className="page-stack"
          onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            bulkMutation.mutate({
              endpoint: "/api/v1/owner/members/bulk/notify",
              body: {
                memberIds: [...selectedIds],
                title: values.get("title"),
                message: values.get("message"),
              },
            });
          }}
        >
          <p>Send an in-app notification to {selectedIds.size} selected members. Push delivery follows each member’s preferences.</p>
          <label className="field"><span>Title</span><input className="input" name="title" required minLength={2} maxLength={120} /></label>
          <label className="field"><span>Message</span><textarea className="textarea" name="message" required minLength={2} maxLength={1000} /></label>
          <button className="btn btn-primary" disabled={bulkMutation.isPending}>
            {bulkMutation.isPending ? "Sending…" : "Send notification"}
          </button>
        </form>
      </Modal>
    </div>
  );
}
