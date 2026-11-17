import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "../../api/hooks";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { StatusBadge } from "../../components/StatusBadge";
import type { Row } from "../live/LiveData";
import { navigationSessionScope } from "../../services/navigationSession";
import { MembershipWhatsAppUpdates, WhatsAppInvitationCard } from "../../components/MembershipWhatsAppUpdates";
import { GymIdentity } from "../../components/GymIdentity";
import { InvoiceDownload } from "../../components/InvoiceDownload";
import type { MemberSubscription } from "../user/MemberSubscriptions";

function MembershipSummary({ id }: { id: string }) {
  const me = useCurrentUser().data?.data;
  const query = useQuery({
    queryKey: ["payment-membership", navigationSessionScope(me?.context), me?.user?._id, id],
    queryFn: ({ signal }) => apiRequest<ApiEnvelope<MemberSubscription>>(`/api/v1/users/me/subscriptions/${encodeURIComponent(id)}`, { signal }),
    enabled: Boolean(me?.user?._id), gcTime: 0,
  });
  const membership = query.data?.data;
  return <>
    {membership && <><GymIdentity name={membership.gymId?.name || "Your gym"} logoUrl={membership.gymId?.logoUrl} subtitle={membership.planSnapshot?.name || "Gym membership"} />
      <p>Your {membership.planSnapshot?.name || "gym"} membership at {membership.gymId?.name || "your gym"} is confirmed.</p>
      <p className="subtle">{membership.startsAt && `Starts ${new Date(membership.startsAt).toLocaleDateString()}`} · {membership.endsAt && `Valid until ${new Date(membership.endsAt).toLocaleDateString()}`}</p></>}
    {query.isError && <p role="alert">Your purchase is confirmed. Membership details are temporarily unavailable. <button className="btn btn-secondary" onClick={() => void query.refetch()}>Retry details</button></p>}
    <MembershipWhatsAppUpdates membershipId={id} />
  </>;
}

export function PaymentReturnPage() {
  const [params] = useSearchParams();
  const me = useCurrentUser();
  const paymentId = params.get("paymentId") || sessionStorage.getItem("getfit4u.pendingPaymentId") || "";
  const payment = useQuery({
    queryKey: ["payment-return", navigationSessionScope(me.data?.data.context), me.data?.data.user?._id, paymentId],
    enabled: Boolean(paymentId && me.data?.data.user?._id),
    queryFn: () => apiRequest<ApiEnvelope<Row>>(`/api/v1/checkout/payments/${encodeURIComponent(paymentId)}`),
    retry: 2,
    gcTime: 0,
    refetchInterval: (query) => {
      const row = (query.state.data as ApiEnvelope<Row> | undefined)?.data;
      return row && (["FAILED", "CANCELLED", "REFUNDED", "PARTIALLY_REFUNDED", "REFUND_PENDING"].includes(row.status) || (row.status === "CAPTURED" && row.fulfillmentStatus === "APPLIED")) ? false : 3_000;
    },
  });
  const status = payment.data?.data.status || "PENDING";
  const role = me.data?.data.context?.role;
  const membershipId = payment.data?.data.membershipPublicId as string | undefined;
  const fulfilled = status === "CAPTURED" && payment.data?.data.fulfillmentStatus === "APPLIED";
  const destination = membershipId ? `/app/profile?section=membership&membership=${encodeURIComponent(membershipId)}` : role === "GYM_OWNER" ? "/owner/platform-subscription" : "/app/profile?section=membership";
  if (!paymentId)
    return <main className="state-card"><h1>Payment reference missing</h1><p>Return to your dashboard and reopen the payment.</p><Link className="btn btn-primary" to={destination}>Go to dashboard</Link></main>;
  return (
    <main className="state-card page-stack payment-return-page" aria-live="polite">
      <span className="eyebrow">Secure payment return</span>
      <h1>{status === "CAPTURED" ? "Payment confirmed" : status === "FAILED" ? "Payment was not completed" : "Checking payment status"}</h1>
      <StatusBadge status={status} />
      {payment.isLoading && <p>Checking the Razorpay payment with GETFIT4U…</p>}
      {!["CAPTURED", "FAILED", "CANCELLED", "REFUNDED"].includes(status) && !payment.isError && (
        <p>You may safely keep this screen open. A browser redirect alone never activates a purchase.</p>
      )}
      {status === "CAPTURED" && <p>{fulfilled ? "Your verified purchase has been recorded and its entitlement has been applied." : "Payment received. We are confirming your membership details; please do not pay again."}</p>}
      {fulfilled && membershipId && <MembershipSummary key={membershipId} id={membershipId} />}
      {fulfilled && payment.data?.data.ownersInvitation && <><WhatsAppInvitationCard invitation={payment.data.data.ownersInvitation} owners /><Link className="btn btn-primary" to="/owner/dashboard">Continue to Dashboard</Link></>}
      {status === "FAILED" && <p>No entitlement was applied. Reopen the checkout to review the current order before retrying.</p>}
      {payment.isError && <p role="alert">We could not confirm the provider status yet. Do not start another payment until this reference is reconciled.</p>}
      <p className="subtle">Payment reference: {paymentId}</p>
      {status === "CAPTURED" && <InvoiceDownload payment={{ publicId: paymentId, status }} />}
      <div className="heading-actions">
        <button className="btn btn-secondary" type="button" disabled={payment.isFetching} onClick={() => payment.refetch()}>Refresh status</button>
        <Link className="btn btn-primary" to={destination}>{membershipId ? "Continue to Membership" : "Continue"}</Link>
      </div>
    </main>
  );
}
