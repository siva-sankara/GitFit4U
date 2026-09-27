import { useMutation } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { apiDownload } from "../services/apiClient";
export function InvoiceDownload({ payment }: { payment: { publicId: string; status: string } }) {
  const download = useMutation({ mutationFn: async () => {
    const blob = await apiDownload(`/api/v1/workspace/payments/${encodeURIComponent(payment.publicId)}/invoice`);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); link.href = url; link.download = `GETFIT4U-${payment.publicId}.pdf`;
    document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } });
  if (!["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING", "DISPUTED"].includes(payment.status)) return null;
  return <span><button type="button" className="btn btn-secondary" disabled={download.isPending} onClick={() => download.mutate()}><Download size={16} aria-hidden="true" />{download.isPending ? "Preparing invoice…" : "Download Invoice"}</button>{download.error && <small role="alert" className="form-alert">{download.error.message}</small>}</span>;
}
