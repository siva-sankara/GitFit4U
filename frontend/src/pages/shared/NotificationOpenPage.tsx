import { useQuery } from "@tanstack/react-query";
import { Link, Navigate, useParams } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { safeReturnTo } from "../../services/authRedirect";
import { useCurrentUser } from "../../api/hooks";

export function NotificationOpenPage() {
  const { id = "" } = useParams(), me = useCurrentUser();
  const valid = /^[a-f\d]{24}$/i.test(id);
  const result = useQuery({
    queryKey: ["notification-destination", id, me.data?.data.user._id],
    queryFn: () => apiRequest<ApiEnvelope<{ path: string; available: boolean; explanation?: string }>>(
      `/api/v1/users/me/notifications/${id}/open`, { method: "POST" }),
    enabled: valid && Boolean(me.data?.data.user._id), retry: false,
  });
  const destination = result.data?.data;
  if (destination?.available && safeReturnTo(destination.path) && !destination.path.startsWith("/notification-open"))
    return <Navigate to={destination.path} replace />;
  return <main className="state-card" aria-live="polite">
    {result.isPending && valid ? <p>Opening your update…</p> : <>
      <h1>Notification unavailable</h1>
      <p>{destination?.explanation || result.error?.message || "This notification link is invalid."}</p>
      {result.isError && <button className="btn btn-secondary" onClick={() => void result.refetch()}>Retry</button>}
      <Link className="btn btn-primary" to="/notifications">Open your inbox</Link>
    </>}
  </main>;
}
