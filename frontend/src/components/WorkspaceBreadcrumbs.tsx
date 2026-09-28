import { ArrowLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { workspacePrefix } from "../services/authRedirect";
import { clearNavigationSession, navigationSessionKey } from "../services/navigationSession";
import "../styles/breadcrumbs.css";

const pages: Record<string, [string, string?]> = {
  home: ["Home"], dashboard: ["Dashboard"], members: ["Members", "member:read"],
  subscriptions: ["Subscriptions", "member:read"], attendance: ["Attendance", "member:read"],
  scanner: ["Gym QR", "attendance:scan"], plans: ["Plans", "gym:read"],
  classes: ["Classes", "gym:read"], trainers: ["Trainers", "gym:read"],
  payments: ["Payments", "finance:read"], revenue: ["Revenue", "finance:read"],
  "gym-profile": ["Gym Profile Settings", "gym:update"], offers: ["Offers", "campaign:write"],
  ads: ["Advertisements", "campaign:write"], messages: ["Messages"], notifications: ["Notifications"],
  support: ["Support"], profile: ["Profile"], explore: ["Explore gyms"], gyms: ["Gyms"],
  users: ["Users"], clients: ["Clients"], schedule: ["Schedule"], settings: ["Settings"],
  "platform-subscription": ["Platform subscription"], registrations: ["Registrations"],
  memberships: ["Memberships"], "membership-plans": ["Membership plans"], "platform-plans": ["Platform plans"],
  broadcasts: ["Broadcasts"], refunds: ["Refunds"], audit: ["Audit logs"], monitoring: ["Monitoring"],
};
const profileSections: Record<string, string> = { personal: "Edit profile", membership: "Membership", bookings: "Bookings", payments: "Payments", attendance: "Attendance", workouts: "Workouts", favorites: "Favorites", referrals: "Referrals", social: "Social", settings: "Settings" };
export function workspaceTrail(pathname: string, role: string, permissions: string[], search = "") {
  const prefix = workspacePrefix(role as Parameters<typeof workspacePrefix>[0]);
  const root = { label: role === "USER" ? "Home" : "Dashboard", href: `${prefix}/${role === "USER" ? "home" : "dashboard"}` };
  if (pathname === root.href || pathname === prefix) return [];
  const parts = pathname.split("/").filter(Boolean);
  if (pathname === "/profile" || pathname === `${prefix}/profile`) {
    const trail = [root, { label: "Profile", href: pathname }];
    const section = new URLSearchParams(search).get("section") || "";
    if (role === "USER" && profileSections[section]) trail.push({ label: profileSections[section], href: pathname + search });
    return trail;
  }
  if (pathname === "/platform-renewal") return [root, { label: "Platform subscription", href: pathname }];
  if (!pathname.startsWith(prefix + "/")) return [];
  const definition = pages[parts[1]];
  const canLink = !definition?.[1] || role === "ADMIN" || role === "USER" || role === "TRAINER" || permissions.includes(definition[1]);
  if (!definition || !canLink) return [];
  const trail = [root, { label: definition[0], href: `${prefix}/${parts[1]}` }];
  if (parts.length > 2) trail.push({ label: parts[1] === "attendance" && parts[2] === "qr" ? "Scan gym QR" : parts[1] === "profile" && profileSections[parts[2]] ? profileSections[parts[2]] : "Details", href: pathname });
  return trail;
}
const hasEdits = () => !!document.querySelector('[data-unsaved-changes="true"]');
export function WorkspaceBreadcrumbs({ role, permissions, navigationScope }: { role: string; permissions: string[]; navigationScope?: string }) {
  const location = useLocation(), navigate = useNavigate();
  const trail = workspaceTrail(location.pathname, role, permissions, location.search);
  useEffect(() => {
    const entry = trail.at(-1);
    if (navigationScope && entry && !location.pathname.endsWith("/profile") && location.pathname === entry.href && location.pathname.split("/").filter(Boolean).length === 2) {
      try { sessionStorage.setItem(navigationSessionKey(navigationScope, `list:${entry.href}`), location.pathname + location.search); } catch { /* Storage is optional. */ }
    }
  }, [location.pathname, location.search, role, navigationScope]);
  useEffect(() => {
    const changed = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const element = event.target;
      const form = element.closest("form");
      if (form && form.getAttribute("role") !== "search" && form.dataset.trackUnsaved !== "false" && form.querySelector('button[type="submit"],button:not([type]),input[type="submit"]')) form.dataset.unsavedChanges = "true";
    };
    const reset = (event: Event) => { if (event.target instanceof HTMLFormElement) delete event.target.dataset.unsavedChanges; };
    const unload = (event: BeforeUnloadEvent) => { if (hasEdits()) { event.preventDefault(); event.returnValue = ""; } };
    const authChanged = (event: Event) => { if ((event as CustomEvent).detail?.changedSession) clearNavigationSession(); };
    document.addEventListener("input", changed); document.addEventListener("change", changed); document.addEventListener("reset", reset); window.addEventListener("beforeunload", unload); window.addEventListener("gfu-auth", authChanged);
    return () => { document.removeEventListener("input", changed); document.removeEventListener("change", changed); document.removeEventListener("reset", reset); window.removeEventListener("beforeunload", unload); window.removeEventListener("gfu-auth", authChanged); };
  }, []);
  if (trail.length < 2) return null;
  function destination(href: string) {
    // Profile ancestors must open Overview, never the section currently being left.
    if (!navigationScope || href.endsWith("/profile")) return href;
    try {
      const saved = sessionStorage.getItem(navigationSessionKey(navigationScope, `list:${href}`));
      if (saved === href || saved?.startsWith(href + "?")) return saved;
    } catch { /* Parent links still work without storage. */ }
    return href;
  }
  function leave(event: { preventDefault: () => void }, href: string) {
    event.preventDefault();
    if (hasEdits() && !window.confirm("Leave this page and discard unsaved changes?")) return;
    document.querySelectorAll<HTMLElement>('[data-unsaved-changes="true"]').forEach(element => { delete element.dataset.unsavedChanges; });
    navigate(destination(href));
  }
  return <div className="workspace-breadcrumb-header">
    <button type="button" className="btn btn-ghost" onClick={event => leave(event, trail[trail.length - 2].href)}><ArrowLeft size={17} aria-hidden="true" />Back</button>
    <nav aria-label="Breadcrumb"><ol>{trail.map((entry, index) => <li key={entry.href}>
      {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
      {index === trail.length - 1 ? <span aria-current="page">{entry.label}</span> : <Link to={destination(entry.href)} onClick={event => leave(event, entry.href)}>{entry.label}</Link>}
    </li>)}</ol></nav>
  </div>;
}
