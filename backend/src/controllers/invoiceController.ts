import type { Request, Response } from "express";
import { paymentInvoice } from "../services/invoiceService.js";
import { invoiceLogo, renderInvoicePdf } from "../services/invoicePdfService.js";
import { AppError } from "../utils/AppError.js";
import { invoiceEmail } from "../services/invoiceEmailService.js";
import { writeAudit } from "../services/auditService.js";
export async function invoiceEmailStatus(req: Request, res: Response) {
  const data = await invoiceEmail(String(req.params.id), req.auth!);
  res.json({ success: true, data });
}
export async function resendInvoiceEmail(req: Request, res: Response) {
  const data = await invoiceEmail(String(req.params.id), req.auth!, req.idempotencyKey);
  await writeAudit(req, { action: "invoice.email.requested", entityType: "Invoice", entityId: data.invoiceId });
  res.status(202).json({ success: true, data });
}
export async function downloadPaymentInvoice(req: Request, res: Response) {
  const id = String(req.params.id);
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
  const { invoice, currentPaymentStatus } = await paymentInvoice(id, req.auth!);
  const pdf = await renderInvoicePdf(invoice, currentPaymentStatus, await invoiceLogo(invoice));
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="GETFIT4U-${invoice.publicId}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }).send(pdf);
}
