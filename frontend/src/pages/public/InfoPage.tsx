import {
  ArrowRight,
  CircleHelp,
  Mail,
  MessageCircle,
  ShieldCheck,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useData, type Row } from "../live/LiveData";

export function InfoPage({ type }: { type: "help" | "contact" }) {
  const location = useLocation();
  const settings = useData<Row>("/api/v1/public/settings");
  const workspace = /^\/(app|owner|trainer|admin)\//.exec(
    location.pathname,
  )?.[1];
  const supportPath = workspace
    ? `/${workspace}/support`
    : "/auth/login?returnTo=%2Fapp%2Fsupport";
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
