import PDFDocument from "pdfkit";
import { createRequire } from "node:module";
import sharp from "sharp";
import { Attachment } from "../models/Business.js";
import { presignedObjectUrl } from "../integrations/storage/s3ObjectStore.js";
import { logger } from "../config/logger.js";

const require = createRequire(import.meta.url);
const plain = (value: unknown, max = 1500) => Array.from(String(value ?? ""), character => {
  const codePoint = character.codePointAt(0) || 0;
  return codePoint < 32 || codePoint === 127 ? " " : character;
}).join("").trim().slice(0, max);
const readable = (value: unknown) => plain(value).replaceAll("_", " ");
const address = (value: any) => typeof value === "string" ? value : [value?.line1, value?.line2, value?.locality, value?.city, value?.state, value?.postalCode, value?.country].filter(Boolean).join(", ");
function calendar(value: unknown, timezone: string) {
  const parsed = new Date(String(value || ""));
  if (!Number.isFinite(parsed.getTime())) return "Not recorded";
  try {
    return new Intl.DateTimeFormat("en-IN", { timeZone: timezone, day: "2-digit", month: "short", year: "numeric" }).format(parsed);
  } catch {
    return new Intl.DateTimeFormat("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric" }).format(parsed);
  }
}
export async function invoiceLogo(invoice: any): Promise<Buffer | undefined> {
  const id = invoice.supplierSnapshot?.logoAttachmentId;
  if (!id || !invoice.gymId) return;
  const file = await Attachment.findOne({ _id: id, gymId: invoice.gymId, purpose: "GYM_LOGO", storageProvider: "s3", status: "READY", deletedAt: null }).lean();
  if (!file) return;
  try {
    const response = await fetch(presignedObjectUrl("GET", file.thumbnailObjectKey || file.objectKey, 120), { signal: AbortSignal.timeout(3500), redirect: "error" });
    if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 1_000_000) throw new Error("Logo unavailable");
    const chunks: Buffer[] = []; let size = 0;
    const reader = response.body.getReader();
    try {
      for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 1_000_000) throw new Error("Logo too large"); chunks.push(Buffer.from(chunk.value)); }
    } finally { await reader.cancel(); }
    return await sharp(Buffer.concat(chunks), { limitInputPixels: 4_000_000 }).resize(160, 160, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
  } catch {
    logger.warn({ invoiceId: invoice.publicId, code: "INVOICE_LOGO_UNAVAILABLE" }, "Invoice rendered with text branding because its optional logo was unavailable");
  }
}

