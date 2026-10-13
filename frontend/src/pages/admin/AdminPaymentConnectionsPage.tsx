import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { QueryState, Table, type Row } from "../live/LiveData";

export function AdminPaymentConnectionsPage() {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-payment-connections"],
    queryFn: () => apiRequest<ApiEnvelope<Row>>("/api/v1/admin/payment-connections"),
  });
  const transfers = useQuery({
    queryKey: ["admin-route-transfers"],
    queryFn: () =>
      apiRequest<ApiEnvelope<Row[]>>("/api/v1/admin/route-transfers"),
  });
  const refunds = useQuery({
    queryKey: ["admin-refund-exceptions"],
    queryFn: () =>
      apiRequest<ApiEnvelope<Row[]>>("/api/v1/admin/refund-exceptions"),
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
  const reconcile = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/admin/route-transfers/${id}/reconcile`, {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: "{}",
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["admin-route-transfers"] }),
  });
  const reconcileRefund = useMutation({
    mutationFn: (id: string) =>
      apiRequest(`/api/v1/admin/refunds/${id}/reconcile`, {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: "{}",
      }),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: ["admin-refund-exceptions"] }),
  });
  const rows = query.data?.data.items || [];
  const configurationBlockers: string[] =
    query.data?.data.configurationBlockers || [];
  return (
    <div className="page-stack">
      <PageHeader><div><span className="eyebrow">Finance operations</span><h1>Gym payment onboarding</h1><p>Record provider-confirmed vendor approvals and monitor beneficiary-routing blockers.</p></div></PageHeader>
      {configurationBlockers.length > 0 && <div className="form-alert" role="status"><strong>Live gym collection is intentionally disabled.</strong>{configurationBlockers.map((blocker: string) => <p key={blocker}>{blocker}</p>)}<p>Platform subscriptions can use ordinary Razorpay Checkout independently and never include a gym transfer.</p></div>}
      {query.isLoading && <section className="state-card">Loading payment connections…</section>}
      {query.isError && <section className="state-card" role="alert">{query.error.message}</section>}
      {!query.isLoading && rows.length === 0 && <section className="state-card">No gym has requested Razorpay Route onboarding.</section>}
      {rows.map((row: Row) => (
        <article className="panel form-section page-stack" key={row.publicId}>
          <div className="section-heading"><div><h2>{row.gymId?.name || "Gym"}</h2><p>{row.businessLegalName} · {row.businessContactEmail}</p></div><StatusBadge status={row.onboardingStatus} /></div>
          <div className="detail-grid">
            <p><strong>Owner</strong><br />{row.authorizedOwnerId?.name || "—"}</p>
            <p><strong>Environment</strong><br />{row.environment}</p>
            <p><strong>Linked account</strong><br />{row.linkedAccountId || "Not assigned"}</p>
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
              linkedAccountId: optional("linkedAccountId"),
              productConfigurationId: optional("productConfigurationId"),
              collectionEnabled: values.get("collectionEnabled") === "on",
              reason: values.get("reason"),
            } });
          }}>
            <fieldset className="form-grid" disabled={review.isPending}>
              <label className="field"><span>Review status</span><select className="input" name="onboardingStatus" defaultValue={row.onboardingStatus}>{["PENDING", "ACTION_REQUIRED", "APPROVED", "REJECTED", "DISABLED"].map(value => <option key={value}>{value}</option>)}</select></label>
              <label className="field"><span>Razorpay linked account</span><input className="input" name="linkedAccountId" pattern="^acc_[A-Za-z0-9]+$" defaultValue={row.linkedAccountId || ""} /></label>
              <label className="field"><span>Route product configuration</span><input className="input" name="productConfigurationId" pattern="^acc_prd_[A-Za-z0-9]+$" defaultValue={row.productConfigurationId || ""} /></label>
              <p className="field"><span>Provider verification</span><strong>{row.providerEvidenceReference || "Not verified"}</strong><small>Approval fetches the linked account and Route product directly from Razorpay. Capabilities cannot be enabled manually.</small></p>
              <label><input type="checkbox" name="collectionEnabled" defaultChecked={row.collectionEnabled} /> Enable only after live provider verification</label>
              <label className="field"><span>Audit reason</span><textarea className="input" name="reason" minLength={5} maxLength={1000} required /></label>
              <button className="btn btn-primary" type="submit">Save provider review</button>
            </fieldset>
          </form>
        </article>
      ))}
      {review.isError && <p className="form-alert" role="alert">{review.error.message}</p>}
      {review.isSuccess && <p role="status">Razorpay Route review saved. The server will keep collection disabled while any readiness blocker remains.</p>}
      <section className="panel form-section page-stack">
        <div className="section-heading">
          <div>
            <h2>Transfer and settlement monitoring</h2>
            <p>
              Review failed, reversed, and unsettled beneficiary allocations.
              Settlement is reported independently from customer payment capture.
            </p>
          </div>
        </div>
        <QueryState query={transfers}>
          <Table
            rows={transfers.data?.data || []}
            columns={[
              {
                key: "gymId.name",
                title: "Gym",
                render: (row) => row.gymId?.name || "Unknown gym",
              },
              {
                key: "paymentId.publicId",
                title: "Payment",
                render: (row) => row.paymentId?.publicId || "Pending reference",
              },
              { key: "amountMinor", title: "Amount", format: "money" },
              { key: "status", title: "Transfer", format: "status" },
              { key: "settlementStatus", title: "Settlement", format: "status" },
              {
                key: "providerTransferId",
                title: "Provider transfer",
              },
              { key: "createdAt", title: "Created", format: "date" },
            ]}
            actions={(row) => (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={reconcile.isPending}
                onClick={() => reconcile.mutate(row.publicId)}
              >
                Reconcile
              </button>
            )}
          />
        </QueryState>
        {reconcile.isError && (
          <p className="form-alert" role="alert">
            {reconcile.error.message}
          </p>
        )}
      </section>
      <section className="panel form-section page-stack">
        <div className="section-heading">
          <div>
            <h2>Refund and reversal exceptions</h2>
            <p>
              Provider refund and gym-transfer reversal confirmations are
              independent. Reconciliation only reads Razorpay state; it never
              submits another refund.
            </p>
          </div>
        </div>
        <QueryState query={refunds}>
          <Table
            rows={refunds.data?.data || []}
            columns={[
              {
                key: "paymentId.gymId.name",
                title: "Gym",
                render: (row) => row.paymentId?.gymId?.name || "Platform",
              },
              {
                key: "paymentId.publicId",
                title: "Payment",
                render: (row) => row.paymentId?.publicId || "Unknown",
              },
              { key: "amountMinor", title: "Refund amount", format: "money" },
              { key: "status", title: "Refund", format: "status" },
              {
                key: "transferReversalStatus",
                title: "Transfer reversal",
                format: "status",
              },
              {
                key: "failureReason",
                title: "Reconciliation note",
                render: (row) => row.failureReason || "Awaiting provider state",
              },
            ]}
            actions={(row) => (
              <button
                className="btn btn-secondary"
                type="button"
                disabled={reconcileRefund.isPending}
                onClick={() => reconcileRefund.mutate(row.publicId)}
              >
                Reconcile
              </button>
            )}
          />
        </QueryState>
        {reconcileRefund.isError && (
          <p className="form-alert" role="alert">
            {reconcileRefund.error.message}
          </p>
        )}
      </section>
    </div>
  );
}
