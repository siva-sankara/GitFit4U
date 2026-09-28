import type { ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { Conversation, Message } from "../models/Collaboration.js";
import { emitDomainEvent } from "./domainEventService.js";
import { appEmailUrl, emailTemplate, queueTransactionalEmail } from "./transactionalEmailService.js";

export const invoiceAccountUrl = (invoice: any) => invoice.purpose === "PLATFORM_PLAN" ? "/owner/payments" : "/app/profile/payments";
export async function queueInvoiceEmail(invoice: any, eventKey: string, session: ClientSession) {
  return queueTransactionalEmail({ eventKey, userId: invoice.userId, kind: "INVOICE", entityId: invoice._id, content: { to: invoice.customerSnapshot.email, ...emailTemplate("Your invoice is ready", `Your payment receipt ${invoice.number} from ${invoice.supplierSnapshot.name} is available in your GETFIT4U account.`, "View / Download Invoice", appEmailUrl(invoiceAccountUrl(invoice)), "Sign in to securely view or download the PDF. This link does not grant access to another account's financial records.") } }, session);
}

// Invoked inside the same transaction that creates/reuses the immutable invoice.
// No network calls occur until the email worker sees the committed outbox row.
export async function queueInvoiceDelivery(invoice: any, session: ClientSession) {
  const actionUrl = invoiceAccountUrl(invoice);
  const conversation = await Conversation.findOneAndUpdate({ directKey: `system:billing:${invoice.userId}` }, { $setOnInsert: { publicId: nanoid(24), type: "SYSTEM", participants: [invoice.userId], title: "GETFIT4U receipts" } }, { upsert: true, returnDocument: "after", session });
  const message = await Message.findOneAndUpdate({ senderId: null, clientMessageId: `invoice:${invoice.publicId}` }, { $setOnInsert: { publicId: nanoid(24), senderId: null, clientMessageId: `invoice:${invoice.publicId}`, conversationId: conversation._id, type: "SYSTEM", text: `Invoice ${invoice.number} is available. View or download it from your payments.`, actionUrl, invoiceId: invoice._id } }, { upsert: true, returnDocument: "after", session, runValidators: true });
  await Conversation.updateOne({ _id: conversation._id, $or: [{ lastMessageAt: { $lte: message.createdAt } }, { lastMessageId: null }] }, { $set: { lastMessageId: message._id, lastMessageAt: message.createdAt } }, { session });
  await emitDomainEvent({ event: "invoice.ready", userId: invoice.userId, gymId: invoice.gymId, entityId: invoice.publicId, actionUrl, actionLabel: "View invoice", session });
  if (invoice.customerSnapshot?.email) await queueInvoiceEmail(invoice, `invoice:${invoice.publicId}`, session);
}
