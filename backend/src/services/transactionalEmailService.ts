import crypto from "node:crypto";
import type { ClientSession } from "mongoose";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { AccountInvitation, TransactionalEmail } from "../models/Delivery.js";
import { emailConfigured, sendTransactionalEmail, transactionalEmailStatus, type TransactionalEmailContent } from "../integrations/notifications/emailProvider.js";

const key = () => crypto.createHmac("sha256", env.EMAIL_ENCRYPTION_KEY || env.JWT_REFRESH_SECRET).update("getfit4u.transactional-email.v1").digest();
export function encryptEmail(content: TransactionalEmailContent) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(content), "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(value => value.toString("base64url")).join(".");
}
export function decryptEmail(value: string): TransactionalEmailContent {
  const [iv, tag, data] = value.split(".").map(part => Buffer.from(part, "base64url"));
  const cipher = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  cipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8"));
}
export const escapeEmailHtml = (value: string) => value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
export function appEmailUrl(path: string) {
  const origin = env.CLIENT_ORIGIN.split(",")[0].trim();
  const url = new URL(path, origin);
  if (!/^https?:$/.test(url.protocol) || (env.NODE_ENV === "production" && url.protocol !== "https:")) throw new Error("EMAIL_ORIGIN_INVALID");
  return url.toString();
}
export function emailTemplate(title: string, message: string, action: string, url: string, guidance: string) {
  const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#182235"><h2>GETFIT4U</h2><h1 style="font-size:24px">${escapeEmailHtml(title)}</h1><p>${escapeEmailHtml(message)}</p><p><a style="display:inline-block;padding:14px 20px;background:#185a46;color:white;border-radius:8px" href="${escapeEmailHtml(url)}">${escapeEmailHtml(action)}</a></p><p>${escapeEmailHtml(guidance)}</p></div>`;
  return { subject: `GETFIT4U — ${title}`, html, text: `${title}\n\n${message}\n\n${action}: ${url}\n\n${guidance}` };
}
export async function queueTransactionalEmail(input: { eventKey: string; userId: any; kind: "INVITATION" | "INVOICE"; entityId: any; revision?: number; content: TransactionalEmailContent }, session?: ClientSession) {
  const { content, ...record } = input;
  return TransactionalEmail.findOneAndUpdate({ eventKey: input.eventKey }, { $setOnInsert: { ...record, encryptedPayload: encryptEmail(content), status: "QUEUED", nextAttemptAt: new Date() } }, { upsert: true, returnDocument: "after", ...(session ? { session } : {}) });
}
export async function deliverTransactionalEmails(limit = 20, now = new Date()) {
  // Missing credentials keep durable work queued and do not reverse receipts.
  if (!emailConfigured()) return { configured: false, processed: 0 };
  let processed = 0;
  for (; processed < limit; processed++) {
    const leaseToken = crypto.randomUUID();
    const row = await TransactionalEmail.findOneAndUpdate({ $or: [{ status: "QUEUED", nextAttemptAt: { $lte: now } }, { status: "SENDING", leaseUntil: { $lte: now } }] }, { $set: { status: "SENDING", leaseToken, leaseUntil: new Date(now.getTime() + 60_000) }, $inc: { attempts: 1 } }, { sort: { createdAt: 1 }, returnDocument: "after" }).select("+encryptedPayload");
    if (!row) break;
    const claim = { _id: row._id, leaseToken };
    try {
      // Resend retains idempotency keys for 24h. Never automatically replay an
      // ambiguous send beyond that horizon; operations must reconcile it first.
      if (row.firstAttemptAt && now.getTime() - row.firstAttemptAt.getTime() >= 23 * 3600_000) {
        await TransactionalEmail.updateOne(claim, { $set: { status: "FAILED", lastErrorCode: "EMAIL_RECONCILIATION_REQUIRED" } });
        continue;
      }
      if (row.kind === "INVITATION" && !await AccountInvitation.exists({ _id: row.entityId, revision: row.revision, consumedAt: null, expiresAt: { $gt: now } })) {
        await TransactionalEmail.updateOne(claim, { $set: { status: "CANCELLED" } });
        continue;
      }
      if (!row.firstAttemptAt) await TransactionalEmail.updateOne(claim, { $set: { firstAttemptAt: now } });
      const providerMessageId = await sendTransactionalEmail(decryptEmail(row.encryptedPayload), row.eventKey);
      await TransactionalEmail.updateOne(claim, { $set: { status: "SENT", sentAt: now, providerMessageId, nextCheckAt: new Date(now.getTime() + 60_000) }, $unset: { encryptedPayload: 1, lastErrorCode: 1, leaseToken: 1, leaseUntil: 1 } });
    } catch (error: any) {
      const code = typeof error?.code === "string" && /^[A-Z0-9_]+$/.test(error.code) ? error.code : "EMAIL_DELIVERY_FAILED";
      await TransactionalEmail.updateOne(claim, { $set: { status: row.attempts >= 8 ? "FAILED" : "QUEUED", lastErrorCode: code, nextAttemptAt: new Date(now.getTime() + Math.min(3600_000, 30_000 * 2 ** row.attempts)) }, $unset: { leaseToken: 1, leaseUntil: 1 } });
      logger.warn({ event: "email.delivery.retry", emailId: String(row._id), code }, "Transactional email delivery deferred");
    }
  }
  const sent = await TransactionalEmail.find({ status: "SENT", nextCheckAt: { $lte: now }, sentAt: { $gte: new Date(now.getTime() - 7 * 86400_000) } }).sort({ nextCheckAt: 1 }).limit(limit);
  for (const row of sent) {
    try {
      const status = await transactionalEmailStatus(row.providerMessageId);
      await TransactionalEmail.updateOne({ _id: row._id, status: "SENT" }, { $set: { nextCheckAt: new Date(now.getTime() + 30 * 60_000), ...(status === "delivered" ? { status: "DELIVERED", deliveredAt: now } : ["bounced", "complained", "failed"].includes(status || "") ? { status: "BOUNCED", lastErrorCode: `EMAIL_${status!.toUpperCase()}` } : {}) } });
    } catch { await TransactionalEmail.updateOne({ _id: row._id }, { $set: { nextCheckAt: new Date(now.getTime() + 30 * 60_000) } }); }
  }
  return { configured: true, processed };
}
