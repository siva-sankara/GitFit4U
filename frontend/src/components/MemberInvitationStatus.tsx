import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../services/apiClient";
export function MemberInvitationStatus({ member, canManage }: { member: Record<string, any>; canManage?: boolean }) {
  const client = useQueryClient();
  const resend = useMutation({ mutationFn: () => apiRequest(`/api/v1/owner/members/${encodeURIComponent(member.publicId)}/invitation/resend`, { method: "POST", body: "{}" }), onSuccess: () => client.invalidateQueries({ queryKey: ["api"] }) });
  const pending = member.invitation?.status === "PENDING";
  if (!member.invitation?.status) return null;
  return <div onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <small>{pending ? member.invitation.kind === "ACTIVATE" ? "Account activation pending" : "Gym invitation pending" : "Invitation accepted"}</small>
    {pending && canManage && <button type="button" className="btn btn-secondary" disabled={resend.isPending} onClick={() => resend.mutate()}>{resend.isPending ? "Queueing…" : "Resend invitation"}</button>}
    {resend.isSuccess && <small role="status">Invitation queued. Delivery will retry if unavailable.</small>}
    {resend.isError && <small role="alert">{resend.error.message}</small>}
  </div>;
}