export function renderInvoicePdf(invoice: any, currentPaymentStatus: string, logo?: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 44, bufferPages: true, info: { Title: `GETFIT4U invoice ${plain(invoice.number, 80)}`, Author: "GETFIT4U" } });
    const chunks: Buffer[] = [];
    doc.on("data", chunk => chunks.push(Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      doc.registerFont("Body", require.resolve("@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff"));
      doc.registerFont("Bold", require.resolve("@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff"));
      const ink = "#10251D", muted = "#526359", green = "#456B12", pale = "#F2F6ED";
      const width = doc.page.width - 88, bottom = doc.page.height - 64;
      let y = 36;
      const timezone = invoice.supplierSnapshot?.timezone || "Asia/Kolkata";
      const cash = (amount: unknown) => typeof amount === "number" ? `${invoice.currency || "INR"} ${(amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "Not recorded";
      const ensure = (height: number) => { if (y + height > bottom) { doc.addPage(); y = 36; } };
      const text = (value: unknown, x: number, at: number, size: number, w: number, bold = false, color = ink) => { doc.font(bold ? "Bold" : "Body").fontSize(size).fillColor(color).text(plain(value), x, at, { width: w, lineGap: 2 }); return doc.y; };
      const section = (title: string) => { ensure(34); y += 6; doc.roundedRect(44, y, width, 22, 4).fill(pale); text(title.toUpperCase(), 54, y + 5, 8.5, width - 20, true, green); y += 28; };
      const row = (name: string, value: unknown) => { const content = plain(value) || "Not recorded"; doc.font("Body").fontSize(8.5); const height = Math.max(14, doc.heightOfString(content, { width: width - 151, lineGap: 1 }) + 3); ensure(height); text(name, 44, y, 8.5, 136, false, muted); const end = text(content, 195, y, 8.5, width - 151); y = Math.max(y + 14, end + 3); };
      text("GETFIT4U", 44, y, 24, 270, true); text("INVOICE", 365, y + 5, 16, width - 321, true, green); y += 35;
      text("Gym management & fitness", 44, y, 9, width, false, muted); y += 19;
      doc.moveTo(44, y).lineTo(44 + width, y).lineWidth(2).stroke(green); y += 13;
      row("Invoice number", invoice.number);
      row("Invoice date", calendar(invoice.issuedAt, timezone));
      row("Invoice status", readable(invoice.status));
      section("Supplier / gym");
      const supplier = invoice.supplierSnapshot || {};
      if (logo) { ensure(48); doc.image(logo, 44, y, { fit: [38, 38] }); text(supplier.name, 94, y + 6, 13, width - 50, true); y += 46; }
      else { ensure(24); text(supplier.name || "GETFIT4U", 44, y, 13, width, true); y = doc.y + 6; }
      if (supplier.gymName && supplier.gymName !== supplier.name) row("Gym", supplier.gymName);
      if (supplier.ownerName) row("Gym owner", supplier.ownerName);
      if (address(supplier.address)) row("Address", address(supplier.address));
      if (supplier.contact?.phone || supplier.contact?.email) row("Contact", [supplier.contact.phone, supplier.contact.email].filter(Boolean).join(" / "));
      if (supplier.gstin || supplier.taxId) row("Tax registration", supplier.gstin || supplier.taxId);
      section("Subscriber");
      const customer = invoice.customerSnapshot || {};
      row("Name", customer.name); if (customer.memberCode) row("Member ID", customer.memberCode);
      if (customer.phone) row("Phone", customer.phone); if (customer.email) row("Email", customer.email);
      section("Membership");
      const membership = invoice.membershipSnapshot || {};
      row("Plan", membership.name || invoice.lines?.[0]?.description);
      if (membership.startsAt || membership.endsAt) row("Recorded period", `${calendar(membership.startsAt, timezone)} to ${calendar(membership.endsAt, timezone)}`);
      if (membership.durationDays) row("Duration", `${membership.durationDays} days`);
      if (membership.status) row("Status at issue", readable(membership.status));
      section("Payment summary");
      const pricing = invoice.pricingSnapshot;
      if (pricing?.breakdownUnavailable) row("Breakdown", "A separate discount/tax breakdown was not recorded for this historical payment.");
      else { row(invoice.snapshotVersion === 2 ? "Base amount" : "Recorded subtotal", cash(pricing?.subtotalMinor ?? invoice.subtotalMinor)); if (invoice.snapshotVersion === 2) row("Discount", cash(pricing?.discountMinor ?? invoice.discountMinor ?? 0)); row("Tax", cash(pricing?.taxMinor ?? invoice.taxMinor)); }
      if (pricing?.offer?.name) row("Offer", [pricing.offer.name, pricing.offer.code].filter(Boolean).join(" / "));
      ensure(35); doc.roundedRect(44, y + 2, width, 28, 4).fill(ink); text("TOTAL PAID", 55, y + 9, 9.5, 220, true, "#FFFFFF"); text(cash(invoice.totalMinor), 288, y + 7, 12, width - 255, true, "#FFFFFF"); y += 36;
      const payment = invoice.paymentSnapshot || {};
      row("Payment reference", payment.reference || String(invoice.number || "").replace(/^GFU-/, ""));
      if (payment.transactionReference) row("Transaction", payment.transactionReference);
      row("Payment method", [payment.provider, payment.method].filter(Boolean).map(readable).join(" / "));
      if (payment.paidAt) row("Payment date", calendar(payment.paidAt, timezone));
      row("Current payment status", readable(currentPaymentStatus));
      if (pricing?.offer?.terms) { section("Offer terms"); row("Terms", pricing.offer.terms); }
      ensure(34); y += 5; text("Amounts reflect the recorded transaction. Refunds do not rewrite the original payment amount. This document does not assert tax registration that was not configured.", 44, y, 7.5, width, false, muted);
      const pages = doc.bufferedPageRange();
      for (let page = pages.start; page < pages.start + pages.count; page++) { doc.switchToPage(page); doc.font("Body").fontSize(8).fillColor(muted).text(`GETFIT4U  |  Page ${page + 1} of ${pages.count}`, 44, doc.page.height - 60, { width, lineBreak: false }); }
      doc.end();
    } catch (error) { doc.destroy(); reject(error); }
  });
}
