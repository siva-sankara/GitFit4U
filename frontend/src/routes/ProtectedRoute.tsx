import { useSession } from "../services/session";
import { authPath, canRegisterGym, isOwnerAccountDestination, loginDestination, needsOwnerOnboarding } from "../services/authRedirect";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { ApiError } from "../services/apiClient";
import { SessionFailure } from "./SessionFailure";
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const location = useLocation();
  const me = useSession();
  if (me.isPending)
    return <main className="state-card">Loading your account…</main>;
  if (me.isError) {
    if (me.error instanceof ApiError && me.error.status === 401)
      return (
        <Navigate
          to={authPath(
            "/login",
            location.pathname + location.search + location.hash,
          )}
          replace
          state={{ from: location.pathname + location.search + location.hash, sessionExpired: true }}
        />
      );
    return <SessionFailure error={me.error} retry={() => me.refetch()} />;
  }
  const identity = me.data.data;
  const registrationRoute = /^\/(?:register-gym|(?:app|owner|trainer|admin)\/onboarding)(?:\/|$)/.test(location.pathname);
  if (registrationRoute && !canRegisterGym(identity)) return <Navigate to={loginDestination(identity)} replace />;
  if (needsOwnerOnboarding(identity) && !registrationRoute && !isOwnerAccountDestination(location.pathname) && /^\/(?:owner|app|trainer|admin)(?:\/|$)/.test(location.pathname))
    return <Navigate to={loginDestination(identity)} replace />;
  const role = identity.context.role,
    prefix = location.pathname.split("/")[1];
  const allowed =
    prefix === "app"
      ? role === "USER"
      : prefix === "owner"
        ? ["GYM_OWNER", "GYM_STAFF"].includes(role)
        : prefix === "trainer"
          ? role === "TRAINER"
          : prefix === "admin"
            ? role === "ADMIN"
            : true;
  if (!allowed) return <Navigate to={loginDestination(identity)} replace />;
  return <>{children}</>;
}
