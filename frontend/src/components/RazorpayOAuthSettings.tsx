import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ExternalLink, Landmark, ShieldCheck, Unplug } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import type { Row } from "../pages/live/LiveData";
import { StatusBadge } from "./StatusBadge";

export function RazorpayOAuthSettings({ gym, disabled = false }: { gym: Row; disabled?: boolean }) {
  const client = useQueryClient();
  const gymId = String(gym.publicId || gym.id || "");
  const query = useQuery({
    queryKey: ["owner-razorpay-oauth", gymId],
    queryFn: () => apiRequest<ApiEnvelope<Row>>(`/api/v1/gyms/${gymId}/payments/razorpay/status`),
    enabled: Boolean(gymId),
  });
  const connect = useMutation({
    mutationFn: () => apiRequest<ApiEnvelope<Row>>(`/api/v1/gyms/${gymId}/payments/razorpay/connect`, {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      body: JSON.stringify({ returnTo: `${window.location.pathname}${window.location.search}` }),
    }),
    onSuccess: response => {
      const authorizationUrl = response.data?.authorizationUrl;
      if (typeof authorizationUrl === "string") window.location.assign(authorizationUrl);
    },
  });
  const disconnect = useMutation({
    mutationFn: () => apiRequest<ApiEnvelope<Row>>(`/api/v1/gyms/${gymId}/payments/razorpay/disconnect`, {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      body: JSON.stringify({}),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["owner-razorpay-oauth", gymId] }),
  });
  const data = query.data?.data;
  const connection = data?.connection;
  const status = connection?.authorizationStatus || "NOT_CONNECTED";

  return (
    <section className="panel form-section page-stack payment-connection-settings">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Gym-owned Razorpay merchant</span>
          <h2>Membership payment connection</h2>
        </div>
        <StatusBadge status={status} />
      </div>
      <p>Membership orders are created directly in this gym's authorized Razorpay merchant account. GETFIT4U does not split, route, or deduct commission from these payments.</p>
      {query.isLoading && <p>Checking payment connection…</p>}
      {query.isError && <p className="form-alert" role="alert">{query.error.message}</p>}
      {data && <>
        <div className="metric-grid compact-metrics">
          <article className="metric-tile"><Landmark aria-hidden="true" /><span>Provider</span><strong>{data.provider}</strong><small>{data.environment}</small></article>
          <article className="metric-tile"><ShieldCheck aria-hidden="true" /><span>Online collection</span><strong>{data.onlineMembershipPaymentsAvailable ? "Enabled" : "Disabled"}</strong><small>{status.replaceAll("_", " ")}</small></article>
          <article className="metric-tile"><Landmark aria-hidden="true" /><span>Settlement readiness</span><strong>{connection?.settlementReadinessStatus || "Unknown"}</strong><small>Verified separately from consent</small></article>
        </div>
        {data.blockers?.length > 0 && <div className="form-alert" role="status">
          <strong><AlertTriangle size={18} aria-hidden="true" /> Setup required</strong>
          {data.blockers.map((blocker: string) => <p key={blocker}>{blocker}</p>)}
          <p>Offline membership collection remains available under the gym's existing rules.</p>
        </div>}
        {connection?.merchantAccountId && <p><strong>Merchant account:</strong> {`${connection.merchantAccountId.slice(0, 8)}…${connection.merchantAccountId.slice(-4)}`}</p>}
        <p><strong>GETFIT4U membership commission:</strong> 0. Razorpay processing fees and bank settlement remain the gym merchant's provider relationship.</p>
        <div className="page-actions">
          <button className="btn btn-primary" type="button" disabled={disabled || connect.isPending} onClick={() => connect.mutate()}>
            {connect.isPending ? "Opening Razorpay…" : status === "CONNECTED" ? "Reconnect Razorpay" : "Connect Razorpay"}
          </button>
          {status === "CONNECTED" && !data.onlineMembershipPaymentsAvailable && <a className="btn btn-secondary" href="https://dashboard.razorpay.com/" target="_blank" rel="noreferrer">Complete setup <ExternalLink size={16} aria-hidden="true" /></a>}
          {connection && !["DISCONNECTED", "REVOKED"].includes(status) && <button className="btn btn-secondary" type="button" disabled={disabled || disconnect.isPending} onClick={() => {
            if (window.confirm("Disconnect Razorpay for this gym? New online membership payments will stop.")) disconnect.mutate();
          }}><Unplug size={16} aria-hidden="true" /> {disconnect.isPending ? "Disconnecting…" : "Disconnect"}</button>}
        </div>
        {connect.isError && <p className="form-alert" role="alert">{connect.error.message}</p>}
        {disconnect.isError && <p className="form-alert" role="alert">{disconnect.error.message}</p>}
        {disconnect.isSuccess && <p role="status">Razorpay disconnected. Historical payments were preserved.</p>}
      </>}
    </section>
  );
}

