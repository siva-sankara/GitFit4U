import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, HandCoins, MailCheck, MoreHorizontal, RefreshCw, RotateCcw, Send } from "lucide-react";
import { useState } from "react";
import { apiDownload, apiRequest } from "../services/apiClient";
import { Modal } from "./Modal";
import { ResponsiveActionButtons, TooltipButton } from "./DataListControls";
import { money, date, type Row } from "../pages/live/LiveData";
import { StatusBadge } from "./StatusBadge";

const paid = new Set(["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING", "DISPUTED"]);
const due = new Set(["CREATED", "PENDING", "AUTHORIZED"]);

export function OwnerPaymentActions({ payment }: { payment: Row }) {
  const client = useQueryClient();
  const [view, setView] = useState(false), [collect, setCollect] = useState(false), [more, setMore] = useState(false), [notice, setNotice] = useState("");
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
  const status = String(payment.status || "");
  const error = download.error || receipt.error || reminder.error || collection.error;
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
    </>
  );
}
