import { Navigate, useLocation, useParams } from "react-router-dom";
import { useCurrentUser } from "../../api/hooks";
export function NotificationInboxRedirect({
  destination = "notifications",
}: {
  destination?: "notifications" | "messages";
}) {
  const me = useCurrentUser();
  const location = useLocation(), params = useParams();
  const role = me.data?.data.context?.role;
  if (!role) return <p className="state-card">Opening your workspace…</p>;
  const prefix =
    role === "ADMIN"
      ? "admin"
      : role === "TRAINER"
        ? "trainer"
        : ["GYM_OWNER", "GYM_STAFF"].includes(role)
          ? "owner"
          : "app";
  const search = new URLSearchParams(location.search);
  if (destination === "messages" && params.conversationId) search.set("conversation", params.conversationId);
  return <Navigate to={`/${prefix}/${destination}${search.size ? `?${search}` : ""}`} state={location.state} replace />;
}
