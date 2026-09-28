import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { Download } from "lucide-react";
import { apiDownload, apiRequest, type ApiEnvelope } from "../services/apiClient";
type Delivery = { status: string; configured: boolean; emailAvailable: boolean; sentAt?: string; deliveredAt?: string };
export function invoiceEmailLabel(delivery: Delivery) {
  if (!delivery.emailAvailable) return "No email was recorded for this invoice. Download its PDF.";
  if (delivery.status === "DELIVERED") return "Invoice email delivered.";
  if (delivery.status === "SENT") return "Email accepted by provider; delivery confirmation pending.";
  if (["FAILED", "BOUNCED"].includes(delivery.status)) return "Email delivery failed. You can request another copy.";
  if (["QUEUED", "SENDING"].includes(delivery.status)) return delivery.configured ? "Invoice email queued for delivery." : "Invoice email queued. Email delivery is temporarily unavailable.";
  return "Invoice email has not been sent.";
}
export function InvoiceDownload({ payment }: { payment: { publicId: string; status: string } }) {
  const emailRequestKey = useRef(crypto.randomUUID());
  const email = useMutation({ mutationFn: (resend: boolean) => apiRequest<ApiEnvelope<Delivery>>(`/api/v1/workspace/payments/${encodeURIComponent(payment.publicId)}/invoice/email`, resend ? { method: "POST", body: "{}", idempotencyKey: emailRequestKey.current } : {}), onSuccess: (_data, resend) => { if (resend) emailRequestKey.current = crypto.randomUUID(); } });
  const download = useMutation({ mutationFn: async () => {
    const blob = await apiDownload(`/api/v1/workspace/payments/${encodeURIComponent(payment.publicId)}/invoice`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `GETFIT4U-${payment.publicId}.pdf`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  if (!["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING", "DISPUTED"].includes(payment.status)) return null;
  return <span><button type="button" className="btn btn-secondary" disabled={download.isPending} onClick={() => download.mutate()}><Download size={16} aria-hidden="true" />{download.isPending ? "Preparing invoice…" : "Download Invoice"}</button><button type="button" className="btn btn-secondary" disabled={email.isPending} onClick={() => email.mutate(true)}>Email invoice</button><button type="button" className="btn btn-secondary" disabled={email.isPending} onClick={() => email.mutate(false)}>Email status</button>{download.error && <small role="alert" className="form-alert">{download.error.message}</small>}{email.error && <small role="alert" className="form-alert">{email.error.message}</small>}{email.data && <small role="status">{invoiceEmailLabel(email.data.data)}</small>}</span>;
}
