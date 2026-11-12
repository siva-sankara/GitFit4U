import { PageHeader } from "../../components/PageHeader";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MemberEditor } from "../owner/OwnerMembersPage";
import { Modal } from "../../components/Modal";
import {
  Action,
  EditForm,
  QueryState,
  ResourcePage,
  useData,
  type Row,
  type Field,
  type Column,
} from "../live/LiveData";
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  required = true,
): Field => ({ key, label, type, required });
const s = (key: string, label: string, options: string[]): Field => ({
  ...f(key, label, "select"),
  options,
});
const c = (key: string, title: string, format?: Column["format"]): Column => ({
  key,
  title,
  format,
});
const state = c("status", "Status", "status");
const gym: Field = {
  ...f("gymId", "Gym", "select"),
  source: "/api/v1/workspace/records/gyms?limit=100",
  optionValue: "publicId",
};

export function AdminAccounts({ owners = false }: { owners?: boolean }) {
  const [roleUser, setRoleUser] = useState<Row | null>(null);
  const [create, setCreate] = useState(false);
  const fields = [
    f("name", "Full name"),
    f("email", "Email", "email", false),
    f("phone", "Phone (+country code)"),
    s("status", "Account status", ["ACTIVE", "DISABLED", "BLOCKED"]),
  ];
  return (
    <>
      <div className="heading-actions">
        <button className="btn btn-primary" onClick={() => setCreate(true)}>
          Create account
        </button>
      </div>
      <ResourcePage
        title={owners ? "Gym owners" : "Accounts"}
        resource={owners ? "owners" : "users"}
        columns={[
          c("name", "Name"),
          c("email", "Email"),
          c("phone", "Phone"),
          c("roles", "Roles"),
          state,
        ]}
        fields={fields}
        updatePath={(r) => `/api/v1/admin/users/${r.publicId}`}
        statuses={["ACTIVE", "PENDING_VERIFICATION", "DISABLED", "BLOCKED"]}
        actions={(r) => (
          <button className="btn btn-secondary" onClick={() => setRoleUser(r)}>
            Gym access
          </button>
        )}
      />
      <Modal
        open={create}
        title="Create account"
        onClose={() => setCreate(false)}
      >
        {create && (
          <>
            <p>
              The account holder must verify their phone through the existing
              sign-in flow. No password is shared.
            </p>
            <EditForm
              endpoint="/api/v1/admin/users"
              fields={fields.filter((v) => v.key !== "status")}
              onSaved={() => setCreate(false)}
            />
          </>
        )}
      </Modal>
      <Modal
        open={!!roleUser}
        title={`Gym access — ${roleUser?.name || ""}`}
        onClose={() => setRoleUser(null)}
      >
        {roleUser && (
          <>
            <p>
              Owner access can only be assigned to the gym's registered owner.
              Removing access revokes matching sessions.
            </p>
            <EditForm
              endpoint={`/api/v1/admin/users/${roleUser.publicId}/roles`}
              fields={[
                gym,
                s("role", "Role", ["GYM_OWNER", "GYM_STAFF", "TRAINER"]),
                f("active", "Enable access", "checkbox"),
              ]}
              initial={{ active: true }}
              onSaved={() => setRoleUser(null)}
            />
          </>
        )}
      </Modal>
    </>
  );
}
export function MembershipActions({
  row,
  admin = false,
}: {
  row: Row;
  admin?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("freeze");
  if (row.type === "PLATFORM")
    return <span>Managed by verified platform payments</span>;
  const actions =
    row.status === "FROZEN"
      ? ["reactivate", "deactivate", "cancel"]
      : row.status === "GRACE"
        ? ["activate", "cancel"]
        : row.status === "ACTIVE"
          ? ["freeze", "deactivate", "cancel"]
          : ["DEACTIVATED", "CANCELLED"].includes(row.status) && Date.parse(row.endsAt) > Date.now()
            ? ["reactivate"]
            : [];
  if (!actions.length) return null;
  return (
    <>
      <button
        className="btn btn-secondary"
        onClick={() => {
          setAction(actions[0]);
          setOpen(true);
        }}
      >
        Manage status
      </button>
      <Modal
        open={open}
        title="Membership status"
        onClose={() => setOpen(false)}
      >
        {open && (
          <>
            <label className="field">
              <span>Action</span>
              <select
                className="select"
                value={action}
                onChange={(e) => setAction(e.target.value)}
              >
                {actions.map((value) => (
                  <option key={value} value={value}>
                    {value === "reactivate" && row.status === "FROZEN" ? "Unfreeze" : value.charAt(0).toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <p>
              Changes are recorded in membership history. Cancelling does not
              automatically refund a payment.
              Reactivation restores only remaining paid validity, after payment and refund checks. Expired memberships need renewal.
            </p>
            <EditForm
              key={action}
              endpoint={
                admin
                  ? `/api/v1/admin/memberships/${row.publicId}/status`
                  : `/api/v1/owner/subscriptions/${row.publicId}/${action}`
              }
              fields={[
                ...(action === "freeze"
                  ? [f("endsAt", "Freeze until", "datetime-local")]
                  : []),
                f("reason", "Reason", "textarea"),
              ]}
              transform={(body) => (admin ? { ...body, action } : body)}
              onSaved={() => setOpen(false)}
            />
          </>
        )}
      </Modal>
    </>
  );
}
export function AdminMemberships() {
  return (
    <ResourcePage
      title="Memberships"
      resource="subscriptions"
      columns={[
        c("gymId.name", "Gym"),
        c("userId.name", "Member"),
        c("planSnapshot.name", "Plan"),
        c("startsAt", "Start", "date"),
        c("endsAt", "End", "date"),
        state,
      ]}
      statuses={[
        "ACTIVE",
        "FROZEN",
        "DEACTIVATED",
        "EXPIRED",
        "CANCELLED",
        "GRACE",
        "PENDING_PAYMENT",
      ]}
      actions={(row) => <MembershipActions row={row} admin />}
    />
  );
}
export function AdminMembershipPlans() {
  const fields = [
    { ...gym, createOnly: true },
    f("name", "Name"),
    f("code", "Code"),
    f("description", "Description", "textarea", false),
    f("durationDays", "Duration (days)", "number"),
    f("priceMinor", "Price (INR)", "money"),
    f("discountMinor", "Discount (INR)", "money", false),
    f("freezeDaysAllowed", "Freeze days allowed", "number", false),
    f("benefits", "Benefits (one per line)", "lines", false),
    s("status", "Status", ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
  ];
  return (
    <ResourcePage
      title="Membership plans"
      resource="plans"
      columns={[
        c("name", "Name"),
        c("gymId.name", "Gym"),
        c("durationDays", "Days"),
        c("priceMinor", "Price", "money"),
        state,
      ]}
      fields={fields}
      createPath="/api/v1/admin/membership-plans"
      updatePath={(r) => `/api/v1/admin/membership-plans/${r.publicId}`}
    />
  );
}
export function AdminMembers() {
  const [create, setCreate] = useState(false),
    [gymId, setGymId] = useState(""),
    [detail, setDetail] = useState<Row | null>(null);
  const gyms = useData<Row[]>(
    "/api/v1/workspace/records/gyms?status=ACTIVE&limit=100",
  );
  const selectedGym = gyms.data?.data.find((gym) => gym.publicId === gymId);
  const client = useQueryClient();
  return (
    <>
      <section className="panel heading-actions" style={{ padding: 16 }}>
        <label className="field">
          <span>Gym for new membership</span>
          <select
            className="select"
            value={gymId}
            onChange={(e) => setGymId(e.target.value)}
          >
            <option value="">Select gym</option>
            {gyms.data?.data.map((g) => (
              <option key={g.publicId} value={g.publicId}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-primary"
          disabled={!selectedGym}
          onClick={() => setCreate(true)}
        >
          Create member
        </button>
        {gyms.isError && <p role="alert">{gyms.error.message}</p>}
      </section>
      <ResourcePage
        title="Members"
        resource="members"
        columns={[
          c("userId.name", "Name"),
          c("gymId.name", "Gym"),
          c("memberCode", "Code"),
          c("userId.phone", "Phone"),
          c("currentSubscriptionId.planSnapshot.name", "Plan"),
          c("currentSubscriptionId.endsAt", "End", "date"),
          state,
        ]}
        fields={[
          f("fitnessGoal", "Fitness goal", "text", false),
          s("status", "Member status", [
            "ACTIVE",
            "INACTIVE",
            "SUSPENDED",
            "ARCHIVED",
          ]),
        ]}
        updatePath={(r) => `/api/v1/admin/members/${r.publicId}`}
        actions={(row) => (
          <>
            <button
              className="btn btn-secondary"
              onClick={() => setDetail(row)}
            >
              View details
            </button>
            {row.status === "JOIN_REQUESTED" && (
              <>
                <Action
                  path={`/api/v1/admin/members/${row.publicId}/join/approve`}
                  confirmMessage="Approve direct gym access without creating a paid membership?"
                >
                  Approve join
                </Action>
                <Action
                  path={`/api/v1/admin/members/${row.publicId}/join/reject`}
                  confirmMessage="Reject this gym join request?"
                >
                  Reject join
                </Action>
              </>
            )}
          </>
        )}
      />
      {create && selectedGym && (
        <MemberEditor
          endpoint={`/api/v1/admin/gyms/${gymId}/members`}
          plansEndpoint={`/api/v1/admin/gyms/${gymId}/plans`}
          timezone={selectedGym.timezone}
          uploadGymId={selectedGym._id}
          onClose={() => setCreate(false)}
          onSaved={() => {
            setCreate(false);
            void client.invalidateQueries();
          }}
        />
      )}
      <Modal
        open={!!detail}
        title="Member details"
        onClose={() => setDetail(null)}
        wide
      >
        {detail && <AdminMemberDetails id={detail.publicId} />}
      </Modal>
    </>
  );
}
function AdminMemberDetails({ id }: { id: string }) {
  const [attendanceReason, setAttendanceReason] = useState(""), [recorded, setRecorded] = useState(false);
  const query = useData<Row>(`/api/v1/admin/members/${id}`);
  const value = query.data?.data,
    member = value?.member;
  return (
    <QueryState query={query}>
      {member && (
        <div className="page-stack">
          <h2>{member.contact?.name || member.userId?.name}</h2>
          <p>
            {member.contact?.email || member.userId?.email} ·{" "}
            {member.contact?.phone || member.userId?.phone}
          </p>
          <p>
            Plan:{" "}
            {member.currentSubscriptionId?.planSnapshot?.name || "No paid plan"}{" "}
            · Status: {member.status}
          </p>
          <p>
            Emergency contact: {member.emergencyContact?.name || "Not provided"}{" "}
            {member.emergencyContact?.phone}
          </p>
          <h3>Recent attendance</h3>
          <p>{value?.attendance?.length || 0} recorded events returned</p>
          {member.status === "ACTIVE" && value?.gymPublicId && <section className="panel form-section">
            <h3>Record manual attendance</h3>
            <p>Records attendance now without requesting location. Membership eligibility and daily duplicate checks still apply.</p>
            <label className="field"><span>Reason</span><input className="input" value={attendanceReason} maxLength={500} onChange={event => { setAttendanceReason(event.target.value); setRecorded(false); }} /></label>
            {attendanceReason.trim().length >= 3 && <Action path={`/api/v1/admin/gyms/${value.gymPublicId}/attendance`} body={{ memberIdentifier: member.publicId, reason: attendanceReason.trim() }} onDone={() => setRecorded(true)}>Record check-in</Action>}
            {recorded && <p role="status">Attendance recorded or already present for today.</p>}
          </section>}
          <h3>Payment history</h3>
          <p>Latest 50 payments. The Payments page contains the full history.</p>
          <ul>
            {value?.payments?.map((payment: Row) => (
              <li key={payment.publicId}>
                {payment.publicId} — {(payment.amountMinor / 100).toFixed(2)}{" "}
                {payment.currency} — {payment.status}
              </li>
            ))}
          </ul>
        </div>
      )}
    </QueryState>
  );
}
export function GymStatusAction({ gym }: { gym: Row }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        Manage availability
      </button>
      <Modal
        open={open}
        title="Gym availability"
        onClose={() => setOpen(false)}
      >
        {open && (
          <GymActivationForm gym={gym} onSaved={() => setOpen(false)} />
        )}
      </Modal>
    </>
  );
}
export function AdminTrainers() {
  return (
    <div className="page-stack">
      <p>
        To create a trainer, grant Trainer access to an existing account in
        Accounts → Gym access. This preserves verified sign-in identities.
      </p>
      <ResourcePage
        title="Trainers"
        resource="trainers"
        columns={[
          c("name", "Name"),
          c("specializations", "Specializations"),
          c("qualifications", "Qualifications"),
          state,
        ]}
        fields={[
          f("name", "Full name"),
          f("bio", "Biography", "textarea", false),
          f(
            "specializations",
            "Specializations (one per line)",
            "lines",
            false,
          ),
          f("qualifications", "Qualifications (one per line)", "lines", false),
          s("status", "Status", ["ACTIVE", "INACTIVE", "ARCHIVED"]),
        ]}
        updatePath={(r) => `/api/v1/admin/trainers/${r.publicId}`}
      />
    </div>
  );
}
export function AdminSettings() {
  const query = useData<Row>("/api/v1/admin/settings");
  return (
    <div className="page-stack">
      <PageHeader>
        <h1>Platform settings</h1>
      </PageHeader>
      <QueryState query={query}>
        <section className="panel form-section">
          <EditForm
            key={JSON.stringify(query.data?.data)}
            endpoint="/api/v1/admin/settings"
            method="PATCH"
            initial={query.data?.data}
            fields={[
              f("supportEmail", "Support email", "email", false),
              f("supportPhone", "Support phone (+country code)", "text", false),
              f(
                "maintenanceNotice",
                "Public service notice",
                "textarea",
                false,
              ),
            ]}
          />
        </section>
      </QueryState>
    </div>
  );
}
export function RefundAction({ payment }: { payment: Row }) {
  const [open, setOpen] = useState(false);
  if (!["CAPTURED", "PARTIALLY_REFUNDED"].includes(payment.status)) return null;
  const offline = payment.provider === "OFFLINE";
  return (
    <>
      <button className="btn btn-secondary" onClick={() => setOpen(true)}>
        {offline ? "Record offline refund" : "Issue refund"}
      </button>
      <Modal
        open={open}
        title={
          offline ? "Record completed offline refund" : "Issue payment refund"
        }
        onClose={() => setOpen(false)}
      >
        {open && (
          <>
            <p>
              {offline
                ? "This records money already returned outside the application. It does not transfer funds."
                : "This submits a financial reversal to the payment provider."}{" "}
              Confirm the amount and reason; the original payment remains in
              history.
            </p>
            <EditForm
              endpoint={`/api/v1/admin/payments/${payment.publicId}/refunds`}
              fields={[
                {
                  ...f("amountMinor", "Refund amount (INR)", "money"),
                  min: 0.01,
                  max: payment.amountMinor / 100,
                },
                f("reason", "Reason", "textarea"),
                ...(offline
                  ? [
                      f("offlineReference", "Refund receipt/reference"),
                      f(
                        "offlineConfirmed",
                        "I confirm this amount has already been returned to the payer",
                        "checkbox",
                      ),
                    ]
                  : []),
              ]}
              onSaved={() => setOpen(false)}
              submitLabel={
                offline ? "Record completed refund" : "Confirm refund"
              }
            />
          </>
        )}
      </Modal>
    </>
  );
}
import { GymActivationForm } from "./GymActivationForm";
