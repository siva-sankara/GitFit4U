import { Navigate } from "react-router-dom";
import { useCurrentUser } from "../../api/hooks";
export function NotificationInboxRedirect({
  destination = "notifications",
}: {
  destination?: "notifications" | "messages";
}) {
  const me = useCurrentUser();
  const role = me.data?.data.context?.role;
  if (!role) return <p className="state-card">Loading notifications?</p>;
  const prefix =
    role === "ADMIN"
      ? "admin"
      : role === "TRAINER"
        ? "trainer"
        : ["GYM_OWNER", "GYM_STAFF"].includes(role)
          ? "owner"
          : "app";
  return <Navigate to={`/${prefix}/${destination}`} replace />;
}
