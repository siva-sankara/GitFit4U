import { loginDestination, workspacePrefix } from "../services/authRedirect";
import "../styles/workspace-navigation.css";
import {
  Bell,
  Menu,
  X,
  LayoutDashboard,
  Users,
  Dumbbell,
  Activity,
  CalendarDays,
  Settings,
  MessageCircle,
  ShieldCheck,
  Building2,
  LogOut,
  Compass,
  UserRound,
  LifeBuoy,
} from "lucide-react";
import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Brand } from "../components/Brand";
import { Avatar } from "../components/Avatar";
import { GymIdentity } from "../components/GymIdentity";
import { ThemePicker } from "../components/ThemePicker";
import { useData, type Row } from "../pages/live/LiveData";
import { useApp } from "../context/AppContext";
import { useCurrentUser, useNotifications } from "../api/hooks";
import { apiRequest, setAccessToken } from "../services/apiClient";
import type { Role } from "../types";
const navigation: Record<string, Array<[string, string, string?]>> = {
  USER: [
    ["Home", "home"],
    ["Explore gyms", "explore"],
    ["Attendance", "attendance"],
    ["Scan gym QR", "attendance/qr"],
    ["Classes", "classes"],
    ["Notifications", "notifications"],
    ["Messages", "messages"],
    ["Support", "support"],
  ],
  GYM_OWNER: [
    ["Dashboard", "dashboard", "gym:read"],
    ["Gym Profile Settings", "gym-profile", "gym:update"],
    ["Members", "members", "member:read"],
    ["Plans", "plans", "gym:read"],
    ["Subscriptions", "subscriptions", "member:read"],
    ["Attendance", "attendance", "member:read"],
    ["Gym QR", "scanner", "attendance:scan"],
    ["Classes", "classes", "gym:read"],
    ["Trainers", "trainers", "gym:read"],
    ["Payments", "payments", "finance:read"],
    ["Revenue", "revenue", "finance:read"],
    // Temporarily hidden; their existing routes remain available by permission.
    // ["Invoices", "invoices", "finance:read"],
    // ["Campaigns", "campaigns", "campaign:write"],
    ["Offers", "offers", "campaign:write"],
    ["Advertisements", "ads", "campaign:write"],
    ["Messages", "messages"],
    ["Notifications", "notifications"],
    ["Support", "support"],
  ],
  TRAINER: [
    ["Dashboard", "dashboard"],
    ["Clients", "clients"],
    ["Schedule", "schedule"],
    ["Workout plans", "workout-plans"],
    ["Progress", "progress"],
    ["Attendance", "attendance"],
    ["Messages", "messages"],
    ["Notifications", "notifications"],
    ["Support", "support"],
  ],
  ADMIN: [
    ["Dashboard", "dashboard"],
    ["Registrations", "registrations"],
    ["Gyms", "gyms"],
    ["Owners", "owners"],
    ["Trainers", "trainers"],
    ["Members", "members"],
    ["Membership plans", "membership-plans"],
    ["Memberships", "memberships"],
    ["Users", "users"],
    ["Platform plans", "platform-plans"],
    ["Subscriptions", "subscriptions"],
    ["Payments", "payments"],
    ["Invoices", "invoices"],
    ["Refunds", "refunds"],
    ["Campaigns", "whatsapp"],
    ["Advertisements", "ads"],
    ["Offers", "offers"],
    ["Reviews", "reviews"],
    ["Monitoring", "monitoring"],
    ["Audit logs", "audit"],
    ["Support", "support"],
    ["Notifications", "notifications"],
    ["Broadcasts", "broadcasts"],
    ["Notification delivery", "notification-delivery"],
    ["Settings", "settings"],
  ],
};
export function WorkspaceLayout() {
  const [drawer, setDrawer] = useState(false),
    { toast, toastActionUrl, dismissToast } = useApp(),
    me = useCurrentUser(),
    notifications = useNotifications(),
    client = useQueryClient(),
    navigate = useNavigate(),
    location = useLocation();
  const user = me.data?.data.user,
    context = me.data?.data.context,
    assignments = me.data?.data.assignments || [];
  const activeRole = context?.role || "USER";
  const role: Role = activeRole === "GYM_STAFF" ? "GYM_OWNER" : activeRole;
  const prefix = workspacePrefix(activeRole);
  const rows = navigation[role].filter(
    ([, , permission]) =>
      !permission || context?.permissions.includes(permission),
  );
  const title =
    rows.find(([, page]) => location.pathname === `${prefix}/${page}`)?.[0] ||
    (location.pathname === "/profile" ||
    location.pathname === `${prefix}/profile`
      ? "My profile"
      : "GETFIT4U");
  const mobileChoices = role === "USER"
    ? [["Home", "home", LayoutDashboard], ["Explore", "explore", Compass], ["Attendance", "attendance", Activity], ["Messages", "messages", MessageCircle], ["Profile", "profile", UserRound]] as const
    : role === "GYM_OWNER"
      ? [["Dashboard", "dashboard", LayoutDashboard], ["Members", "members", Users], ["Attendance", "attendance", Activity], ["Messages", "messages", MessageCircle]] as const
      : role === "TRAINER"
        ? [["Dashboard", "dashboard", LayoutDashboard], ["Clients", "clients", Users], ["Schedule", "schedule", CalendarDays], ["Messages", "messages", MessageCircle]] as const
        : [["Dashboard", "dashboard", LayoutDashboard], ["Gyms", "gyms", Building2], ["Users", "users", Users], ["Support", "support", LifeBuoy]] as const;
  const mobileRows = mobileChoices.filter(([, page]) => page === "profile" || rows.some(([, route]) => route === page));
  const ownerGym = useData<Row>(
    "/api/v1/owner/gym",
    role === "GYM_OWNER" &&
      !!context?.gymId &&
      !!context.permissions.includes("gym:read"),
  );
  const gym =
    role === "GYM_OWNER" && String(ownerGym.data?.data?._id) === context?.gymId
      ? ownerGym.data?.data
      : assignments.find((a) => a.gymId?._id === context?.gymId)?.gymId;
  const roleLabel =
    activeRole === "USER"
      ? "Member"
      : activeRole === "GYM_STAFF"
        ? "Gym staff"
        : activeRole === "GYM_OWNER"
          ? "Gym owner"
          : activeRole === "ADMIN"
            ? "Administrator"
            : "Trainer";
  const unread =
    notifications.data?.data.filter((notification) => !notification.readAt)
      .length || 0;
  useEffect(() => {
    setDrawer(false);
  }, [location.pathname, location.search]);
  useEffect(() => {
    if (!drawer) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawer(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [drawer]);
  const logout = useMutation({
    mutationFn: () => apiRequest("/api/v1/auth/logout", { method: "POST" }),
    onSuccess: () => {
      setAccessToken(null);
      client.clear();
      navigate("/login", { replace: true });
    },
  });
  return (
    <div className="workspace">
      <a href="#workspace-content" className="skip-link">
        Skip to content
      </a>
      {drawer && (
        <button
          className="drawer-scrim"
          aria-label="Close navigation"
          onClick={() => setDrawer(false)}
        />
      )}
      <aside className={drawer ? "sidebar drawer-open" : "sidebar"}>
        <div className="sidebar-head">
          <Brand to={loginDestination(role)} />
          <button
            className="icon-btn drawer-close"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
          >
            <X />
          </button>
        </div>
        <div className="sidebar-access">
          {gym ? (
            <GymIdentity
              name={gym.name}
              logoUrl={gym.logoUrl}
              subtitle={roleLabel}
            />
          ) : (
            <>
              <strong>GETFIT4U</strong>
              <span>{roleLabel}</span>
            </>
          )}
        </div>
        <nav className="sidebar-nav" aria-label="Workspace navigation">
          {rows.map(([text, page], i) => (
            <NavLink
              key={page}
              title={text}
              aria-label={text}
              to={`${prefix}/${page}`}
              onClick={() => setDrawer(false)}
            >
              {i === 0 ? (
                <LayoutDashboard size={19} />
              ) : page === "members" || page === "clients" ? (
                <Users size={19} />
              ) : page === "classes" ? (
                <CalendarDays size={19} />
              ) : page === "attendance" ? (
                <Activity size={19} />
              ) : page === "messages" ? (
                <MessageCircle size={19} />
              ) : page === "settings" ? (
                <Settings size={19} />
              ) : (
                <Dumbbell size={19} />
              )}
              <span>{text}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <NavLink
            to="/register-gym"
            title="Register a gym"
            aria-label="Register a gym"
          >
            <Building2 size={20} />
            <span>Register a gym</span>
          </NavLink>
          <NavLink
            to="/profile"
            className="sidebar-profile"
            aria-label={`Open profile for ${user?.name || "Member"}`}
            title={user?.name || "My profile"}
          >
            <Avatar user={user} size={36} />
            <span className="profile-name">
              <strong>{user?.name || "Member"}</strong>
              <small>My profile</small>
            </span>
          </NavLink>
          <button
            className="btn btn-secondary sidebar-logout"
            aria-label="Log out"
            title="Log out"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            <LogOut size={18} />
            <span>{logout.isPending ? "Logging out..." : "Log out"}</span>
          </button>
          {logout.isError && <p role="alert">{logout.error.message}</p>}
        </div>
      </aside>
      <div className="workspace-main">
        <header className="workspace-topbar">
          <button
            className="icon-btn drawer-toggle"
            aria-label="Open menu"
            aria-expanded={drawer}
            onClick={() => setDrawer(true)}
          >
            <Menu />
          </button>
          <div className="topbar-title">
            <span className="subtle">{gym?.name || "GETFIT4U"}</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <ThemePicker />
            <button
              className="icon-btn workspace-notification-button"
              aria-label="Notifications"
              onClick={() => navigate(`${prefix}/notifications`)}
            >
              <Bell />
              {unread > 0 && (
                <span
                  className="workspace-unread-count"
                  aria-label={`${unread} unread notifications`}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
            <NavLink
              to="/profile"
              className="topbar-profile"
              aria-label={`Open profile for ${user?.name || "Member"}`}
              title="My profile"
            >
              <Avatar user={user} size={32} />
              <strong>{user?.name || "Member"}</strong>
            </NavLink>
          </div>
        </header>
        <main id="workspace-content" className="workspace-content">
          {role === "GYM_OWNER" && gym?.logoUrl && (
            <img
              className="gym-watermark"
              src={gym.logoUrl}
              alt=""
              aria-hidden="true"
            />
          )}
          <Outlet />
        </main>
      </div>
      <nav className="mobile-bottom-nav" aria-label="Mobile navigation">
        {mobileRows.map(([text, page, Icon]) => (
          <NavLink key={page} to={`${prefix}/${page}`} className={({ isActive }) => isActive || (page === "profile" && location.pathname === "/profile") ? "active" : undefined} aria-label={text}>
            <Icon size={21} aria-hidden="true" />
            <span>{text}</span>
          </NavLink>
        ))}
        {role !== "USER" && <button type="button" aria-label="More navigation" aria-expanded={drawer} onClick={() => setDrawer(value => !value)}><Menu size={21} aria-hidden="true" /><span>More</span></button>}
      </nav>
      {toast && (
        <div className="toast" role="status" aria-live="polite">
          <ShieldCheck aria-hidden="true" />
          <span>{toast}</span>
          {toastActionUrl && (
            <NavLink className="btn btn-secondary" to={toastActionUrl} onClick={dismissToast}>
              Open notification
            </NavLink>
          )}
          <button type="button" className="btn btn-secondary" aria-label="Dismiss notification" onClick={dismissToast}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
    </div>
  );
}
