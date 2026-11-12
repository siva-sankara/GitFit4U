import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import type { Row } from "../live/LiveData";

const localTime = (date: Date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
type Mode = "EXISTING" | "OFFLINE_PAYMENT" | "PAYMENT_PENDING" | "COLLECT" | "suspend" | "archive";
export function GymActivationForm({ gym, onSaved }: { gym: Row; onSaved: () => void }) {
  const client = useQueryClient(), key = useRef(crypto.randomUUID());
  const [mode, setMode] = useState<Mode>("EXISTING");
  const [planId, setPlanId] = useState(""), [reason, setReason] = useState("");
  const [startsAt, setStartsAt] = useState(localTime(new Date()));
  const [endsAt, setEndsAt] = useState(""), [dueAt, setDueAt] = useState(localTime(new Date(Date.now() + 86400000)));
  const [method, setMethod] = useState("CASH"), [paidAt, setPaidAt] = useState(localTime(new Date()));
  const [reference, setReference] = useState(""), [receiptReference, setReceiptReference] = useState("");
  const [notes, setNotes] = useState(""), [confirmed, setConfirmed] = useState(false);
  const context = useQuery({ queryKey: ["gym-activation", gym.publicId],
    queryFn: () => apiRequest<ApiEnvelope<Row>>(`/api/v1/admin/gyms/${gym.publicId}/activation`) });
  const plans = useQuery({ queryKey: ["admin-platform-plans"],
    queryFn: () => apiRequest<ApiEnvelope<Row[]>>("/api/v1/admin/platform-plans") });
  const plan = plans.data?.data.find(value => value._id === planId);
  const subscription = context.data?.data.subscription, payment = subscription?.latestPaymentId;
  const isNew = mode === "OFFLINE_PAYMENT" || mode === "PAYMENT_PENDING";
  const collecting = mode === "OFFLINE_PAYMENT" || mode === "COLLECT";
  const amount = mode === "COLLECT" ? payment?.amountMinor : plan?.priceMinor;
  useEffect(() => {
    if (plan && startsAt && Number.isFinite(Date.parse(startsAt)))
      setEndsAt(localTime(new Date(Date.parse(startsAt) + (plan.billingPeriod === "YEARLY" ? 365 : 30) * 86400000)));
  }, [plan, startsAt]);
  const save = useMutation({ mutationFn: () => {
    const recordedPayment = { method, amountMinor: amount, currency: "INR", paidAt: new Date(paidAt).toISOString(),
      reference: reference || undefined, receiptReference: receiptReference || undefined, notes: notes || undefined, confirmedReceived: confirmed };
    if (mode === "COLLECT") return apiRequest(`/api/v1/admin/platform-payments/${payment.publicId}/collect`, {
      method: "POST", idempotencyKey: key.current, body: JSON.stringify(recordedPayment) });
    if (isNew) return apiRequest(`/api/v1/admin/gyms/${gym.publicId}/authorization`, {
      method: "POST", idempotencyKey: key.current, body: JSON.stringify({ mode, planId, reason,
        startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(),
        ...(mode === "PAYMENT_PENDING" ? { dueAt: new Date(dueAt).toISOString() } : { payment: recordedPayment }) }) });
    return apiRequest(`/api/v1/admin/gyms/${gym.publicId}/status`, { method: "POST", idempotencyKey: key.current,
      body: JSON.stringify({ action: mode === "EXISTING" ? "activate" : mode, reason }) });
  }, onSuccess: async () => { await client.invalidateQueries(); onSaved(); } });
  const label = mode === "OFFLINE_PAYMENT" ? "Activate & Record Payment" : mode === "PAYMENT_PENDING" ? "Activate — Payment Pending" : mode === "COLLECT" ? "Confirm payment received" : "Save";
  return <form className="modal-form" onSubmit={event => { event.preventDefault(); if (!save.isPending) save.mutate(); }}
    onChange={() => { if (!save.isPending) key.current = crypto.randomUUID(); }}>
    {context.isError && <p className="form-alert" role="alert">{context.error.message}</p>}
    {subscription && <div className="form-section"><strong>{subscription.status === "ACTIVE" ? "Active" : subscription.status} / {subscription.adminAuthorization?.paymentStatus === "PENDING" ? "Payment Pending" : subscription.adminAuthorization?.paymentStatus === "PAID_OFFLINE" ? "Paid Offline" : payment?.status || "Payment status unavailable"}</strong>
      <p>{subscription.planSnapshot?.name} · Access ends {new Date(subscription.endsAt).toLocaleDateString()}</p>
      {subscription.adminAuthorization?.dueAt && <p>Payment due {new Date(subscription.adminAuthorization.dueAt).toLocaleDateString()}</p>}
    </div>}
    <label className="field"><span>Action</span><select className="select" value={mode} disabled={save.isPending} onChange={event => { setMode(event.target.value as Mode); save.reset(); }}>
      <option value="EXISTING">Activate with existing entitlement</option>
      <option value="OFFLINE_PAYMENT">Activate & Record Payment</option>
      <option value="PAYMENT_PENDING">Activate — Payment Pending</option>
      {subscription?.adminAuthorization?.paymentStatus === "PENDING" && payment?.status === "PENDING" && <option value="COLLECT">Collect outstanding payment</option>}
      <option value="suspend">Suspend</option><option value="archive">Archive</option>
    </select></label>
    {isNew && <>
      <label className="field"><span>Platform plan</span><select className="select" value={planId} required onChange={event => setPlanId(event.target.value)} disabled={save.isPending || plans.isPending}>
        <option value="">Select a plan</option>{plans.data?.data.filter(value => value.active).map(value => <option key={value._id} value={value._id}>{value.name} · ₹{(value.priceMinor / 100).toFixed(2)}</option>)}
      </select></label>
      {plans.isError && <p role="alert">{plans.error.message}</p>}
      {plan && <p>Limits: {plan.memberLimit ?? "Not configured"} members · {plan.staffLimit ?? "Not configured"} staff</p>}
      <label className="field"><span>Access starts</span><input className="input" type="datetime-local" required disabled={save.isPending} value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
      <label className="field"><span>Access ends</span><input className="input" type="datetime-local" required disabled={save.isPending} value={endsAt} onChange={event => setEndsAt(event.target.value)} /></label>
      {mode === "PAYMENT_PENDING" && <><label className="field"><span>Payment due</span><input className="input" type="datetime-local" required disabled={save.isPending} value={dueAt} onChange={event => setDueAt(event.target.value)} /></label>
        <p>Authorizes only this plan and access period. No payment receipt will be issued until money is collected.</p></>}
    </>}
    {mode !== "COLLECT" && <label className="field"><span>Reason</span><textarea className="textarea" required minLength={5} maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} disabled={save.isPending} /></label>}
    {collecting && <fieldset disabled={save.isPending} className="form-section"><legend>Confirm actual payment receipt</legend>
      <p>Amount: ₹{((amount || 0) / 100).toFixed(2)} INR</p>
      <label className="field"><span>Method</span><select className="select" value={method} onChange={event => setMethod(event.target.value)}><option value="CASH">Cash</option><option value="UPI">UPI</option></select></label>
      <label className="field"><span>Payment date</span><input className="input" type="datetime-local" required value={paidAt} onChange={event => setPaidAt(event.target.value)} /></label>
      <label className="field"><span>{method === "UPI" ? "UPI UTR / reference" : "Payment reference (optional)"}</span><input className="input" required={method === "UPI"} minLength={method === "UPI" ? 6 : undefined} maxLength={120} value={reference} onChange={event => setReference(event.target.value)} /></label>
      <label className="field"><span>Receipt reference (optional)</span><input className="input" maxLength={120} value={receiptReference} onChange={event => setReceiptReference(event.target.value)} /></label>
      <label className="field"><span>Collection notes</span><textarea className="textarea" maxLength={1000} value={notes} onChange={event => setNotes(event.target.value)} /></label>
      <label><input type="checkbox" required checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> I confirm these funds have been received. A reference alone is not payment verification.</label>
    </fieldset>}
    {save.isError && <p className="form-alert" role="alert">{save.error.message}</p>}
    <button className="btn btn-primary" disabled={save.isPending || context.isPending || (collecting && !confirmed)}>{save.isPending ? "Saving…" : label}</button>
  </form>;
}
