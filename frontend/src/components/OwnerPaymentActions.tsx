import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, HandCoins, MailCheck, MoreHorizontal, RefreshCw, RotateCcw, Send, Undo2 } from "lucide-react";
import { useState } from "react";
import { apiDownload, apiRequest } from "../services/apiClient";
import { Modal } from "./Modal";
import { ResponsiveActionButtons, TooltipButton } from "./DataListControls";
import { money, date, type Row } from "../pages/live/LiveData";
import { StatusBadge } from "./StatusBadge";

const paid = new Set(["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING", "DISPUTED"]);
const due = new Set(["CREATED", "PENDING", "AUTHORIZED"]);
const refundable = new Set(["CAPTURED", "PARTIALLY_REFUNDED", "REFUND_PENDING"]);

export function OwnerPaymentActions({ payment }: { payment: Row }) {
  const client = useQueryClient();
  const [view, setView] = useState(false), [collect, setCollect] = useState(false), [refund, setRefund] = useState(false), [more, setMore] = useState(false), [notice, setNotice] = useState("");
  const download = useMutation({
    mutationFn: async () => {
      const blob = await apiDownload(`/api/v1/workspace/payments/${encodeURIComponent(payment.publicId)}/invoice`);
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url; link.download = `GETFIT4U-${payment.publicId}.pdf`; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    },
  });
  const receipt = useMutation({
    mutationFn: () => apiRequest(`/api/v1/workspace/payments/${encodeURIComponent(payment.publicId)}/invoice/email`, { method: "POST", body: "{}", idempotencyKey: crypto.randomUUID() }),
    onSuccess: () => setNotice("Receipt email queued. Provider delivery status may update later."),
  });
  const reminder = useMutation({
    mutationFn: () => apiRequest<any>(`/api/v1/owner/payments/${payment.publicId}/reminder`, { method: "POST", body: "{}", idempotencyKey: crypto.randomUUID() }),
    onSuccess: (response) => {
      setNotice(response.data.message || "Payment reminder queued.");
      if (response.data.waUrl) window.open(response.data.waUrl, "_blank", "noopener,noreferrer");
    },
  });
  const collection = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiRequest(`/api/v1/owner/payments/${payment.publicId}/collect`, { method: "POST", body: JSON.stringify(body), idempotencyKey: crypto.randomUUID() }),
    onSuccess: async () => { setCollect(false); setNotice("Offline payment recorded and receipt created."); await client.invalidateQueries({ queryKey: ["api"] }); },
  });
  const refundRequest = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequest(`/api/v1/owner/payments/${payment.publicId}/refunds`, {
        method: "POST",
        body: JSON.stringify(body),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setRefund(false);
      setNotice(
        payment.provider === "OFFLINE"
          ? "Offline refund recorded."
          : "Refund reserved and submitted. Customer refund and Route reversal will be reconciled separately.",
      );
      await client.invalidateQueries({ queryKey: ["api"] });
    },
  });
  const status = String(payment.status || "");
  const error = download.error || receipt.error || reminder.error || collection.error || refundRequest.error;
  return (
    <>
      <ResponsiveActionButtons>
        <TooltipButton tooltip="Open payment and invoice details" icon={Eye} onClick={() => setView(true)}></TooltipButton>
        {paid.has(status) && <TooltipButton tooltip="Download invoice PDF" icon={Download} disabled={download.isPending} onClick={() => download.mutate()}></TooltipButton>}
        {paid.has(status) && <TooltipButton tooltip="Send receipt to the payer's verified invoice email" icon={MailCheck} disabled={receipt.isPending} onClick={() => receipt.mutate()}></TooltipButton>}
        {(due.has(status) || status === "FAILED" || status === "CANCELLED") && <TooltipButton tooltip={status === "FAILED" ? "Mark this failed payment as manually paid" : "Record payment for this invoice"} icon={status === "FAILED" ? RotateCcw : HandCoins} onClick={() => setCollect(true)}>{status === "FAILED" ? "Mark manually paid" : "Collect"}</TooltipButton>}
        {status === "FAILED" && <TooltipButton tooltip="Ask the payer to retry this failed payment" icon={RefreshCw} disabled={reminder.isPending} onClick={() => reminder.mutate()}>Retry</TooltipButton>}
        {(due.has(status) || status === "CANCELLED") && <TooltipButton tooltip="Send payment reminder by in-app message, notification, and WhatsApp if enabled" icon={Send} disabled={reminder.isPending} onClick={() => reminder.mutate()}>Send Reminder</TooltipButton>}
        <TooltipButton tooltip="More payment actions" icon={MoreHorizontal} className="btn btn-ghost payment-more-action" onClick={() => setMore(true)}>More</TooltipButton>
      </ResponsiveActionButtons>
      {notice && <small role="status" className="payment-action-notice">{notice}</small>}
      {error && <small role="alert" className="form-alert">{error.message}</small>}
      <Modal open={view} title="Payment and invoice details" onClose={() => setView(false)}>
        <dl className="payment-detail-list">
          <div><dt>Reference</dt><dd>{payment.publicId}</dd></div>
          <div><dt>Payer</dt><dd>{payment.payerId?.name || "Member"}</dd></div>
          <div><dt>Purpose</dt><dd>{payment.purpose}</dd></div>
          <div><dt>Amount</dt><dd>{money(payment.amountMinor)}</dd></div>
          <div><dt>Status</dt><dd><StatusBadge status={status} /></dd></div>
          <div><dt>Method</dt><dd>{payment.provider} {payment.methodCategory || ""}</dd></div>
          <div><dt>Created</dt><dd>{date(payment.createdAt)}</dd></div>
          {payment.failureDescription && <div><dt>Failure</dt><dd>{payment.failureDescription}</dd></div>}
        </dl>
      </Modal>
      <Modal open={more} title="More payment actions" onClose={() => setMore(false)}>
        <div className="payment-more-menu">
          <TooltipButton tooltip="Open payment and invoice details" icon={Eye} onClick={() => { setMore(false); setView(true); }}>View details</TooltipButton>
          {paid.has(status) && <TooltipButton tooltip="Download invoice PDF" icon={Download} disabled={download.isPending} onClick={() => download.mutate()}>Download Invoice</TooltipButton>}
          {paid.has(status) && <TooltipButton tooltip="Send receipt to the payer's verified invoice email" icon={MailCheck} disabled={receipt.isPending} onClick={() => receipt.mutate()}>Send Receipt</TooltipButton>}
          {refundable.has(status) && <TooltipButton tooltip="Request an audited full or partial refund" icon={Undo2} disabled={refundRequest.isPending} onClick={() => { setMore(false); setRefund(true); }}>Refund</TooltipButton>}
          {(due.has(status) || status === "FAILED" || status === "CANCELLED") && <TooltipButton tooltip={status === "FAILED" ? "Mark this failed payment as manually paid" : "Record payment for this invoice"} icon={status === "FAILED" ? RotateCcw : HandCoins} onClick={() => { setMore(false); setCollect(true); }}>{status === "FAILED" ? "Mark manually paid" : "Collect"}</TooltipButton>}
          {status === "FAILED" && <TooltipButton tooltip="Ask the payer to retry this failed payment" icon={RefreshCw} disabled={reminder.isPending} onClick={() => reminder.mutate()}>Retry</TooltipButton>}
          {(due.has(status) || status === "CANCELLED") && <TooltipButton tooltip="Send payment reminder by in-app message, notification, and WhatsApp if enabled" icon={Send} disabled={reminder.isPending} onClick={() => reminder.mutate()}>Send Reminder</TooltipButton>}
        </div>
      </Modal>
      <Modal open={collect} title={status === "FAILED" ? "Mark payment manually paid" : "Collect payment"} onClose={() => !collection.isPending && setCollect(false)}>
        <form className="page-stack" onSubmit={(event) => { event.preventDefault(); const values = new FormData(event.currentTarget); collection.mutate({ method: values.get("method"), paidAt: values.get("paidAt"), reference: values.get("reference") || undefined, notes: values.get("notes") || undefined }); }}>
          <p>Record an offline receipt for {money(payment.amountMinor)}. The original online attempt remains in the audit history.</p>
          <label className="field"><span>Payment method</span><select className="select" name="method" required>{["CASH", "UPI", "CARD_POS", "BANK_TRANSFER", "OTHER"].map((method) => <option key={method}>{method}</option>)}</select></label>
          <label className="field"><span>Payment date</span><input className="input" type="date" name="paidAt" required max={new Date().toISOString().slice(0, 10)} defaultValue={new Date().toISOString().slice(0, 10)} /></label>
          <label className="field"><span>Reference number</span><input className="input" name="reference" maxLength={120} /></label>
          <label className="field"><span>Notes</span><textarea className="textarea" name="notes" maxLength={1000} /></label>
          <button className="btn btn-primary" disabled={collection.isPending}>{collection.isPending ? "Recording…" : "Record payment"}</button>
        </form>
      </Modal>
      <Modal open={refund} title="Refund payment" onClose={() => !refundRequest.isPending && setRefund(false)}>
        <form className="page-stack" onSubmit={(event) => {
          event.preventDefault();
          const values = new FormData(event.currentTarget);
          const amountMinor = Math.round(Number(values.get("amount")) * 100);
          refundRequest.mutate({
            amountMinor,
            reason: values.get("reason"),
            ...(payment.provider === "OFFLINE"
              ? {
                  offlineConfirmed: values.get("offlineConfirmed") === "on",
                  offlineReference: values.get("offlineReference") || undefined,
                }
              : {}),
          });
        }}>
          <p>
            Refund up to {money(payment.amountMinor)} against the original
            payment. Online membership refunds also reconcile the original
            gym transfer; a transfer reversal alone is not customer refund
            confirmation.
          </p>
          <label className="field"><span>Refund amount</span><input className="input" name="amount" type="number" min="0.01" max={Number(payment.amountMinor) / 100} step="0.01" required /></label>
          <label className="field"><span>Reason</span><textarea className="textarea" name="reason" minLength={5} maxLength={1000} required /></label>
          {payment.provider === "OFFLINE" && <>
            <label className="field"><span>External refund reference</span><input className="input" name="offlineReference" maxLength={120} /></label>
            <label><input type="checkbox" name="offlineConfirmed" required /> I confirm the funds were already returned outside GETFIT4U.</label>
          </>}
          <button className="btn btn-danger" disabled={refundRequest.isPending}>{refundRequest.isPending ? "Submitting…" : "Confirm refund"}</button>
        </form>
      </Modal>
    </>
  );
}
