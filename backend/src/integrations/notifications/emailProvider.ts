import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";

export type TransactionalEmailContent = { to: string; subject: string; html: string; text: string };
export function emailConfigured() { return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM); }
export async function sendTransactionalEmail(content: TransactionalEmailContent, eventKey: string) {
  if (!emailConfigured()) throw new AppError(503, "EMAIL_NOT_CONFIGURED", "Transactional email is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST", signal: AbortSignal.timeout(15_000), redirect: "error",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": eventKey },
    body: JSON.stringify({ from: env.EMAIL_FROM, ...content }),
  });
  // Provider response bodies may contain customer information; never log them.
  if (!response.ok) throw new AppError(502, `EMAIL_PROVIDER_${response.status}`, "The email provider could not accept this message.");
  const result = await response.json() as { id?: string };
  if (!result.id) throw new AppError(502, "EMAIL_PROVIDER_RESPONSE", "The email provider returned no message identifier.");
  return result.id;
}
export async function transactionalEmailStatus(id: string) {
  const response = await fetch(`https://api.resend.com/emails/${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(10_000), redirect: "error", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` },
  });
  if (!response.ok) throw new AppError(502, "EMAIL_STATUS_UNAVAILABLE", "Email delivery status is unavailable.");
  const result = await response.json() as { last_event?: string };
  return result.last_event;
}
