import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "../../api/hooks";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { StatusBadge } from "../../components/StatusBadge";
import type { Row } from "../live/LiveData";

export function PaymentReturnPage() {
  const [params] = useSearchParams();
  const me = useCurrentUser();
  const paymentId = params.get("paymentId") || sessionStorage.getItem("getfit4u.pendingPaymentId") || "";
  const payment = useQuery({
    queryKey: ["payment-return", paymentId],
    enabled: Boolean(paymentId),
    queryFn: () => apiRequest<ApiEnvelope<Row>>(`/api/v1/checkout/payments/${encodeURIComponent(paymentId)}`),
    retry: 2,
    refetchInterval: (query) =>
      ["CAPTURED", "FAILED", "CANCELLED", "REFUNDED"].includes(
        (query.state.data as ApiEnvelope<Row> | undefined)?.data.status || "",
      )
        ? false
        : 3_000,
  });
  const status = payment.data?.data.status || "PENDING";
  const role = me.data?.data.context?.role;
  const destination = role === "GYM_OWNER" ? "/owner/platform-subscription" : "/app/subscriptions";
  if (!paymentId)
    return <main className="state-card"><h1>Payment reference missing</h1><p>Return to your dashboard and reopen the payment.</p><Link className="btn btn-primary" to={destination}>Go to dashboard</Link></main>;
  return (
    <main className="state-card page-stack" aria-live="polite">
      <span className="eyebrow">Secure payment return</span>
      <h1>{status === "CAPTURED" ? "Payment confirmed" : status === "FAILED" ? "Payment was not completed" : "Checking payment status"}</h1>
      <StatusBadge status={status} />
      {payment.isLoading && <p>Checking the Razorpay payment with GETFIT4U…</p>}
      {!["CAPTURED", "FAILED", "CANCELLED", "REFUNDED"].includes(status) && !payment.isError && (
        <p>You may safely keep this screen open. A browser redirect alone never activates a purchase.</p>
      )}
      {status === "CAPTURED" && <p>Your verified purchase has been recorded and its entitlement has been applied.</p>}
      {status === "FAILED" && <p>No entitlement was applied. Reopen the checkout to review the current order before retrying.</p>}
      {payment.isError && <p role="alert">We could not confirm the provider status yet. Do not start another payment until this reference is reconciled.</p>}
      <p className="subtle">Payment reference: {paymentId}</p>
      <div className="heading-actions">
        <button className="btn btn-secondary" type="button" disabled={payment.isFetching} onClick={() => payment.refetch()}>Refresh status</button>
        <Link className="btn btn-primary" to={destination}>Continue</Link>
      </div>
    </main>
  );
}
