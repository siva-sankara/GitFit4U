import { lazy, Suspense, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, CreditCard, Dumbbell, Gift, Heart, IdCard, Settings, UserRound, Users } from "lucide-react";
import { Avatar } from "../../components/Avatar";
import { InvoiceDownload } from "../../components/InvoiceDownload";
import { ThemePicker } from "../../components/ThemePicker";
import { PushNotificationSettings } from "../../components/PushNotificationSettings";
import { Action, QueryState, ResourcePage, useData, type Row } from "../live/LiveData";
import { ProfileEditor } from "./ProfileEditor";
import { MemberSubscriptions } from "./MemberSubscriptions";
import { AttendancePage } from "./AttendancePage";
import "../../styles/account-hub.css";

const SocialProfilePage = lazy(() => import("./SocialProfilePage").then(module => ({ default: module.SocialProfilePage })));
const sections = [
  { id: "personal", label: "Personal details", Icon: UserRound },
  { id: "membership", label: "Membership & subscriptions", Icon: IdCard },
  { id: "payments", label: "Payments", Icon: CreditCard },
  { id: "attendance", label: "Attendance & streaks", Icon: Activity },
  { id: "favorites", label: "Favorites", Icon: Heart },
  { id: "workouts", label: "Workouts", Icon: Dumbbell },
  { id: "referrals", label: "Referrals", Icon: Gift },
  { id: "social", label: "Posts, stories & connections", Icon: Users },
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
  const section = sections.some(item => item.id === params.get("section")) ? params.get("section")! : "personal";
  const query = useData<Row>("/api/v1/users/me"), user = query.data?.data;
  return <div className="page-stack profile-hub">
    <header className="panel account-identity"><Avatar user={user} size={64} /><div><h1>My profile</h1><p>{user?.name || "Your personal fitness account"}</p></div><Link className="btn btn-secondary" to="/app/attendance/qr">Scan gym QR</Link></header>
    <nav className="account-section-nav" aria-label="Profile sections">{sections.map(({ id, label, Icon }) => <Link key={id} to={`/app/profile?section=${id}`} aria-current={section === id ? "page" : undefined}><Icon size={19} aria-hidden="true" /><span>{label}</span></Link>)}</nav>
    <section className="account-section" aria-label={sections.find(item => item.id === section)?.label}>
      {section === "personal" && <div className="panel account-personal"><h2>Personal details & profile photo</h2><QueryState query={query}>{user && <ProfileEditor user={user} onSaved={() => { void query.refetch(); }} />}</QueryState></div>}
      {section === "membership" && <><MemberSubscriptions /><Link className="btn btn-secondary" to="/app/profile?section=payments">View payment history</Link></>}
      {section === "payments" && <ProfilePayments />}
      {section === "attendance" && <AttendancePage />}
      {section === "favorites" && <Favorites />}
      {section === "workouts" && <ResourcePage title="Your workouts" resource="workouts" columns={[
        { key: "planSnapshot.name", title: "Workout" }, { key: "planSnapshot.exercises", title: "Exercises" },
        { key: "startsAt", title: "Starts", format: "date" }, { key: "status", title: "Status", format: "status" },
      ]} />}
      {section === "referrals" && <Referrals />}
      {section === "social" && <Suspense fallback={<p role="status">Loading your social profile…</p>}><SocialProfilePage /></Suspense>}
      {section === "settings" && <div className="page-stack"><section className="panel account-personal"><h2>Appearance</h2><p>System follows your device’s light or dark preference.</p><ThemePicker /></section><PushNotificationSettings />{security}</div>}
    </section>
  </div>;
}
