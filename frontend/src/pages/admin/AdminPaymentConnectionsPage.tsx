import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import type { Row } from "../live/LiveData";

export function AdminPaymentConnectionsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-payment-connections"],
    queryFn: () => apiRequest<ApiEnvelope<Row>>("/api/v1/admin/payment-connections"),
  });
  const review = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Row }) =>
      apiRequest(`/api/v1/admin/payment-connections/${id}`, {
        method: "PATCH",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify(body),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["admin-payment-connections"] }),
  });
  const rows = query.data?.data.items || [];
  return (
    <div className="page-stack">
      <PageHeader><div><span className="eyebrow">Finance operations</span><h1>Gym payment onboarding</h1><p>Record provider-confirmed vendor approvals and monitor beneficiary-routing blockers.</p></div></PageHeader>
      {query.data?.data.contractBlocker && <div className="form-alert" role="status"><strong>Live gym collection is intentionally disabled.</strong><p>{query.data.data.contractBlocker}</p><p>Platform subscription checkout can use PhonePe Standard Checkout independently.</p></div>}
      {query.isLoading && <section className="state-card">Loading payment connections…</section>}
      {query.isError && <section className="state-card" role="alert">{query.error.message}</section>}
      {!query.isLoading && rows.length === 0 && <section className="state-card">No gym has requested PhonePe onboarding.</section>}
      {rows.map((row: Row) => (
        <article className="panel form-section page-stack" key={row.publicId}>
          <div className="section-heading"><div><h2>{row.gymId?.name || "Gym"}</h2><p>{row.businessLegalName} · {row.businessContactEmail}</p></div><StatusBadge status={row.onboardingStatus} /></div>
          <div className="detail-grid">
            <p><strong>Owner</strong><br />{row.authorizedOwnerId?.name || "—"}</p>
            <p><strong>Environment</strong><br />{row.environment}</p>
            <p><strong>Vendor reference</strong><br />{row.providerVendorReference || "Not assigned"}</p>
            <p><strong>Settlement account</strong><br />{row.maskedSettlementAccount || "Not supplied"}</p>
            <p><strong>Collection</strong><br />{row.collectionEnabled ? "Enabled" : "Disabled"}</p>
            <p><strong>Allocation</strong><br />{row.allocationCapability}</p>
          </div>
          <form onSubmit={(event) => {
            event.preventDefault();
            const values = new FormData(event.currentTarget);
            const optional = (key: string) => String(values.get(key) || "").trim() || undefined;
            review.mutate({ id: row.publicId, body: {
              onboardingStatus: values.get("onboardingStatus"),
              providerMerchantReference: optional("providerMerchantReference"),
              providerVendorReference: optional("providerVendorReference"),
              providerEvidenceReference: optional("providerEvidenceReference"),
              maskedSettlementAccount: optional("maskedSettlementAccount"),
              reason: values.get("reason"),
            } });
          }}>
            <fieldset className="form-grid" disabled={review.isPending}>
              <label className="field"><span>Review status</span><select className="input" name="onboardingStatus" defaultValue={row.onboardingStatus}>{["PENDING", "ACTION_REQUIRED", "APPROVED", "RESTRICTED", "DISABLED"].map(value => <option key={value}>{value}</option>)}</select></label>
              <label className="field"><span>PhonePe merchant reference</span><input className="input" name="providerMerchantReference" defaultValue={row.providerMerchantReference || ""} /></label>
              <label className="field"><span>PhonePe vendor reference</span><input className="input" name="providerVendorReference" defaultValue={row.providerVendorReference || ""} /></label>
              <label className="field"><span>Provider evidence reference</span><input className="input" name="providerEvidenceReference" defaultValue={row.providerEvidenceReference || ""} /></label>
              <label className="field"><span>Masked settlement account</span><input className="input" name="maskedSettlementAccount" placeholder="********1234" defaultValue={row.maskedSettlementAccount || ""} /></label>
              <label className="field"><span>Audit reason</span><textarea className="input" name="reason" minLength={5} maxLength={1000} required /></label>
              <button className="btn btn-primary" type="submit">Save provider review</button>
            </fieldset>
          </form>
        </article>
      ))}
      {review.isError && <p className="form-alert" role="alert">{review.error.message}</p>}
      {review.isSuccess && <p role="status">Provider review saved. Collection remains disabled until the allocation contract is implemented.</p>}
    </div>
  );
}
