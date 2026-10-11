import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Landmark, AlertTriangle } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { StatusBadge } from "./StatusBadge";
import type { Row } from "../pages/live/LiveData";

export function PaymentConnectionSettings({ gym, disabled = false }: { gym: Row; disabled?: boolean }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["owner-payment-connection"],
    queryFn: () => apiRequest<ApiEnvelope<Row>>("/api/v1/owner/payment-connection"),
  });
  const request = useMutation({
    mutationFn: (body: Row) => apiRequest<ApiEnvelope<Row>>("/api/v1/owner/payment-connection/onboarding", {
      method: "POST",
      idempotencyKey: crypto.randomUUID(),
      body: JSON.stringify(body),
    }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["owner-payment-connection"] }),
  });
  const data = query.data?.data;
  const connection = data?.connection;
  return (
    <section className="panel form-section page-stack payment-connection-settings">
      <div className="section-heading">
        <div>
          <span className="eyebrow">PhonePe beneficiary</span>
          <h2>Membership payment account</h2>
        </div>
        <StatusBadge status={connection?.onboardingStatus || "NOT_STARTED"} />
      </div>
      <p>Member payments may be enabled only after PhonePe approves this gym as the settlement beneficiary. GETFIT4U never asks members to choose a receiving account.</p>
      {query.isLoading && <p>Checking payment onboarding…</p>}
      {query.isError && <p className="form-alert" role="alert">{query.error.message}</p>}
      {data && (
        <>
          <div className="metric-grid compact-metrics">
            <article className="metric-tile"><Landmark aria-hidden="true" /><span>Provider</span><strong>{data.provider}</strong><small>{data.environment}</small></article>
            <article className="metric-tile"><ShieldCheck aria-hidden="true" /><span>Online collection</span><strong>{data.onlineMembershipPaymentsAvailable ? "Enabled" : "Disabled"}</strong><small>{connection?.maskedSettlementAccount || "No bank details exposed"}</small></article>
          </div>
          {data.blockers?.length > 0 && (
            <div className="form-alert" role="status">
              <strong><AlertTriangle size={18} aria-hidden="true" /> Setup required</strong>
              {data.blockers.map((blocker: string) => <p key={blocker}>{blocker}</p>)}
              <p>Offline membership collection remains available under the existing gym rules.</p>
            </div>
          )}
          {connection?.providerVendorReference && <p><strong>PhonePe vendor reference:</strong> {connection.providerVendorReference}</p>}
          {!connection || ["NOT_STARTED", "ACTION_REQUIRED", "RESTRICTED", "DISABLED"].includes(connection.onboardingStatus) ? (
            <form onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              request.mutate({
                businessLegalName: values.get("businessLegalName"),
                businessContactEmail: values.get("businessContactEmail"),
                acceptTerms: values.get("acceptTerms") === "on",
              });
            }}>
              <fieldset className="profile-fieldset" disabled={disabled || request.isPending}>
                <label className="field"><span>Legal business name</span><input className="input" name="businessLegalName" required minLength={2} maxLength={200} defaultValue={connection?.businessLegalName || gym.name || ""} /></label>
                <label className="field"><span>Business contact email</span><input className="input" name="businessContactEmail" type="email" required defaultValue={connection?.businessContactEmail || gym.contact?.email || ""} /></label>
                <label><input name="acceptTerms" type="checkbox" required /> I confirm I am authorized to request payment onboarding for this gym.</label>
                <button className="btn btn-primary" type="submit">{request.isPending ? "Submitting…" : connection ? "Resubmit onboarding" : "Start onboarding"}</button>
              </fieldset>
            </form>
          ) : <p>Onboarding is under review. GETFIT4U stores only provider references and masked settlement information here.</p>}
          {request.isError && <p className="form-alert" role="alert">{request.error.message}</p>}
          {request.isSuccess && <p role="status">{request.data.message || "Onboarding request saved."}</p>}
        </>
      )}
    </section>
  );
}
