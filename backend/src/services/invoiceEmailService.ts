import mongoose from "mongoose";
import { Invoice } from "../models/Business.js";
import { Payment } from "../models/Commerce.js";
import { TransactionalEmail } from "../models/Delivery.js";
import { ensurePaymentInvoice, invoicePaymentScope } from "./invoiceService.js";
import { queueInvoiceEmail } from "./invoiceDeliveryService.js";
import { emailConfigured } from "../integrations/notifications/emailProvider.js";
import { sha256 } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";
type Auth = Parameters<typeof invoicePaymentScope>[0];
export function invoiceDeliveryStatus(invoice: any, delivery: any) {
  return { invoiceId: invoice.publicId, generatedAt: invoice.issuedAt, emailAvailable: Boolean(invoice.customerSnapshot?.email), configured: emailConfigured(), status: delivery?.status || "NOT_QUEUED", queuedAt: delivery?.createdAt, sentAt: delivery?.sentAt, deliveredAt: delivery?.deliveredAt, failureCode: delivery?.lastErrorCode };
}
export async function invoiceEmail(publicId: string, auth: Auth, requestKey?: string, now = new Date()) {
  return mongoose.connection.transaction(async session => {
    const payment = await Payment.findOne({ publicId, ...invoicePaymentScope(auth) }).session(session);
    if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found or unavailable in your workspace.");
    const invoice = await ensurePaymentInvoice(payment, { session });
    if (!requestKey) {
      const latest = await TransactionalEmail.findOne({ kind: "INVOICE", entityId: invoice._id }).sort({ createdAt: -1, _id: -1 }).session(session);
      return invoiceDeliveryStatus(invoice, latest);
    }
    if (!invoice.customerSnapshot?.email) throw new AppError(409, "INVOICE_EMAIL_UNAVAILABLE", "This historical invoice has no recorded customer email. Download its PDF instead.");
    const eventKey = `invoice:${invoice.publicId}:resend:${sha256(`${auth.userId}:${requestKey}`)}`;
    const repeated = await TransactionalEmail.findOne({ eventKey }).session(session);
    if (repeated) return invoiceDeliveryStatus(invoice, repeated);
    // Serialize deliberate requests against this invoice, without mutating its
    // financial snapshot. A retry of the same request returns the same delivery.
    const claimed = await Invoice.findOneAndUpdate({ _id: invoice._id, $or: [{ emailLastRequestedAt: null }, { emailLastRequestedAt: { $lte: new Date(now.getTime() - 60_000) } }] }, { $set: { emailLastRequestedAt: now } }, { session, returnDocument: "after" });
    if (!claimed) throw new AppError(429, "INVOICE_EMAIL_RATE_LIMITED", "Wait one minute before requesting another invoice email.");
    if (await TransactionalEmail.exists({ kind: "INVOICE", entityId: invoice._id, status: "SENDING" }).session(session))
      throw new AppError(409, "INVOICE_EMAIL_IN_PROGRESS", "An invoice email is being sent. Check its delivery status shortly.");
    // Replace unsent work to avoid two copies when the original provider was
    // unconfigured. SENT/FAILED history is retained for audit/reconciliation.
    await TransactionalEmail.updateMany({ kind: "INVOICE", entityId: invoice._id, status: "QUEUED" }, { $set: { status: "CANCELLED" } }, { session });
    const delivery = await queueInvoiceEmail(invoice, eventKey, session);
    return invoiceDeliveryStatus(invoice, delivery);
  });
}
