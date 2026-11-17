import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { apiRequest } from "../services/apiClient";
export function MemberInvitationStatus({ member, canManage, actionOnly = false, compact = false }: { member: Record<string, any>; canManage?: boolean; actionOnly?: boolean; compact?: boolean }) {
  const client = useQueryClient();
  const resend = useMutation({ mutationFn: () => apiRequest(`/api/v1/owner/members/${encodeURIComponent(member.publicId)}/invitation/resend`, { method: "POST", body: "{}" }), onSuccess: () => client.invalidateQueries({ queryKey: ["api"] }) });
  const pending = member.invitation?.status === "PENDING";
  const offline = member.offlineAccessGranted === true;
  const action = offline ? member.invitation?.kind === "ACTIVATE" ? "Send login setup" : "Send welcome email" : "Resend invitation";
  if (!member.invitation?.status) return null;
  if (actionOnly && (!pending || !canManage)) return null;
  return <div className={actionOnly ? "member-invitation-action" : "member-invitation-status"} onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    {!actionOnly && <small>{pending ? offline ? member.invitation.kind === "ACTIVATE" ? "Account active · login password setup is separate from gym access" : "Membership saved · use the existing account login" : member.invitation.kind === "ACTIVATE" ? "Account activation pending" : "Gym invitation pending" : "Invitation accepted"}</small>}
    {pending && canManage && <button type="button" className={`btn btn-secondary${compact ? " member-invitation-compact" : ""}`} disabled={resend.isPending} onClick={() => resend.mutate()} aria-label={resend.isPending ? "Queueing email" : action} title={action}><Send size={16} aria-hidden="true" />{compact ? <span className="sr-only">{resend.isPending ? "Queueing…" : action}</span> : resend.isPending ? "Queueing…" : action}</button>}
    {resend.isSuccess && <small role="status">{offline ? "Welcome email queued. Gym access does not depend on email delivery." : "Invitation queued. Delivery will retry if unavailable."}</small>}
    {resend.isError && <small role="alert">{resend.error.message}</small>}
  </div>;
}
