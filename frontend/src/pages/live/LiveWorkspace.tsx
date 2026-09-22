import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  AreaChart,
  Area,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../api/hooks";
import { Modal } from "../../components/Modal";
import { apiRequest, setAccessToken } from "../../services/apiClient";
import {
  useData,
  QueryState,
  ResourcePage,
  EditForm,
  Table,
  Action,
  money,
  date,
  label,
  type Column,
  type Field,
  type Row,
} from "./LiveData";
import { OwnerScannerPage } from "../owner/OwnerScannerPage";
import { GymProfileEditor } from "../owner/GymProfileEditor";
import { AttendanceQrPage } from "../user/AttendanceQrPage";
import { NotificationsApiPage } from "../shared/NotificationsApiPage";
import { MessagesPage } from "../shared/MessagesPage";
import { RegisterGymPage } from "../public/RegisterGymPage";
import { MemberSubscriptions } from "../user/MemberSubscriptions";
import { StatusBadge } from "../../components/StatusBadge";
import "../../styles/member-workspace.css";

const col = (
  key: string,
  title = label(key),
  format?: Column["format"],
): Column => ({ key, title, format });
const field = (
  key: string,
  title = label(key),
  type: Field["type"] = "text",
  required = true,
): Field => ({ key, label: title, type, required });
const select = (key: string, options: string[], title = label(key)): Field => ({
  ...field(key, title, "select"),
  options,
});
const status = col("status", "Status", "status"),
  created = col("createdAt", "Created", "date"),
  name = col("name", "Name");
