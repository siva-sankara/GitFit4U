import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { useCurrentUser } from "../../api/hooks";
import { apiRequest, setAccessToken, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { GymIdentity } from "../../components/GymIdentity";
import { StatusBadge } from "../../components/StatusBadge";
import "../../styles/platform-subscription.css";
import { PaymentCheckout } from "../live/LivePublic";
import { useData, QueryState, money, type Row } from "../live/LiveData";
export function PlatformSubscriptionPage() {
  const me = useCurrentUser(), [params] = useSearchParams();
  const requestedGym = params.get("gym"), hasTarget = params.has("gym");
  const assignments = me.data?.data.assignments || [];
  const context = me.data?.data.context;
  const target = assignments.find((assignment) => assignment.role === "GYM_OWNER" &&
    (hasTarget ? assignment.gymId?.publicId === requestedGym : assignment.gymId?._id === context?.gymId))?.gymId;
  const [confirmedGymId, setConfirmedGymId] = useState<string>();
  const inTargetContext = !!target && context?.role === "GYM_OWNER" && context.gymId === target._id;
  const ready = inTargetContext && (!hasTarget || confirmedGymId === target?._id);
  // Partition tenant data by gym; a cached dashboard for another owned gym is never rendered.
  const dashboard = useQuery({
    queryKey: ["platform-renewal-dashboard", target?._id],
    enabled: ready,
    queryFn: ({ signal }) => apiRequest<ApiEnvelope<Row>>("/api/v1/owner/dashboard", { signal }),
  });
  const plans = useData<Row[]>("/api/v1/workspace/platform-plans", ready);
  const [selection, setSelection] = useState<{ gymId: string; plan: Row } | null>(null),
    [busy, setBusy] = useState(false),
    [gatewayOpen, setGatewayOpen] = useState(false);
  const client = useQueryClient(),
    sub = dashboard.data?.data.platformSubscription;
  const switchGym = useMutation({
    mutationFn: async (gymId: string) => {
      if (!assignments.some((assignment) => assignment.role === "GYM_OWNER" && assignment.gymId?._id === gymId))
        throw new Error("This gym is not assigned to your owner account.");
      if (context?.role !== "GYM_OWNER" || context.gymId !== gymId) {
        await client.cancelQueries();
        const result = await apiRequest<ApiEnvelope<{ accessToken: string }>>("/api/v1/auth/switch-role", {
          method: "POST", body: JSON.stringify({ role: "GYM_OWNER", gymId }),
        });
        setAccessToken(result.data.accessToken);
        client.removeQueries({ predicate: (query) => query.queryKey[0] !== "me" });
      }
      const updated = await me.refetch();
      if (updated.error) throw updated.error;
      if (updated.data?.data.context.role !== "GYM_OWNER" || updated.data.data.context.gymId !== gymId)
        throw new Error("The active gym could not be confirmed. Please retry.");
      return gymId;
    },
    onSuccess: (gymId) => setConfirmedGymId(gymId),
  });
  const plan = ready && selection?.gymId === target?._id ? selection?.plan : null;
  if (me.isPending || me.isError) return <QueryState query={me}><span /></QueryState>;
  if (!target) return <section className="panel state-card" role="alert">
    <h1>Gym subscription unavailable</h1>
    <p>This reminder does not match a gym you are authorized to manage. No gym or payment was changed.</p>
    <Link className="btn btn-secondary" to="/notifications">Back to notifications</Link>
  </section>;
  if (!ready) return <section className="panel form-section">
    <h1>Confirm renewal gym</h1>
    <p>This reminder is for <strong>{target.name}</strong>. Continue to review only this gym's subscription.</p>
    {!inTargetContext && <p>Continuing switches your current workspace to this gym's owner account. It does not make a payment.</p>}
    <p>Gym status: {target.status.toLowerCase()}. The server will check renewal eligibility before accepting payment.</p>
    {switchGym.isError && <p role="alert">{switchGym.error.message}</p>}
    <button className="btn btn-primary" disabled={switchGym.isPending} onClick={() => switchGym.mutate(target._id)}>
      {switchGym.isPending ? "Confirming gym…" : `Continue with ${target.name}`}
    </button>
    <Link className="btn btn-secondary" to="/notifications">Cancel</Link>
  </section>;
  return (
    <div className="page-stack">
      <header className="page-heading">
        <h1>Platform subscription</h1>
        <p>Renew <strong>{target.name}</strong>'s GETFIT4U subscription with verified payment.</p>
      </header>
      {["SUSPENDED", "ARCHIVED"].includes(target.status) && <p role="alert">
        This gym is {target.status.toLowerCase()}. Contact support about its status. Renewal does not remove administrative restrictions.
      </p>}
      <QueryState query={dashboard}>
        <div className="platform-summary-grid">
          <section className="panel platform-summary-card">
            <GymIdentity name={target.name} logoUrl={dashboard.data?.data.gym?.logoUrl || target.logoUrl} subtitle="GETFIT4U platform subscription" />
            <div className="heading-actions"><h2>{sub?.plan?.name || "No platform subscription"}</h2>{sub?.status && <StatusBadge status={sub.status} />}</div>
            <dl>
              <div><dt>Starts</dt><dd>{sub?.startsAt ? new Date(sub.startsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: dashboard.data?.data.timezone || "Asia/Kolkata" }) : "—"}</dd></div>
              <div><dt>Expires</dt><dd>{sub?.endsAt ? new Date(sub.endsAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: dashboard.data?.data.timezone || "Asia/Kolkata" }) : "—"}</dd></div>
              {sub?.plan?.priceMinor != null && <div><dt>Plan price</dt><dd>{money(sub.plan.priceMinor)}</dd></div>}
            </dl>
            {!!sub?.plan?.features?.length && <ul>{sub.plan.features.map((feature: string) => <li key={feature}>{feature}</li>)}</ul>}
            <p>Unused active days are preserved. Renewals do not enable automatic charging.</p>
            {sub?.canRenew && <a className="btn btn-primary" href="#platform-renewal-plans">Renew platform subscription</a>}
          </section>
          <section className="panel platform-summary-card" aria-label="Member capacity">
            <span className="eyebrow">Member capacity</span>
            <h2>{sub?.usage ? `${sub.usage.members} active members` : "Usage unavailable"}</h2>
            {sub?.usage && <>
              <dl><div><dt>Plan limit</dt><dd>{sub.usage.memberLimit == null ? "Unlimited" : sub.usage.memberLimit}</dd></div>
              <div><dt>Remaining capacity</dt><dd>{sub.usage.memberLimit == null ? "Unlimited" : Math.max(0, sub.usage.memberLimit - sub.usage.members)}</dd></div></dl>
              {sub.usage.memberLimit != null && sub.usage.memberLimit > 0 && <progress aria-label="Member capacity used" max={sub.usage.memberLimit} value={Math.min(sub.usage.members, sub.usage.memberLimit)} />}
              <p>This limit covers active gym members. Individual membership dates and fees are managed separately.</p>
            </>}
          </section>
        </div>
      </QueryState>
      <QueryState query={plans}>
        <div className="plans-grid" id="platform-renewal-plans">
          {plans.data?.data.map((item) => (
            <article className="panel plan-card" key={item._id}>
              <h2>{item.name}</h2>
              <strong>{money(item.priceMinor)}</strong>
              <p>{item.billingPeriod === "YEARLY" ? "365 days" : "30 days"}</p>
              <p>
                {item.memberLimit == null
                  ? "Unlimited members"
                  : `${item.memberLimit} members`}
              </p>
              <ul>
                {item.features?.map((feature: string) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <button
                className="btn btn-primary"
                disabled={
                  me.data?.data.context.role !== "GYM_OWNER" ||
                  !sub?.canRenew ||
                  (item.memberLimit != null &&
                    sub?.usage?.members > item.memberLimit)
                }
                onClick={() => setSelection({ gymId: target._id, plan: item })}
              >
                Review renewal
              </button>
            </article>
          ))}
        </div>
      </QueryState>
      <Modal
        open={!!plan}
        externalOverlayActive={gatewayOpen}
        title={`Renew ${target.name} — ${plan?.name || ""}`}
        onClose={() => {
          if (!busy && !gatewayOpen) setSelection(null);
        }}
      >
        {plan && (
          <PaymentCheckout
            key={target._id}
            quotePath="/api/v1/checkout/platform/quotes"
            quoteBody={{ renewal: true, planId: plan._id, expectedGymId: target._id }}
            onBusyChange={setBusy}
            onGatewayOpenChange={setGatewayOpen}
            onComplete={() => {
              setSelection(null);
              void client.invalidateQueries();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
