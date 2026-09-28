import { PageHeader } from "../../components/PageHeader";
import { PageNavigationContext } from "../../components/pageNavigation";
import { lazy, Suspense, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, CalendarDays, CreditCard, Dumbbell, Flame, Gift, Heart, IdCard, Settings, UserRound, Users } from "lucide-react";
import { Avatar } from "../../components/Avatar";
import { InvoiceDownload } from "../../components/InvoiceDownload";
import { ThemePicker } from "../../components/ThemePicker";
import { PushNotificationSettings } from "../../components/PushNotificationSettings";
import { PwaSettings } from "../../components/PwaSettings";
import { Action, QueryState, ResourcePage, useData, type Row } from "../live/LiveData";
import { ProfileEditor } from "./ProfileEditor";
import { MemberSubscriptions } from "./MemberSubscriptions";
import { AttendancePage, type AttendanceSummary } from "./AttendancePage";
import { UserClassesPage } from "./UserClassesPage";
import "../../styles/account-hub.css";

const SocialProfilePage = lazy(() => import("./SocialProfilePage").then(module => ({ default: module.SocialProfilePage })));
const sections = [
  { id: "overview", label: "Overview", Icon: UserRound },
  { id: "membership", label: "Membership", Icon: IdCard },
  { id: "bookings", label: "Bookings", Icon: CalendarDays },
  { id: "payments", label: "Payments", Icon: CreditCard },
  { id: "attendance", label: "Attendance", Icon: Activity },
  { id: "workouts", label: "Workouts", Icon: Dumbbell },
  { id: "favorites", label: "Favorites", Icon: Heart },
  { id: "referrals", label: "Referrals", Icon: Gift },
  { id: "social", label: "Social", Icon: Users },
  { id: "settings", label: "Settings", Icon: Settings },
];
export function ProfilePayments() {
  return <ResourcePage title="Payments" resource="payments" columns={[
    { key: "publicId", title: "Reference" }, { key: "gymId.name", title: "Gym" },
    { key: "subscriptionId.planSnapshot.name", title: "Plan" }, { key: "amountMinor", title: "Amount", format: "money" },
    { key: "status", title: "Status", format: "status" }, { key: "capturedAt", title: "Paid", format: "date" },
  ]} actions={row => <InvoiceDownload payment={row as { publicId: string; status: string }} />} />;
}
function Favorites() {
  return <ResourcePage title="Favorite gyms" resource="favorites" columns={[
    { key: "gymId.name", title: "Gym", link: row => `/app/gyms/${encodeURIComponent(row.gymId?.slug || "")}` },
    { key: "gymId.address.city", title: "City" }, { key: "gymId.startingPriceMinor", title: "From", format: "money" },
  ]} actions={row => row.gymId?.publicId && <Action method="DELETE" path={`/api/v1/users/me/favorites/${row.gymId.publicId}`}>Remove favorite</Action>} />;
}
function Referrals() {
  return <ResourcePage title="Referrals" resource="referrals" columns={[
    { key: "code", title: "Referral code" }, { key: "status", title: "Status", format: "status" },
    { key: "rewardMinor", title: "Reward", format: "money" }, { key: "createdAt", title: "Created", format: "date" },
  ]} createPath="/api/v1/users/me/referrals" fields={[{ key: "code", label: "Referral code", required: true }]} />;
}
export function ProfileHub({ security }: { security?: ReactNode }) {
  const [params] = useSearchParams();
  const section = params.get("section") === "personal" || sections.some(item => item.id === params.get("section")) ? params.get("section")! : "overview";
  const query = useData<Row>("/api/v1/users/me"), user = query.data?.data;
  const memberships = useData<Row[]>("/api/v1/workspace/records/subscriptions?page=1&limit=5");
  const attendance = useData<{ summary: AttendanceSummary }>("/api/v1/users/me/attendance?limit=1");
  const summary = attendance.data?.data.summary;
  const membership = memberships.data?.data.find(row => row.status === "ACTIVE") || memberships.data?.data[0];
  return <div className="page-stack profile-hub">
    <PageHeader className="panel account-identity"><Avatar user={user} size={64} /><div><h1>{user?.name || "My profile"}</h1>{user?.social?.bio && <p className="account-bio">{user.social.bio}</p>}<p className="subtle">{membership ? `${membership.gymId?.name || "Your gym"} · ${membership.planSnapshot?.name || "Membership"} · ${membership.status.toLowerCase()}` : "Your personal fitness account"}</p>{summary && <Link className="account-header-streak" to="/app/profile?section=attendance"><Flame size={16} aria-hidden="true" />{summary.currentStreak} day streak · Longest {summary.longestStreak} days</Link>}</div><Link className="btn btn-secondary" to="/app/profile?section=personal">Edit profile</Link></PageHeader>
    <nav className="account-section-nav" aria-label="Profile sections">{sections.map(({ id, label, Icon }) => <Link key={id} to={`/app/profile?section=${id}`} aria-current={section === id ? "page" : undefined}><Icon size={19} aria-hidden="true" /><span>{label}</span></Link>)}</nav>
    <PageNavigationContext.Provider value={null}><section className="account-section" aria-label={section === "personal" ? "Personal details" : sections.find(item => item.id === section)?.label}>
      {section === "overview" && <div className="account-overview-grid">
        <section className="panel account-personal"><h2>Membership</h2><QueryState query={memberships}>{membership ? <><p><strong>{membership.gymId?.name || "Your gym"}</strong></p><p>{membership.planSnapshot?.name || "Membership"} · {membership.status}</p></> : <p>Find your gym and choose a membership to get started.</p>}</QueryState><Link className="btn btn-secondary" to="/app/profile?section=membership">View memberships</Link></section>
        <section className="panel account-personal"><h2>Your next session</h2><p>Browse classes, review your reservations and manage upcoming bookings.</p><Link className="btn btn-secondary" to="/app/profile?section=bookings">View bookings</Link></section>
        <section className="panel account-personal"><h2>Attendance & progress</h2><QueryState query={attendance}>{summary && <p>{summary.monthlyAttendance} attended days this month · {summary.totalAttendance} total days</p>}</QueryState><Link className="btn btn-secondary" to="/app/profile?section=attendance">Open streak calendar</Link></section>
        <section className="panel account-personal"><h2>Payments & invoices</h2><p>Review your payments and securely download invoices for confirmed payments.</p><Link className="btn btn-secondary" to="/app/profile?section=payments">View payment history</Link></section>
      </div>}
      {section === "personal" && <div className="panel account-personal"><h2>Personal details & profile photo</h2><QueryState query={query}>{user && <ProfileEditor user={user} onSaved={() => { void query.refetch(); }} />}</QueryState></div>}
      {section === "membership" && <><MemberSubscriptions /><Link className="btn btn-secondary" to="/app/profile?section=payments">View payment history</Link></>}
      {section === "bookings" && <UserClassesPage />}
      {section === "payments" && <ProfilePayments />}
      {section === "attendance" && <AttendancePage />}
      {section === "favorites" && <Favorites />}
      {section === "workouts" && <ResourcePage title="Your workouts" resource="workouts" columns={[
        { key: "planSnapshot.name", title: "Workout" }, { key: "planSnapshot.exercises", title: "Exercises" },
        { key: "startsAt", title: "Starts", format: "date" }, { key: "status", title: "Status", format: "status" },
      ]} />}
      {section === "referrals" && <Referrals />}
      {section === "social" && <Suspense fallback={<p role="status">Loading your social profile…</p>}><SocialProfilePage /></Suspense>}
      {section === "settings" && <div className="page-stack"><section className="panel account-personal"><h2>Appearance</h2><p>Choose Light or Dark. Your selection is saved to your account and this device.</p><ThemePicker /></section><PwaSettings /><PushNotificationSettings />{security}</div>}
    </section></PageNavigationContext.Provider>
  </div>;
}
