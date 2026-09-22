import { useSession } from "../services/session";
import { authPath, loginDestination } from "../services/authRedirect";
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
          state={{ from: location.pathname + location.search + location.hash }}
        />
      );
    return <SessionFailure error={me.error} retry={() => me.refetch()} />;
  }
  const role = me.data.data.context.role,
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
  if (!allowed) return <Navigate to={loginDestination(role)} replace />;
  return <>{children}</>;
}
