import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCurrentUser } from "../api/hooks";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { navigationSessionScope } from "../services/navigationSession";
import { validWhatsAppInvite } from "../services/whatsappInvite";
import "../styles/whatsapp-updates.css";
import { QRCodeSVG } from "qrcode.react";
import { Modal } from "./Modal";

export type Invitation = { gymName: string; type: "group" | "channel"; displayName: string; inviteUrl: string; description: string; version: number; qrUrl?: string };
export function MembershipWhatsAppUpdates({ membershipId }: { membershipId: string }) {
  const me = useCurrentUser().data?.data;
  const query = useQuery({
    queryKey: ["membership-whatsapp-updates", navigationSessionScope(me?.context), me?.user?._id, membershipId],
    queryFn: ({ signal }) => apiRequest<ApiEnvelope<Invitation | null>>(`/api/v1/users/me/subscriptions/${encodeURIComponent(membershipId)}/whatsapp-updates`, { signal }),
    enabled: Boolean(me?.user?._id && membershipId), staleTime: 0, gcTime: 0, retry: false,
    refetchOnWindowFocus: "always",
  });
  // Hide cached invitations while rechecking access/link changes, including when
  // returning from WhatsApp. No joined state is inferred from browser visibility.
  if (query.isFetching || query.isPending) return null;
  if (query.isError) return <section className="membership-whatsapp-updates" role="alert"><p>Your membership is unchanged. WhatsApp updates could not be loaded.</p><button className="btn btn-secondary" onClick={() => void query.refetch()}>Retry invitation</button></section>;
  const invitation = query.data?.data;
  if (!invitation || !validWhatsAppInvite(invitation.inviteUrl, invitation.type)) return null;
  return <WhatsAppInvitationCard invitation={invitation} />;
}
export function OwnersWhatsAppInvitation() {
  const me = useCurrentUser().data?.data;
  const query = useQuery({ queryKey: ["owners-whatsapp", navigationSessionScope(me?.context)],
    queryFn: ({ signal }) => apiRequest<ApiEnvelope<Invitation | null>>("/api/v1/owner/platform/whatsapp-invitation", { signal }),
    enabled: me?.context?.role === "GYM_OWNER" && Boolean(me.context.gymId), staleTime: 0, gcTime: 0, retry: false, refetchOnWindowFocus: "always" });
  if (query.isFetching || !query.data?.data) return null;
  return <WhatsAppInvitationCard invitation={query.data.data} owners />;
}
export function WhatsAppInvitationCard({ invitation, owners = false }: { invitation: Invitation; owners?: boolean }) {
  const [copyStatus, setCopyStatus] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [failedQrUrl, setFailedQrUrl] = useState<string>();
  if (!validWhatsAppInvite(invitation.inviteUrl, invitation.type)) return null;
  const qr = invitation.qrUrl && failedQrUrl !== invitation.qrUrl ? <img className="invitation-qr" src={invitation.qrUrl} alt={`${invitation.displayName} invitation QR`} referrerPolicy="no-referrer" onError={() => setFailedQrUrl(invitation.qrUrl)} /> : <QRCodeSVG className="invitation-qr" value={invitation.inviteUrl} size={240} marginSize={4} bgColor="#ffffff" fgColor="#000000" level="M" />;
  return <section className="membership-whatsapp-updates" aria-label="WhatsApp updates">
    <span className="eyebrow">WhatsApp updates</span>
    <h3>{invitation.type === "group" ? "Join" : "Follow"} {invitation.gymName} on WhatsApp</h3>
    <strong>{invitation.displayName}</strong>
    <p>{invitation.description || "Receive gym timings, class updates and announcements."}</p>
    <div className="heading-actions">
      <a className="btn btn-primary" href={invitation.inviteUrl} target="_blank" rel="noopener noreferrer">{invitation.type === "group" ? owners ? "Join Owners Group" : "Join WhatsApp Group" : "Follow WhatsApp Channel"}</a>
      <button className="btn btn-secondary" type="button" onClick={() => setQrOpen(true)}>View QR</button>
      <button className="btn btn-secondary" type="button" onClick={() => {
        if (!navigator.clipboard) { setCopyStatus("Copy is unavailable. Use the invitation button to open WhatsApp."); return; }
        void navigator.clipboard.writeText(invitation.inviteUrl).then(() => setCopyStatus("Link copied."), () => setCopyStatus("Could not copy. Use the invitation button to open WhatsApp."));
      }}>Copy link</button>
    </div>
    {copyStatus && <p role="status">{copyStatus}</p>}
    <details><summary>Scan invitation QR</summary>{qr}</details>
    <Modal open={qrOpen} title={invitation.displayName} onClose={() => setQrOpen(false)}>{qr}<p>On this device, use the invitation button. This QR is for WhatsApp, not gym attendance.</p><a className="btn btn-primary" href={invitation.inviteUrl} target="_blank" rel="noopener noreferrer">Open invitation</a></Modal>
    <p className="subtle">{invitation.type === "group" ? "Your phone number is visible to other group members. The gym may need to approve your request." : "Channels are a separate way to follow announcements, not a private membership gate enforced by GETFIT4U."} Joining is optional and does not change your paid gym access.</p>
    <details><summary>Need help opening the invitation?</summary><p>Open the link in WhatsApp or its supported web experience. If the link was reset, the group is full, or approval is pending, contact your gym. GETFIT4U cannot verify joining or remove members from WhatsApp.</p></details>
  </section>;
}
