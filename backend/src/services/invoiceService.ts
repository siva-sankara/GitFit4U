import mongoose, { type ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { Attachment, Invoice } from "../models/Business.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { MemberProfile } from "../models/Member.js";
import { AppError } from "../utils/AppError.js";
import { queueInvoiceDelivery } from "./invoiceDeliveryService.js";

export const invoicedPaymentStates = ["CAPTURED", "PARTIALLY_REFUNDED", "REFUNDED", "REFUND_PENDING", "DISPUTED"];
export function invoicePaymentScope(auth: { role: string; userId: string; gymId?: string; permissions: string[] }) {
  if (auth.role === "ADMIN" && auth.permissions.includes("admin:platform")) return {};
  if (["GYM_OWNER", "GYM_STAFF"].includes(auth.role) && auth.gymId && auth.permissions.includes("finance:read"))
    return { $or: [{ payerId: auth.userId }, { gymId: auth.gymId }] };
  return { payerId: auth.userId };
}
const money = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
export function invoicePricing(payment: any, subscription?: any, quote?: any) {
  const source = payment.pricingSnapshot || quote || null;
  if (source) {
    const base = source.subtotalMinor, discount = source.discountMinor || 0, tax = source.taxMinor || 0;
    if (![base, discount, tax, payment.amountMinor].every(money) || discount > base || base - discount + tax !== payment.amountMinor)
      throw new AppError(409, "INVOICE_AMOUNT_MISMATCH", "The recorded payment breakdown needs review before an invoice can be downloaded.");
    return { subtotalMinor: base, discountMinor: discount, planDiscountMinor: source.planDiscountMinor, offerDiscountMinor: source.offerDiscountMinor, offer: source.offer, taxRateBasisPoints: source.taxRateBasisPoints, taxMinor: tax, totalMinor: payment.amountMinor, currency: payment.currency };
  }
  const plan = subscription?.planSnapshot;
  if (plan && money(plan.priceMinor) && money(plan.discountMinor || 0) && money(plan.taxRateBasisPoints || 0)) {
    const discount = Math.min(plan.priceMinor, plan.discountMinor || 0);
    const tax = Math.round((plan.priceMinor - discount) * (plan.taxRateBasisPoints || 0) / 10000);
    if (plan.priceMinor - discount + tax === payment.amountMinor)
      return { subtotalMinor: plan.priceMinor, discountMinor: discount, taxMinor: tax, taxRateBasisPoints: plan.taxRateBasisPoints || 0, totalMinor: payment.amountMinor, currency: payment.currency };
  }
  // Historical receipts may lack a tax/discount breakdown. Do not invent one.
  return { totalMinor: payment.amountMinor, currency: payment.currency, breakdownUnavailable: true };
}

export function invoiceCustomerSnapshot(member: any, customer: any) {
  const pending = member?.invitation?.status === "PENDING";
  return { name: member?.contact?.name || (!pending && customer?.name) || "Member", email: pending ? member?.contact?.email : customer?.email, phone: pending ? member?.contact?.phone : customer?.phone, memberCode: member?.memberCode };
}
type InvoiceOptions = { session?: ClientSession; quote?: any; subscription?: any };
export async function ensurePaymentInvoice(payment: any, options: InvoiceOptions = {}): Promise<any> {
  if (!invoicedPaymentStates.includes(payment.status) || !payment.capturedAt)
    throw new AppError(409, "INVOICE_NOT_AVAILABLE", "Invoices are available only after a payment has been confirmed.");
  if (!options.session)
    return mongoose.connection.transaction(session => ensurePaymentInvoice(payment, { ...options, session }));
  const session = options.session;
  const existing = await Invoice.findOne({ paymentId: payment._id }).session(session);
  if (existing) { await queueInvoiceDelivery(existing, session); return existing; }
  const subscription = options.subscription || (payment.subscriptionId ? await Subscription.findById(payment.subscriptionId).session(session) : null);
  const gym = payment.gymId ? await Gym.findById(payment.gymId).session(session) : null;
  const customer = await User.findById(payment.payerId).session(session);
  const owner = gym?.ownerId ? await User.findById(gym.ownerId).select("name").session(session) : null;
  const member = subscription?.memberProfileId ? await MemberProfile.findById(subscription.memberProfileId).select("memberCode contact invitation").session(session) : null;
  const pricing = invoicePricing(payment, subscription, options.quote);
  const plan = subscription?.planSnapshot || options.quote?.planSnapshot;
  const platform = payment.purpose === "PLATFORM_PLAN";
  const logo = !platform && gym?.logoAttachmentId ? await Attachment.findOneAndUpdate({ _id: gym.logoAttachmentId, gymId: gym._id, status: "READY", deletedAt: null }, { $inc: { bindingVersion: 1 } }, { session, returnDocument: "after" }).select("_id") : null;
  const fields = {
    publicId: nanoid(24), number: `GFU-${payment.publicId}`, snapshotVersion: 2, purpose: payment.purpose,
    paymentId: payment._id, subscriptionId: subscription?._id, gymId: payment.gymId, userId: payment.payerId,
    supplierSnapshot: { name: platform ? "GETFIT4U" : gym?.name || "Gym", ownerName: platform ? undefined : owner?.name, address: platform ? undefined : gym?.address, contact: platform ? undefined : gym?.contact, logoAttachmentId: logo?._id, gymName: gym?.name, timezone: gym?.timezone || "Asia/Kolkata" },
    customerSnapshot: invoiceCustomerSnapshot(member, customer),
    membershipSnapshot: subscription ? { name: plan?.name, startsAt: subscription.startsAt, endsAt: subscription.endsAt, durationDays: plan?.durationDays, status: subscription.status } : undefined,
    paymentSnapshot: { reference: payment.publicId, transactionReference: payment.providerPaymentId || payment.metadata?.reference, provider: payment.provider, method: payment.methodCategory, paidAt: payment.capturedAt, status: payment.status },
    pricingSnapshot: pricing,
    lines: [{ description: plan?.name || (platform ? "Platform subscription" : "Gym payment"), quantity: 1, unitPriceMinor: pricing.subtotalMinor, taxMinor: pricing.taxMinor, totalMinor: payment.amountMinor }],
    subtotalMinor: pricing.subtotalMinor, discountMinor: pricing.discountMinor, taxMinor: pricing.taxMinor,
    totalMinor: payment.amountMinor, currency: payment.currency, issuedAt: new Date(), status: "ISSUED",
  };
  // The existing unique invoice number provides idempotency without a new collection.
  const invoice = await Invoice.findOneAndUpdate({ number: fields.number }, { $setOnInsert: fields }, { upsert: true, returnDocument: "after", session, runValidators: true });
  await queueInvoiceDelivery(invoice, session);
  return invoice;
}

export async function paymentInvoice(publicId: string, auth: Parameters<typeof invoicePaymentScope>[0]) {
  const payment = await Payment.findOne({ publicId, ...invoicePaymentScope(auth) });
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found or unavailable in your workspace.");
  let invoice;
  try { invoice = await ensurePaymentInvoice(payment); }
  catch (error: any) {
    if (error?.code !== 11000) throw error;
    invoice = await Invoice.findOne({ paymentId: payment._id });
    if (!invoice) throw error;
  }
  // Never fetch arbitrary fields from the browser to supplement invoice content.
  return { invoice: invoice.toObject(), currentPaymentStatus: payment.status };
}
