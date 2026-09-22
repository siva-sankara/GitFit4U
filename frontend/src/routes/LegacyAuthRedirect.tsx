import { Navigate, useLocation } from "react-router-dom";

/** Replace legacy bookmarks without losing a selected gym, plan or OTP return path. */
export function LegacyAuthRedirect({ to }: { to: "/login" | "/register" }) {
  const location = useLocation();
  return (
    <Navigate
      to={to + location.search + location.hash}
      state={location.state}
      replace
    />
  );
}
