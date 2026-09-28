import {
  ArrowRight,
  CircleHelp,
  Mail,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useData, type Row } from "../live/LiveData";

export function InfoPage({ type }: { type: "help" | "contact" | "legal" }) {
  const { document } = useParams();
  const location = useLocation();
  const settings = useData<Row>("/api/v1/public/settings");
  const workspace = /^\/(app|owner|trainer|admin)\//.exec(
    location.pathname,
  )?.[1];
  const supportPath = workspace
    ? `/${workspace}/support`
    : "/auth/login?returnTo=%2Fapp%2Fsupport";
  if (type === "legal" && document !== "terms" && document !== "privacy") return <section className="container info-page"><h1>Page not found</h1><p>This legal document does not exist.</p><Link className="btn btn-secondary" to="/help">Open help center</Link></section>;
  if (type === "legal")
    return (
      <div className="container info-page">
        <span className="eyebrow">GETFIT4U legal</span>
        <h1>
          {document === "privacy" ? "Privacy notice" : "Terms of service"}
        </h1>
        <p className="info-lead">
          This preview shows the required legal-information structure. The
          production wording will be approved by GETFIT4U legal counsel before
          launch.
        </p>
        <div className="legal-copy panel">
          <h2>Clear information, respectful handling</h2>
          <p>
            GETFIT4U is designed to collect only information needed to operate
            accounts, memberships, attendance and support. Sensitive payment
            credentials remain with the authorized payment provider.
          </p>
          <h3>Account and membership information</h3>
          <p>
            We use account, gym and membership information to provide the
            service, protect access and maintain transaction histories.
          </p>
          <h3>Location and attendance</h3>
          <p>
            Location is used only when you request nearby discovery. Attendance
            records are gym-scoped and visible according to role permissions.
          </p>
          <h3>Your choices</h3>
          <p>
            Notification preferences, communication consent and eligible data
            requests are available from account settings.
          </p>
        </div>
      </div>
    );
  return (
    <div className="container info-page">
      <span className="eyebrow">
        {type === "help" ? "Help center" : "Contact GETFIT4U"}
      </span>
      <h1>
        {type === "help" ? "How can we help?" : "Talk to the right team."}
      </h1>
      <p className="info-lead">
        Get direct guidance for memberships, gym operations, payments or account
        access.
      </p>
      <div className="help-grid">
        {settings.data?.data.maintenanceNotice && (
          <p role="status" className="panel">
            {settings.data.data.maintenanceNotice}
          </p>
        )}
        <article className="panel">
          <span>
            <CircleHelp size={23} />
          </span>
          <h2>Member support</h2>
          <p>
            Questions about memberships, attendance, refunds or your profile.
          </p>
          <Link className="btn btn-secondary" to={supportPath}>
            Open support <ArrowRight size={17} />
          </Link>
        </article>
        <article className="panel">
          <span>
            <MessageCircle size={23} />
          </span>
          <h2>Gym Owner support</h2>
          <p>
            Onboarding, member operations, payments and communication tools.
          </p>
          <Link
            className="btn btn-secondary"
            to={workspace ? supportPath : "/register-gym"}
          >
            Owner help <ArrowRight size={17} />
          </Link>
        </article>
        <article className="panel">
          <span>
            <Mail size={23} />
          </span>
          <h2>Email</h2>
          <p>For general enquiries and documented follow-up.</p>
          {settings.data?.data.supportEmail ? (
            <a
              className="btn btn-secondary"
              href={`mailto:${settings.data.data.supportEmail}`}
            >
              {settings.data.data.supportEmail}
            </a>
          ) : (
            <Link className="btn btn-secondary" to={supportPath}>
              Message support
            </Link>
          )}
          {settings.data?.data.supportPhone && (
            <a
              className="btn btn-secondary"
              href={`tel:${settings.data.data.supportPhone}`}
            >
              {settings.data.data.supportPhone}
            </a>
          )}
          {settings.isError && (
            <p role="alert">
              Contact settings could not be loaded. You can still use support
              messaging.
            </p>
          )}
        </article>
      </div>
      <div className="privacy-note">
        <ShieldCheck size={18} /> Never share OTPs, UPI PINs or complete bank
        details with support.
      </div>
    </div>
  );
}
