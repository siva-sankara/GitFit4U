import { PageHeader } from "../../components/PageHeader";
import { Link } from "react-router-dom";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useCurrentUser } from "../../api/hooks";
import { StatusBadge } from "../../components/StatusBadge";
import { gymDate } from "../../components/MembershipStatusDot";
import { QueryState, useData, money, type Row } from "../live/LiveData";
import { RevenueAnalytics } from "./RevenuePage";
import "../../styles/member-management.css";

export function OwnerDashboardPage() {
  const me = useCurrentUser(),
    permissions = me.data?.data.context.permissions || [];
  const finance = permissions.includes("finance:read");
  const stats = useData<Row>("/api/v1/owner/dashboard");
  const summary = useData<Row>("/api/v1/workspace/summary", finance);
  const data = stats.data?.data,
    subscription = data?.platformSubscription;
  const nearExpiry =
    subscription?.daysRemaining !== null && subscription?.daysRemaining <= 30;
  const metrics = [
    ["totalMembers", "Members"],
    ["activeMembers", "Active members"],
    ["expiringMemberships", "Expiring in 7 days"],
    ["todayAttendance", "Today's check-ins"],
    ["classesToday", "Today's classes"],
    ...(finance ? [["monthlyRevenueMinor", "This month's net revenue"]] : []),
  ];
  return (
    <div className="page-stack owner-dashboard">
      <PageHeader>
        <div>
          <span className="eyebrow">Gym overview</span>
          <h1>Welcome, {me.data?.data.user.name || "gym team"}</h1>
          <p>Memberships, attendance and your gym's performance.</p>
        </div>
      </PageHeader>
      
      <QueryState query={stats}>
        {data && (
          <>
            <section className="owner-status-grid">
              <article className="panel owner-status-card">
                <h2>Gym status</h2>
                <StatusBadge status={data.gymStatus} />
                <p>
                  {data.gymStatus === "ACTIVE"
                    ? "Your gym is active."
                    : "Your gym is not currently active."}
                </p>
                <Link to="/owner/settings">Gym profile settings</Link>
                {data.gymStatus !== "ACTIVE" && (
                  <Link to="/register-gym">Review registration</Link>
                )}
              </article>
              {subscription && (
                <article
                  className={`panel owner-status-card${nearExpiry ? " subscription-expiring" : ""}`}
                >
                  <header>
                    <h2>Platform subscription</h2>
                    <StatusBadge status={subscription.status} />
                  </header>
                  <strong>{subscription.plan?.name}</strong>
                  <dl className="member-summary-grid">
                    <div>
                      <dt>Member usage</dt>
                      <dd>
                        {subscription.usage.members} /{" "}
                        {subscription.usage.memberLimit ?? "Unlimited"}
                      </dd>
                    </div>
                    <div>
                      <dt>Expiry</dt>
                      <dd>{gymDate(subscription.endsAt, data.timezone)}</dd>
                    </div>
                    <div>
                      <dt>Days remaining</dt>
                      <dd>
                        {subscription.daysRemaining === null
                          ? "Not set"
                          : Math.max(0, subscription.daysRemaining)}
                      </dd>
                    </div>
                  </dl>
                  {subscription.usage.memberLimit > 0 && (
                    <progress
                      aria-label="Member limit usage"
                      max={subscription.usage.memberLimit}
                      value={subscription.usage.members}
                    />
                  )}
                  {nearExpiry && (
                    <p>
                      {subscription.daysRemaining < 0
                        ? "Your platform subscription has expired."
                        : `Your platform subscription expires ${subscription.daysRemaining === 0 ? "today" : `in ${subscription.daysRemaining} days`}.`}
                    </p>
                  )}
                  
                  <Link
                    className="btn btn-secondary"
                    to={subscription.renewalUrl}
                  >
                    {subscription.canRenew && nearExpiry
                      ? "Renew subscription"
                      : "View subscription"}
                  </Link>
                </article>
              )}
            </section>
            <div className="heading-actions">
        {permissions.includes("attendance:scan") && (
          <Link className="btn btn-primary" to="/owner/scanner">
            View gym QR
          </Link>
        )}
        {permissions.includes("member:read") && (
          <Link className="btn btn-secondary" to="/owner/members">
            Manage members
          </Link>
        )}
        {/* {permissions.includes("gym:read") && (
          <Link className="btn btn-secondary" to="/owner/classes">
            Classes
          </Link>
        )} */}
      </div>
            <section className="stat-grid">
              {metrics.map(([key, label]) => (
                <article className="panel metric-tile" key={key}>
                  <span>{label}</span>
                  <strong>
                    {key.endsWith("Minor")
                      ? money(data[key] || 0)
                      : data[key] || 0}
                  </strong>
                </article>
              ))}
            </section>
          </>
        )}
      </QueryState>
      
      {finance && (
        <>
          <RevenueAnalytics embedded />
          <QueryState query={summary}>
            <section className="panel chart-card">
              <h2>Daily check-ins</h2>
              <p>Last six months</p>
              {summary.data?.data.visits?.length ? (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={summary.data.data.visits}>
                    <XAxis dataKey="_id" />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="visits" fill="var(--brand-strong)" />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <p>No attendance recorded in this period.</p>
              )}
            </section>
          </QueryState>
        </>
      )}
    </div>
  );
}
