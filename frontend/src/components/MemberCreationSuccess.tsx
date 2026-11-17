import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Modal } from "./Modal";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { WhatsAppInvitationCard, type Invitation } from "./MembershipWhatsAppUpdates";
import "../styles/whatsapp-updates.css";

export type MemberCreationResult = {
  member: { publicId: string; memberCode: string; status: string; contact: { name: string; email?: string; phone?: string } };
  subscription: { publicId: string; status: string; startsAt: string; endsAt: string; planSnapshot: { name: string } };
  payment: { amountMinor: number; currency: string; methodCategory: string; status: string };
  account: { state: "NEW" | "EXISTING"; status: string; firstAccessPending: boolean };
  gym: { name: string; timezone: string }; temporaryCredential?: { password: string; expiresAt: string }; replayed?: boolean;
};
type Welcome = { recipient: string; phone?: string; message: string; chatUrl: string | null; invitation: Invitation | null; delivery: string };
const deliveryLabels: Record<string, string> = {
  NOT_REQUESTED: "Welcome email not requested.",
  QUEUED: "Welcome email queued.",
  SENDING: "Submitting welcome email to the provider.",
  SENT: "Accepted by the email provider. Inbox delivery is not confirmed.",
  DELIVERED: "Email delivery confirmed by the provider.",
  FAILED: "Welcome email failed or needs delivery review. Membership and payment remain saved.",
  BOUNCED: "Welcome email could not reach the recipient. Membership and payment remain saved.",
  CANCELLED: "This welcome email expired or was replaced. A new welcome can be requested.",
};
export function MemberCreationSuccess({ saved, onClose, scope }: { saved: MemberCreationResult; onClose: () => void; scope: string }) {
  const [revealed, setRevealed] = useState(false), [status, setStatus] = useState(""), [error, setError] = useState("");
  const [sending, setSending] = useState(false), [preview, setPreview] = useState(false), [composerOpened, setComposerOpened] = useState(false);
  const [queued, setQueued] = useState(false);
  const requestKey = useRef(crypto.randomUUID());
  const endpoint = `/api/v1/owner/members/${encodeURIComponent(saved.member.publicId)}/welcome`;
  const welcome = useQuery({ queryKey: ["member-welcome", scope, saved.member.publicId], queryFn: ({ signal }) => apiRequest<ApiEnvelope<Welcome>>(endpoint, { signal }), gcTime: 0, staleTime: 0, retry: false, refetchInterval: query => ["QUEUED", "SENDING"].includes(query.state.data?.data.delivery || "") ? 10000 : false });
  const details = welcome.data?.data;
  const date = (value: string) => new Date(value).toLocaleDateString("en-IN", { dateStyle: "medium", timeZone: saved.gym.timezone });
  async function send() {
    if (!details || sending) return;
    setSending(true); setError("");
    try { await apiRequest(endpoint, { method: "POST", body: JSON.stringify({ recipient: details.recipient }), idempotencyKey: requestKey.current }); setQueued(true); setStatus("Welcome email queued. Delivery may retry; membership and payment are already saved."); void welcome.refetch(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Could not queue email. Membership and payment remain saved."); }
    finally { setSending(false); }
  }
  async function copyPassword() {
    try {
      if (!navigator.clipboard || !saved.temporaryCredential) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(saved.temporaryCredential.password);
      setStatus("Temporary password copied. Share it privately with the member.");
    } catch { setError("Copy unavailable. Reveal the password to copy it manually."); }
  }
  return <Modal open title="Member and payment saved" onClose={onClose} wide className="member-success-modal" footer={<div className="heading-actions"><Link className="btn btn-secondary" to={`/owner/members/${encodeURIComponent(saved.member.publicId)}`} onClick={onClose}>View Member</Link><button className="btn btn-primary" type="button" onClick={onClose}>Done</button></div>}>
    <div className="page-stack member-success-content">
      <h2>{saved.member.contact.name}</h2>
      <dl className="member-success-details"><div><dt>Gym / plan</dt><dd>{saved.gym.name} · {saved.subscription.planSnapshot.name}</dd></div><div><dt>Membership</dt><dd>{saved.subscription.status === "SCHEDULED" ? "Scheduled — access starts on the start date" : "Active"}</dd></div><div><dt>Validity</dt><dd>{date(saved.subscription.startsAt)} – {date(saved.subscription.endsAt)}</dd></div><div><dt>Payment recorded</dt><dd>{new Intl.NumberFormat("en-IN", { style: "currency", currency: saved.payment.currency }).format(saved.payment.amountMinor / 100)} · {saved.payment.methodCategory}</dd></div><div><dt>Member reference</dt><dd>{saved.member.memberCode}</dd></div><div><dt>Login email / phone</dt><dd>{saved.member.contact.email || "—"}<br />{saved.member.contact.phone || "—"}</dd></div><div><dt>Account</dt><dd>{saved.account.state === "NEW" ? "New account enabled" : "Existing account linked; existing credentials preserved"}</dd></div><div><dt>First access</dt><dd>{saved.account.firstAccessPending ? "Contact verification and a new password are required before sign-in completes" : "Use the existing GETFIT4U login"}</dd></div></dl>
      {saved.temporaryCredential && <section className="member-bootstrap page-stack" aria-label="Temporary first-access password"><strong>Temporary password — change on first login</strong><p>This is shown once. It opens setup only; the member must verify their email and choose their own password. Expires {new Date(saved.temporaryCredential.expiresAt).toLocaleString()}.</p><div className="heading-actions"><input className="input" aria-label="Temporary password" type={revealed ? "text" : "password"} value={saved.temporaryCredential.password} readOnly autoComplete="off" /><button className="btn btn-secondary" type="button" onClick={() => setRevealed(!revealed)}>{revealed ? "Hide" : "Reveal"}</button><button className="btn btn-secondary" type="button" onClick={() => void copyPassword()}>Copy password</button></div></section>}
      {saved.replayed && <p role="status">This member was already saved. Temporary passwords cannot be recovered. Send a setup email if needed.</p>}
      <section className="page-stack"><h3>Welcome message</h3>{welcome.isPending && <p>Loading recorded recipient…</p>}{welcome.isError && <p role="alert">Welcome details could not be loaded. <button className="btn btn-secondary" onClick={() => void welcome.refetch()}>Retry</button></p>}
        {details && <><p role="status">{deliveryLabels[details.delivery] || "Email status unavailable."}</p><p>Email recipient: <strong>{details.recipient}</strong></p><p className="subtle">Sending confirms this recorded recipient. Passwords are never included in email or WhatsApp.</p><div className="heading-actions"><button className="btn btn-secondary" type="button" disabled={sending || queued} onClick={() => void send()}>{sending ? "Queueing…" : "Send Welcome Email"}</button><button className="btn btn-secondary" type="button" disabled={!details.chatUrl} onClick={() => setPreview(!preview)}>Open Welcome in WhatsApp</button></div>{preview && <div className="page-stack"><p>WhatsApp recipient: {details.phone}</p><pre className="welcome-preview">{details.message}</pre><a className="btn btn-primary" href={details.chatUrl!} target="_blank" rel="noopener noreferrer" onClick={() => setComposerOpened(true)}>Open WhatsApp composer</a><p>Review the recipient and message in WhatsApp, then press Send yourself.</p></div>}{composerOpened && <p role="status">Composer opened. Sending and delivery are not confirmed by GETFIT4U.</p>}{details.invitation && <WhatsAppInvitationCard invitation={details.invitation} />}</>}
      </section>{status && <p role="status">{status}</p>}{error && <p role="alert">{error}</p>}
    </div>
  </Modal>;
}
