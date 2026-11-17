import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { useRazorpayConnect } from "../../services/razorpayConnection";

interface AttemptResult { status: string; connected: boolean; gymId: string; gymName: string; requestId?: string }
export function RazorpayConnectionResult() {
  const [params] = useSearchParams();
  const reference = params.get("reference") || "";
  const hasReference = /^[A-Za-z0-9_-]{24}$/.test(reference);
  const attempt = useQuery({
    queryKey: ["razorpay-connection-attempt", reference],
    queryFn: () => apiRequest<ApiEnvelope<AttemptResult>>(`/api/v1/payments/razorpay/oauth/attempts/${reference}`),
    enabled: hasReference, retry: false, gcTime: 0,
    refetchInterval: query => !query.state.error && query.state.data?.data.status === "PROCESSING" ? 2000 : false,
  });
  const gym = useQuery({
    queryKey: ["razorpay-retry-gym"],
    queryFn: () => apiRequest<ApiEnvelope<{ publicId: string; name: string }>>("/api/v1/owner/gym"),
    retry: false, gcTime: 0,
  });
  const data = attempt.data?.data;
  const connected = !attempt.isError && data?.connected === true;
  const processing = !attempt.isError && data?.status === "PROCESSING";
  const loading = (hasReference && attempt.isLoading) || gym.isLoading;
  const gymId = data?.gymId || gym.data?.data.publicId || "";
  const connect = useRazorpayConnect(gymId);
  const requestId = data?.requestId || params.get("requestId") || "";
  return <main className="state-card page-stack" aria-live="polite">
    <span className="eyebrow">Razorpay connection</span>
    <h1>{loading ? "Checking your connection" : connected ? "Razorpay connected" : processing ? "Connection verification in progress" : "Razorpay connection not completed"}</h1>
    {(data?.gymName || gym.data?.data.name) && <p>{data?.gymName || gym.data?.data.name}</p>}
    {connected ? <p>Your gym's Razorpay account is connected. Online collection and settlement readiness are checked separately.</p>
      : processing ? <p>We are checking this attempt. Wait for the result before starting another connection.</p>
      : !loading && <p>{data?.status === "DENIED" || params.get("status") === "denied"
        ? "Authorization was cancelled. You can connect again when ready."
        : "We could not verify this connection attempt. Connect again to start a fresh authorization."}</p>}
    {attempt.isError && <p role="alert">This attempt could not be verified for your current gym and session. Check the selected gym in payment settings.</p>}
    {gym.isError && <p role="alert">Sign in as the gym owner and open payment settings to reconnect.</p>}
    {connect.isError && <p className="form-alert" role="alert">{connect.error?.message}</p>}
    {/^[A-Za-z0-9_.-]{1,128}$/.test(requestId) && <p className="subtle">Support reference: {requestId}</p>}
    <div className="page-actions">
      {!connected && <button className="btn btn-primary" type="button" disabled={loading || processing || !gymId || connect.isPending} onClick={connect.start}>
        {connect.isPending ? "Opening Razorpay…" : "Connect again"}
      </button>}
      <Link className="btn btn-secondary" to="/owner/settings">Back to payment settings</Link>
    </div>
  </main>;
}
