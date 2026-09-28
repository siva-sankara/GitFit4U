import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { getAccessToken } from "../services/apiClient";
import { useSession } from "../services/session";
import {
  loginDestination,
  safeReturnTo,
  workspacePath,
} from "../services/authRedirect";
export function GuestRoute({
  children,
  auth = false,
}: {
  children: ReactNode;
  auth?: boolean;
}) {
  const session = useSession({ publicPage: true }),
    location = useLocation();
  // This is a public-page redirect, not an authorization boundary. A slow or
  // unavailable session endpoint must not replace public content with an error.
  if (!getAccessToken() || !session.data || session.isError)
    return <>{children}</>;
  const identity = session.data.data;
  const from =
    safeReturnTo(new URLSearchParams(location.search).get("returnTo")) ||
    safeReturnTo(location.state?.from);
  const destination = auth
    ? loginDestination(identity, from)
    : workspacePath(identity, location.pathname + location.search + location.hash);
  return <Navigate to={destination} replace />;
}