const memberCols = [
  {
    ...col("userId.name", "Member"),
    link: (r: Row) => `/owner/members/${r.publicId}`,
  },
  col("memberCode", "Member code"),
  col("userId.phone", "Phone"),
  col("currentSubscriptionId.planSnapshot.name", "Plan"),
  col("currentSubscriptionId.endsAt", "Expires", "date"),
  col("currentSubscriptionId.status", "Membership", "status"),
  col("attendanceVisits30Days", "Visits (30 days)"),
  col("currentSubscriptionId.latestPaymentId.status", "Payment", "status"),
  col("joinedAt", "Joined", "date"),
  col("status", "Member status", "status"),
];
const paymentCols = [
  col("publicId", "Reference"),
  col("payerId.name", "Payer"),
  col("purpose", "Purpose", "status"),
  col("amountMinor", "Amount", "money"),
  status,
  created,
];
const subscriptionCols = [
  col("gymId.name", "Gym"),
  col("userId.name", "Member"),
  col("planSnapshot.name", "Plan"),
  col("startsAt", "Start", "date"),
  col("endsAt", "End", "date"),
  status,
];
const classCols = [
  name,
  col("gymId.name", "Gym"),
  col("trainerId.name", "Trainer"),
  col("startsAt", "Start", "date"),
  col("endsAt", "End", "date"),
  col("bookedCount", "Booked"),
  col("capacity", "Capacity"),
  status,
];
const planFields = [
  field("name"),
  field("code"),
  field("durationDays", "Duration (days)", "number"),
  field("priceMinor", "Price (INR)", "money"),
  field("discountMinor", "Discount (INR)", "money", false),
  field(
    "taxRateBasisPoints",
    "Tax rate (basis points: 1800 = 18%)",
    "number",
    false,
  ),
  field("freezeDaysAllowed", "Freeze days", "number", false),
  field("benefits", "Benefits (one per line)", "lines", false),
  select("status", ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]),
];
const classFields = [
  field("name"),
  select("category", [
    "YOGA",
    "ZUMBA",
    "CROSSFIT",
    "HIIT",
    "STRENGTH",
    "CARDIO",
    "OTHER",
  ]),
  {
    ...field("trainerId", "Trainer", "select", false),
    source: "/api/v1/workspace/records/trainers?limit=100",
  },
  field("startsAt", "Start", "datetime-local"),
  field("endsAt", "End", "datetime-local"),
  field("capacity", "Capacity", "number"),
  field("room", "Room", "text", false),
  select("status", ["SCHEDULED", "CANCELLED", "COMPLETED"]),
];
function Heading({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <header className="page-heading">
      <div>
        <span className="eyebrow">GETFIT4U</span>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
    </header>
  );
}
function Dashboard() {
  const me = useCurrentUser(),
    role = me.data?.data.context.role;
  const permissions: string[] = me.data?.data.context.permissions || [];
  const canReadSummary =
    role === "USER" ||
    role === "ADMIN" ||
    (["GYM_OWNER", "GYM_STAFF"].includes(role || "") &&
      permissions.includes("finance:read"));
  const summary = useData<Row>("/api/v1/workspace/summary", canReadSummary);
  const stats = useData<Row>(
    role === "ADMIN"
      ? "/api/v1/admin/dashboard"
      : role === "TRAINER"
        ? "/api/v1/trainer/dashboard"
        : "/api/v1/owner/dashboard",
    !!role && role !== "USER",
  );
  const metrics = role === "USER" ? summary : stats,
    data = metrics.data?.data || {},
    series = summary.data?.data;
  return (
    <div className="page-stack">
      <Heading
        title={`Welcome, ${me.data?.data.user.name || "member"}`}
        description={new Date().toLocaleDateString(undefined, {
          dateStyle: "full",
        })}
      />
      <QueryState query={metrics}>
        {role === "GYM_OWNER" && data.gymStatus && (
          <section className="panel dashboard-gym-status">
            <header>
              <h2>Gym status</h2>
              <StatusBadge status={data.gymStatus} />
            </header>
            <p>
              {data.gymStatus === "ACTIVE"
                ? "Your gym is active. Manage its profile and memberships here."
                : "Your gym is hidden until registration payment is verified."}
            </p>
            {data.gymStatus !== "ACTIVE" && (
              <Link to="/register-gym">Complete registration payment</Link>
            )}
          </section>
        )}
        <section className="stat-grid">
          {Object.entries(data)
            .filter(([, v]) => typeof v === "number")
            .map(([key, value]) => (
              <article className="panel metric-tile" key={key}>
                <span>{label(key.replace(/Minor$/, ""))}</span>
                <strong>
                  {key.endsWith("Minor") ? money(value) : String(value)}
                </strong>
              </article>
            ))}
        </section>
      </QueryState>
      {canReadSummary && (
        <QueryState query={summary}>
          <section className="dashboard-chart-grid">
            <article className="panel chart-card">
              <h2>
                {role === "USER" ? "Payments" : "Gross captured payments"}
              </h2>
              <p>Last six months · INR</p>
              {series?.revenue?.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <AreaChart
                    data={series.revenue.map((v: Row) => ({
                      ...v,
                      amount: v.totalMinor / 100,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="_id" />
                    <YAxis />
                    <Tooltip />
                    <Area dataKey="amount" stroke="#65a30d" fill="#d9f99d" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p>No captured payments in this period.</p>
              )}
            </article>
            <article className="panel chart-card">
              <h2>Daily check-ins</h2>
              <p>Last six months</p>
              {series?.visits?.length ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={series.visits}>
                    <XAxis dataKey="_id" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="visits" fill="#65a30d" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p>No attendance recorded in this period.</p>
              )}
            </article>
          </section>
        </QueryState>
      )}
      <div className="heading-actions">
        {role === "USER" ? (
          <>
            <Link className="btn btn-primary" to="/app/explore">
              Find a gym
            </Link>
            <Link className="btn btn-secondary" to="/app/subscriptions">
              Memberships and QR
            </Link>
            <Link className="btn btn-secondary" to="/app/classes">
              Book a class
            </Link>
            <Link className="btn btn-secondary" to="/register-gym">
              Register a gym
            </Link>
          </>
        ) : role === "ADMIN" ? (
          <Link className="btn btn-primary" to="/admin/registrations">
            Review registrations
          </Link>
        ) : role === "TRAINER" ? (
          <Link className="btn btn-primary" to="/trainer/workout-plans">
            Manage workouts
          </Link>
        ) : (
          <>
            {permissions.includes("attendance:scan") && (
              <Link className="btn btn-primary" to="/owner/scanner">
                Open scanner
              </Link>
            )}
            {permissions.includes("member:read") && (
              <Link className="btn btn-secondary" to="/owner/members">
                Manage members
              </Link>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function Profile() {
  const query = useData<Row>("/api/v1/users/me");
  const data = query.data?.data;
  return (
    <div className="page-stack">
      <Heading title="Your profile" />
      <QueryState query={query}>
        {data && (
          <section className="panel form-section">
            <p>
              {data.email || "Email not added"} ·{" "}
              {data.phone || "Phone not added"}
            </p>
            <p>Joined {date(data.createdAt)}</p>
            <EditForm
              key={data.updatedAt}
              endpoint="/api/v1/users/me"
              method="PATCH"
              initial={data}
              fields={[
                field("name", "Full name"),
                field("profile.dateOfBirth", "Date of birth", "date", false),
                {
                  ...select(
                    "profile.gender",
                    ["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"],
                    "Gender",
                  ),
                  required: false,
                },
                field("profile.fitnessGoal", "Fitness goal", "text", false),
                {
                  ...field("profile.heightCm", "Height (cm)", "number", false),
                  min: 50,
                  max: 260,
                },
                {
                  ...field("profile.weightKg", "Weight (kg)", "number", false),
                  min: 20,
                  max: 400,
                },
                field(
                  "profile.emergencyContact.name",
                  "Emergency contact",
                  "text",
                  false,
                ),
                field(
                  "profile.emergencyContact.phone",
                  "Emergency phone",
                  "text",
                  false,
                ),
                field(
                  "profile.emergencyContact.relationship",
                  "Relationship",
                  "text",
                  false,
                ),
              ]}
            />
          </section>
        )}
      </QueryState>
      <Security />
    </div>
  );
}
function Security() {
  const query = useData<Row[]>("/api/v1/auth/sessions");
  const me = useCurrentUser();
  return (
    <section className="panel form-section">
      <h2>Active sessions</h2>
      <QueryState query={query}>
        <Table
          rows={query.data?.data || []}
          columns={[
            col("device.name", "Device"),
            col("activeRole", "Role", "status"),
            col("createdAt", "Signed in", "date"),
            col("expiresAt", "Expires", "date"),
          ]}
          actions={(row) => (
            <Action
              path={`/api/v1/auth/sessions/${row.publicId}`}
              method="DELETE"
              onDone={() => {
                if (row.publicId === me.data?.data.context.sessionId) {
                  setAccessToken(null);
                  window.location.assign("/auth/login");
                }
              }}
            >
              Revoke session
            </Action>
          )}
        />
      </QueryState>
      <Action
        path="/api/v1/auth/logout-all"
        onDone={() => {
          setAccessToken(null);
          window.location.assign("/auth/login");
        }}
      >
        Log out all devices
      </Action>
    </section>
  );
}
function GymProfile() {
  return (
    <>
      <GymProfileEditor classFields={classFields} planFields={planFields} />
      <Security />
    </>
  );
}
function MemberDetails({ id }: { id: string }) {
  const query = useData<Row>(`/api/v1/owner/members/${encodeURIComponent(id)}`);
  const data = query.data?.data;
  return (
    <div className="page-stack">
      <Link to="/owner/members">Back to members</Link>
      <QueryState query={query}>
        {data && (
          <>
            <Heading
              title={data.member.userId?.name || data.member.memberCode}
            />
            <section className="panel form-section">
              <p>
                {data.member.userId?.email} · {data.member.userId?.phone}
              </p>
              <EditForm
                endpoint={`/api/v1/workspace/members/${id}`}
                method="PATCH"
                initial={data.member}
                fields={[
                  field("fitnessGoal", "Fitness goal", "text", false),
                  {
                    ...field(
                      "assignedTrainerId",
                      "Assigned trainer",
                      "select",
                      false,
                    ),
                    source: "/api/v1/workspace/records/trainers?limit=100",
                  },
                  select("status", [
                    "ACTIVE",
                    "INACTIVE",
                    "SUSPENDED",
                    "ARCHIVED",
                  ]),
                ]}
              />
              <Action
                path="/api/v1/conversations"
                body={{
                  type: "DIRECT",
                  participantIds: [data.member.userId._id],
                }}
                onDone={() => window.location.assign("/owner/messages")}
              >
                Start conversation
              </Action>
            </section>
            <section className="panel">
              <h2>Payments</h2>
              <Table rows={data.payments} columns={paymentCols} />
            </section>
            <section className="panel">
              <h2>Attendance</h2>
              <Table
                rows={data.attendance}
                columns={[
                  col("occurredAt", "Time", "date"),
                  col("type", "Event", "status"),
                  col("source", "Source"),
                ]}
              />
            </section>
          </>
        )}
      </QueryState>
    </div>
  );
}
function Classes() {
  const sessions = useData<Row[]>("/api/v1/users/classes"),
    bookings = useData<Row[]>("/api/v1/workspace/records/bookings?limit=100");
  const [day, setDay] = useState("");
  return (
    <div className="page-stack">
      <Heading title="Classes and bookings" />
      <label className="field">
        <span>Filter by date</span>
        <input
          className="input"
          type="date"
          value={day}
          onChange={(e) => setDay(e.target.value)}
        />
      </label>
      <QueryState query={sessions}>
        <section className="panel">
          <Table
            rows={(sessions.data?.data || []).filter(
              (r) => !day || String(r.startsAt).startsWith(day),
            )}
            columns={classCols}
            actions={(row) => {
              const booking = bookings.data?.data.find(
                (b) => b.sessionId?._id === row._id && b.status === "BOOKED",
              );
              return booking ? (
                <Action
                  method="DELETE"
                  path={`/api/v1/users/classes/${row.publicId}/bookings/${booking._id}`}
                >
                  Cancel booking
                </Action>
              ) : row.bookedCount < row.capacity ? (
                <Action path={`/api/v1/users/classes/${row.publicId}/bookings`}>
                  Book class
                </Action>
              ) : (
                <span>Full</span>
              );
            }}
          />
        </section>
      </QueryState>
      <QueryState query={bookings}>
        <section className="panel">
          <h2>Your bookings</h2>
          <Table
            rows={bookings.data?.data || []}
            columns={[
              col("sessionId.name", "Class"),
              col("sessionId.startsAt", "Starts", "date"),
              status,
            ]}
          />
        </section>
      </QueryState>
    </div>
  );
}
function Support() {
  const me = useCurrentUser();
  const [ticket, setTicket] = useState<Row | null>(null);
  return (
    <>
      <ResourcePage
        title="Support tickets"
        resource="support"
        columns={[
          col("subject", "Subject"),
          col("requesterId.name", "Requester"),
          col("priority", "Priority", "status"),
          status,
          created,
        ]}
        createPath="/api/v1/users/me/support-tickets"
        fields={[
          field("subject"),
          field("message", "Describe the issue", "textarea"),
          select("priority", ["LOW", "NORMAL", "HIGH", "URGENT"]),
        ]}
        actions={(row) => (
          <button className="btn btn-secondary" onClick={() => setTicket(row)}>
            Open thread
          </button>
        )}
      />
      <Modal
        open={!!ticket}
        title={ticket?.subject || "Support"}
        onClose={() => setTicket(null)}
      >
        {ticket && (
          <>
            {ticket.messages?.map((m: Row, i: number) => (
              <p key={i}>
                {m.body}
                <small> · {date(m.createdAt)}</small>
              </p>
            ))}
            <EditForm
              endpoint={`/api/v1/workspace/support/${ticket.publicId}/replies`}
              fields={[
                field("message", "Reply", "textarea"),
                {
                  ...select("status", [
                    "OPEN",
                    "IN_PROGRESS",
                    "WAITING_FOR_USER",
                    "RESOLVED",
                    "CLOSED",
                  ]),
                  required: false,
                },
              ].filter(
                (f) =>
                  f.key !== "status" ||
                  me.data?.data?.context?.role === "ADMIN",
              )}
              onSaved={() => setTicket(null)}
            />
          </>
        )}
      </Modal>
    </>
  );
}
function Invoices() {
  const [invoice, setInvoice] = useState<Row | null>(null);
  return (
    <>
      <ResourcePage
        title="Invoices"
        resource="invoices"
        columns={[
          col("number", "Invoice"),
          col("totalMinor", "Total", "money"),
          col("issuedAt", "Issued", "date"),
          status,
        ]}
        actions={(row) => (
          <button className="btn btn-secondary" onClick={() => setInvoice(row)}>
            View invoice
          </button>
        )}
      />
      <Modal open={!!invoice} title="Invoice" onClose={() => setInvoice(null)}>
        {invoice && (
          <article className="invoice-print">
            <h2>{invoice.number}</h2>
            <p>{invoice.supplierSnapshot?.name}</p>
            <p>
              Bill to: {invoice.customerSnapshot?.name} ·{" "}
              {invoice.customerSnapshot?.email}
            </p>
            <p>{date(invoice.issuedAt)}</p>
            {invoice.lines?.map((line: Row, i: number) => (
              <p key={i}>
                {line.description} · {line.quantity} ×{" "}
                {money(line.unitPriceMinor)}
              </p>
            ))}
            <p>
              Subtotal {money(invoice.subtotalMinor)} · Tax{" "}
              {money(invoice.taxMinor)}
            </p>
            <h3>Total {money(invoice.totalMinor)}</h3>
            <button className="btn btn-primary" onClick={() => window.print()}>
              Print / save PDF
            </button>
          </article>
        )}
      </Modal>
    </>
  );
}
function TrainerWorkouts() {
  const [plan, setPlan] = useState<Row | null>(null),
    [member, setMember] = useState<Row | null>(null);
  return (
    <>
      <ResourcePage
        title="Workout plans"
        resource="workout-plans"
        columns={[
          name,
          col("goal"),
          col("exercises", "Exercises"),
          col("version"),
          status,
        ]}
        createPath="/api/v1/trainer/workout-plans"
        fields={[
          field("name"),
          field("goal", "Goal", "text", false),
          field("exerciseNames", "Exercises (one per line)", "lines"),
          select("status", ["DRAFT", "ACTIVE"]),
        ]}
        transform={(body) => ({
          name: body.name,
          goal: body.goal,
          status: body.status,
          exercises: body.exerciseNames.map((name: string) => ({ name })),
        })}
        actions={(row) => (
          <button className="btn btn-secondary" onClick={() => setPlan(row)}>
            Assign
          </button>
        )}
      />
      <Modal
        open={!!plan}
        title={`Assign ${plan?.name || "workout"}`}
        onClose={() => setPlan(null)}
      >
        {plan && <AssignPlan plan={plan} onSaved={() => setPlan(null)} />}
      </Modal>
    </>
  );
}
function AssignPlan({ plan, onSaved }: { plan: Row; onSaved: () => void }) {
  const [member, setMember] = useState("");
  const members = useData<Row[]>("/api/v1/workspace/records/members?limit=100");
  return (
    <>
      <label className="field">
        <span>Assigned client</span>
        <select
          className="select"
          value={member}
          onChange={(e) => setMember(e.target.value)}
        >
          <option value="">Select client</option>
          {members.data?.data.map((m) => (
            <option key={m.publicId} value={m.publicId}>
              {m.userId?.name || m.memberCode}
            </option>
          ))}
        </select>
      </label>
      {member && (
        <EditForm
          endpoint={`/api/v1/trainer/clients/${member}/workout-assignments`}
          fields={[
            field("startsAt", "Start", "datetime-local"),
            field("endsAt", "End", "datetime-local", false),
            field("notes", "Notes", "textarea", false),
          ]}
          transform={(body) => ({ ...body, workoutPlanId: plan.publicId })}
          onSaved={onSaved}
        />
      )}
    </>
  );
}
function TrainerClients() {
  const [member, setMember] = useState<Row | null>(null);
  return (
    <>
      <ResourcePage
        title="Assigned clients"
        resource="members"
        columns={[
          col("userId.name", "Name"),
          col("memberCode"),
          col("fitnessGoal", "Goal"),
          status,
        ]}
        actions={(row) => (
          <button className="btn btn-secondary" onClick={() => setMember(row)}>
            Record progress
          </button>
        )}
      />
      <Modal
        open={!!member}
        title={`Progress: ${member?.userId?.name || "client"}`}
        onClose={() => setMember(null)}
      >
        {member && (
          <EditForm
            endpoint={`/api/v1/trainer/clients/${member.publicId}/progress`}
            fields={[
              field("weightKg", "Weight (kg)", "number", false),
              field("bodyFatPercent", "Body fat (%)", "number", false),
              field("notes", "Notes", "textarea", false),
            ]}
            onSaved={() => setMember(null)}
          />
        )}
      </Modal>
    </>
  );
}
function PaymentRegistrations() {
  const [selected, setSelected] = useState<Row | null>(null);
  return (
    <>
      <ResourcePage
        title="Gym registrations"
        resource="registrations"
        columns={[
          col("gymId.name", "Gym"),
          col("ownerId.name", "Owner"),
          col("gymId.address.city", "City"),
          status,
          col("activatedAt", "Activated", "date"),
        ]}
        statuses={[
          "DRAFT",
          "PAYMENT_PENDING",
          "PAYMENT_FAILED",
          "PAYMENT_CANCELLED",
          "ACTIVE",
          "SUSPENDED",
        ]}
        actions={(row) => (
          <button
            className="btn btn-secondary"
            onClick={() => setSelected(row)}
          >
            View payments
          </button>
        )}
      />
      <Modal
        open={!!selected}
        title="Registration and payments"
        onClose={() => setSelected(null)}
      >
        {selected && <RegistrationPayments id={selected.publicId} />}
      </Modal>
    </>
  );
}
function RegistrationPayments({ id }: { id: string }) {
  const query = useData<Row>(`/api/v1/admin/registrations/${id}`),
    r = query.data?.data.registration;
  return (
    <QueryState query={query}>
      {r && (
        <>
          <h2>{r.gymId?.name}</h2>
          <p>
            {r.gymId?.address?.line1}, {r.gymId?.address?.city}
          </p>
          <p>
            Owner: {r.ownerId?.name} - {r.ownerId?.email}
          </p>
          <p>Status: {label(r.status)}</p>
          <p>
            Gyms activate automatically after backend-verified payment capture.
          </p>
          <Table
            rows={query.data?.data.payments || []}
            columns={[
              col("publicId", "Payment"),
              col("amountMinor", "Amount", "money"),
              col("currency"),
              status,
              col("capturedAt", "Captured", "date"),
              col("failureDescription", "Failure"),
            ]}
          />
        </>
      )}
    </QueryState>
  );
}
function Monitoring() {
  const query = useData<Row>("/api/v1/admin/monitoring/health");
  return (
    <div className="page-stack">
      <Heading
        title="System health"
        description="Current database and provider configuration checks"
      />
      <button className="btn btn-secondary" onClick={() => query.refetch()}>
        Refresh checks
      </button>
      <QueryState query={query}>
        <section className="stat-grid">
          {Object.entries(query.data?.data || {}).map(([key, value]) => (
            <article className="panel metric-tile" key={key}>
              <h2>{label(key)}</h2>
              <strong>{label(value.status)}</strong>
              {value.detail && <p>{value.detail}</p>}
              {value.pendingReconciliation != null && (
                <p>{value.pendingReconciliation} pending reconciliation</p>
              )}
            </article>
          ))}
        </section>
      </QueryState>
    </div>
  );
}
export function LiveWorkspace() {
  const path = useLocation().pathname.split("/").filter(Boolean),
    role = path[0],
    page = path[0] === "profile" ? "profile" : path[1] || "dashboard",
    me = useCurrentUser();
  const permissions: string[] = me.data?.data.context.permissions || [];
  const can = (p: string) => role === "admin" || permissions.includes(p);
  if (page === "notifications") return <NotificationsApiPage />;
  if (page === "messages") return <MessagesPage />;
  if (page === "support") return <Support />;
  if (page === "security") return <Security />;
  if (page === "profile" || (role === "admin" && page === "settings"))
    return <Profile />;
  if (page === "invoices") return <Invoices />;
  if (page === "home" || page === "dashboard" || page === "reports")
    return <Dashboard />;
  if (page === "scanner") return <OwnerScannerPage />;
  if (page === "attendance" && path[2] === "qr") return <AttendanceQrPage />;
  if (page === "attendance")
    return (
      <ResourcePage
        title="Attendance"
        resource="attendance"
        columns={[
          col("userId.name", "Member"),
          col("gymId.name", "Gym"),
          col("occurredAt", "Time", "date"),
          col("localDate", "Gym date"),
          col("type", "Event", "status"),
          col("source", "Source"),
        ]}
      />
    );
  if (role === "app") {
    if (page === "subscriptions" || page === "checkout")
      return <MemberSubscriptions />;
    if (page === "classes") return <Classes />;
    if (page === "favorites")
      return (
        <ResourcePage
          title="Favorite gyms"
          resource="favorites"
          columns={[
            {
              ...col("gymId.name", "Gym"),
              link: (r) => `/gyms/${r.gymId?.slug}`,
            },
            col("gymId.address.city", "City"),
            col("gymId.startingPriceMinor", "From", "money"),
          ]}
          actions={(r) => (
            <Action
              method="DELETE"
              path={`/api/v1/users/me/favorites/${r.gymId?.publicId}`}
            >
              Remove favorite
            </Action>
          )}
        />
      );
    if (page === "referrals")
      return (
        <ResourcePage
          title="Referrals"
          resource="referrals"
          columns={[
            col("code"),
            status,
            col("rewardMinor", "Reward", "money"),
            created,
          ]}
          createPath="/api/v1/users/me/referrals"
          fields={[field("code", "Referral code")]}
        />
      );
    if (page === "workouts")
      return (
        <ResourcePage
          title="Your workouts"
          resource="workouts"
          columns={[
            col("planSnapshot.name", "Workout"),
            col("planSnapshot.exercises", "Exercises"),
            col("startsAt", "Starts", "date"),
            status,
          ]}
        />
      );
  }
  if (page === "payments" || page === "refunds")
    return (
      <ResourcePage
        title={label(page)}
        resource={page}
        columns={
          page === "payments"
            ? paymentCols
            : [
                col("publicId", "Reference"),
                col("amountMinor", "Amount", "money"),
                col("reason"),
                status,
                created,
              ]
        }
      />
    );
  if (page === "subscriptions")
    return (
      <ResourcePage
        title="Subscriptions"
        resource="subscriptions"
        columns={subscriptionCols}
        statuses={[
          "ACTIVE",
          "EXPIRED",
          "FROZEN",
          "CANCELLED",
          "PENDING_PAYMENT",
        ]}
      />
    );
  if (role === "owner") {
    if (page === "gym-profile" || page === "settings") return <GymProfile />;
    if (page === "members" && path[2]) return <MemberDetails id={path[2]} />;
    if (page === "members")
      return (
        <ResourcePage
          title="Members"
          resource="members"
          columns={memberCols.filter(
            (column) =>
              !column.key.includes("latestPaymentId") || can("finance:read"),
          )}
          createPath={can("member:write") ? "/api/v1/owner/members" : undefined}
          fields={[
            field("name", "Full name"),
            field("phone", "Phone", "text", false),
            field("email", "Email", "email", false),
            field("fitnessGoal", "Fitness goal", "text", false),
          ]}
          statuses={["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]}
        />
      );
    if (page === "plans")
      return (
        <ResourcePage
          title="Membership plans"
          resource="plans"
          columns={[
            name,
            col("durationDays", "Days"),
            col("priceMinor", "Price", "money"),
            col("benefits"),
            status,
          ]}
          fields={planFields}
          createPath={can("plan:write") ? "/api/v1/owner/plans" : undefined}
          updatePath={
            can("plan:write")
              ? (r) => `/api/v1/owner/plans/${r.publicId}`
              : undefined
          }
        />
      );
    if (page === "classes")
      return (
        <ResourcePage
          title="Classes"
          resource="classes"
          columns={classCols}
          fields={classFields}
          createPath={can("class:write") ? "/api/v1/owner/classes" : undefined}
          updatePath={
            can("class:write")
              ? (r) => `/api/v1/workspace/classes/${r.publicId}`
              : undefined
          }
        />
      );
    if (page === "trainers")
      return (
        <ResourcePage
          title="Trainers"
          resource="trainers"
          columns={[
            name,
            col("qualifications"),
            col("specializations"),
            status,
          ]}
          createPath={can("class:write") ? "/api/v1/owner/trainers" : undefined}
          fields={[
            field("name"),
            field("email", "Existing account email", "email"),
            field(
              "qualifications",
              "Qualifications (one per line)",
              "lines",
              false,
            ),
            field(
              "specializations",
              "Specializations (one per line)",
              "lines",
              false,
            ),
          ]}
        />
      );
    if (page === "campaigns" || page === "whatsapp")
      return (
        <ResourcePage
          title="Campaigns"
          resource="campaigns"
          columns={[
            name,
            col("channel"),
            col("message"),
            col("analytics.recipients", "Recipients"),
            col("analytics.sent", "Sent"),
            status,
          ]}
          createPath="/api/v1/owner/campaigns"
          fields={[
            field("name"),
            select("channel", ["IN_APP", "WHATSAPP", "PUSH", "EMAIL"]),
            select(
              "audience.status",
              ["ACTIVE", "INACTIVE", "SUSPENDED"],
              "Audience",
            ),
            field("message", "Message", "textarea"),
          ]}
          actions={(r) =>
            r.status === "DRAFT" && (
              <Action path={`/api/v1/workspace/campaigns/${r.publicId}/send`}>
                Send campaign
              </Action>
            )
          }
        />
      );
    if (page === "offers")
      return (
        <ResourcePage
          title="Offers"
          resource="offers"
          columns={[
            name,
            col("type"),
            col("discount.amountMinor", "Discount", "money"),
            col("startsAt", "Starts", "date"),
            col("endsAt", "Ends", "date"),
            status,
          ]}
          fields={[
            field("name"),
            select("type", [
              "DISCOUNT",
              "NEW_MEMBER",
              "FESTIVAL",
              "REFERRAL",
              "FIRST_MONTH",
            ]),
            field("discount.amountMinor", "Discount (INR)", "money"),
            field("startsAt", "Starts", "datetime-local"),
            field("endsAt", "Ends", "datetime-local"),
            select("status", ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]),
          ]}
          createPath="/api/v1/owner/offers"
          updatePath={(r) => `/api/v1/owner/offers/${r.publicId}`}
        />
      );
    if (page === "revenue")
      return (
        <>
          <Dashboard />
          <ResourcePage
            title="Settlements"
            resource="settlements"
            columns={[
              col("publicId", "Reference"),
              col("grossMinor", "Gross", "money"),
              col("netMinor", "Net", "money"),
              status,
              col("settledAt", "Settled", "date"),
            ]}
          />
        </>
      );
  }
  if (role === "trainer") {
    if (page === "clients") return <TrainerClients />;
    if (page === "workout-plans") return <TrainerWorkouts />;
    if (page === "progress")
      return (
        <ResourcePage
          title="Client progress"
          resource="progress"
          columns={[
            col("memberProfileId.userId.name", "Member"),
            col("weightKg", "Weight (kg)"),
            col("bodyFatPercent", "Body fat (%)"),
            col("recordedAt", "Recorded", "date"),
            col("notes"),
          ]}
        />
      );
    return (
      <ResourcePage
        title="Training schedule"
        resource="classes"
        columns={classCols}
      />
    );
  }
  if (role === "admin") {
    if (page === "registrations") return <PaymentRegistrations />;
    if (page === "monitoring") return <Monitoring />;
    if (page === "audit")
      return (
        <ResourcePage
          title="Audit logs"
          resource="audit"
          columns={[
            col("actorId.name", "Actor"),
            col("action"),
            col("entityType", "Entity"),
            col("outcome"),
            col("reason"),
            col("occurredAt", "Time", "date"),
          ]}
        />
      );
    if (page === "gyms")
      return (
        <ResourcePage
          title="Gyms"
          resource="gyms"
          columns={[
            name,
            col("ownerId.name", "Owner"),
            col("address.city", "City"),
            col("platformSubscriptionStatus", "Platform plan"),
            status,
          ]}
          actions={(r) => (
            <Action
              path={`/api/v1/admin/gyms/${r.publicId}/${r.status === "SUSPENDED" ? "activate" : "suspend"}`}
              body={{ reason: "Administrator changed gym availability" }}
            >
              {r.status === "SUSPENDED" ? "Reactivate" : "Suspend"}
            </Action>
          )}
        />
      );
    if (page === "users" || page === "owners")
      return (
        <ResourcePage
          title={label(page)}
          resource={page}
          columns={[name, col("email"), col("phone"), status, created]}
        />
      );
    if (page === "platform-plans")
      return (
        <ResourcePage
          title="Platform plans"
          resource="platform-plans"
          columns={[
            name,
            col("code"),
            col("priceMinor", "Price", "money"),
            col("billingPeriod", "Period"),
            col("active", "Active"),
          ]}
          createPath="/api/v1/workspace/platform-plans"
          updatePath={(r) => `/api/v1/workspace/platform-plans/${r._id}`}
          fields={[
            field("name"),
            field("code"),
            select("billingPeriod", ["MONTHLY", "YEARLY"]),
            field("priceMinor", "Price (INR)", "money"),
            field("memberLimit", "Member limit", "number", false),
            field("staffLimit", "Staff limit", "number", false),
            field("features", "Features (one per line)", "lines", false),
            field("active", "Active", "checkbox", false),
          ]}
        />
      );
    if (page === "reviews")
      return (
        <ResourcePage
          title="Reviews"
          resource="reviews"
          columns={[
            col("gymId.name", "Gym"),
            col("userId.name", "Member"),
            col("rating"),
            col("body", "Review"),
            status,
          ]}
          actions={(r) => (
            <Action
              path={`/api/v1/workspace/reviews/${r.publicId}`}
              method="PATCH"
              body={{
                status: r.status === "PUBLISHED" ? "HIDDEN" : "PUBLISHED",
              }}
            >
              {r.status === "PUBLISHED" ? "Hide" : "Publish"}
            </Action>
          )}
        />
      );
    if (page === "whatsapp")
      return (
        <ResourcePage
          title="Campaign delivery"
          resource="campaigns"
          columns={[
            name,
            col("channel"),
            col("analytics.sent", "Sent"),
            col("analytics.failed", "Failed"),
            status,
          ]}
        />
      );
    if (page === "revenue") return <Dashboard />;
  }
  if (page === "ads")
    return (
      <ResourcePage
        title="Advertisements"
        resource="ads"
        columns={[
          name,
          col("budgetMinor", "Budget", "money"),
          col("spentMinor", "Spent", "money"),
          col("metrics.impressions", "Impressions"),
          status,
        ]}
        createPath={role === "owner" ? "/api/v1/owner/ads" : undefined}
        fields={[
          field("name"),
          field("description", "Description", "textarea", false),
          field("startsAt", "Starts", "datetime-local"),
          field("endsAt", "Ends", "datetime-local"),
          field("budgetMinor", "Budget (INR)", "money"),
        ]}
      />
    );
  return (
    <div className="state-card">
      <h1>Page not found</h1>
      <Link to="/">Back home</Link>
    </div>
  );
}

function DocumentLink({ id }: { id: string }) {
  const query = useData<Row>(`/api/v1/workspace/documents/${id}/url`, false);
  return query.data ? (
    <a
      className="btn btn-secondary"
      href={query.data.data.url}
      target="_blank"
      rel="noreferrer"
    >
      Open document
    </a>
  ) : (
    <>
      <button className="btn btn-secondary" onClick={() => query.refetch()}>
        Get document link
      </button>
      {query.isError && <small role="alert">{query.error.message}</small>}
    </>
  );
}
