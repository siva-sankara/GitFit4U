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
          <span className="eyebrow">Razorpay Route beneficiary</span>
          <h2>Membership payment account</h2>
        </div>
        <StatusBadge status={connection?.onboardingStatus || "NOT_STARTED"} />
      </div>
      <p>Member payments may be enabled only after Razorpay approves this gym's linked account and Route settlement capability. GETFIT4U never asks a member to choose the recipient.</p>
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
          {connection?.linkedAccountId && <p><strong>Linked account:</strong> {`${connection.linkedAccountId.slice(0, 8)}â€¦${connection.linkedAccountId.slice(-4)}`}</p>}
          {data.feeBearerPolicy && <p><strong>Provider-fee policy:</strong> {String(data.feeBearerPolicy).replaceAll("_", " ")}. GETFIT4U membership commission is zero.</p>}
          {!connection || ["NOT_STARTED", "ACTION_REQUIRED", "REJECTED", "DISABLED"].includes(connection.onboardingStatus) ? (
            <form onSubmit={(event) => {
              event.preventDefault();
              const values = new FormData(event.currentTarget);
              request.mutate({
                businessLegalName: values.get("businessLegalName"),
                businessType: values.get("businessType"),
                businessContactEmail: values.get("businessContactEmail"),
                businessContactPhone: values.get("businessContactPhone"),
                termsAccepted: values.get("termsAccepted") === "on",
                termsVersion: "2026-10-11",
              });
            }}>
              <fieldset className="profile-fieldset" disabled={disabled || request.isPending}>
                <label className="field"><span>Legal business name</span><input className="input" name="businessLegalName" required minLength={4} maxLength={200} defaultValue={connection?.businessLegalName || gym.name || ""} /></label>
                <label className="field"><span>Business type</span><select className="input" name="businessType" required defaultValue={connection?.businessType || "individual"}><option value="individual">Individual / proprietorship</option><option value="partnership">Partnership</option><option value="private_limited">Private limited</option><option value="public_limited">Public limited</option><option value="llp">LLP</option><option value="trust">Trust</option><option value="society">Society</option></select></label>
                <label className="field"><span>Business contact email</span><input className="input" name="businessContactEmail" type="email" required defaultValue={connection?.businessContactEmail || gym.contact?.email || ""} /></label>
                <label className="field"><span>Business contact phone (E.164)</span><input className="input" name="businessContactPhone" type="tel" required pattern="^\+[1-9]\d{7,14}$" placeholder="+919876543210" defaultValue={connection?.businessContactPhone || gym.contact?.phone || ""} /></label>
                <label><input name="termsAccepted" type="checkbox" required /> I am authorized by this gym and accept the beneficiary-onboarding terms for Razorpay Route.</label>
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
