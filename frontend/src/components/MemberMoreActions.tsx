import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MoreVertical, Trash2 } from "lucide-react";
import { MemberInvitationStatus } from "./MemberInvitationStatus";
import { Modal } from "./Modal";
import { apiRequest } from "../services/apiClient";
import { useOptionalApp } from "../context/AppContext";

export function MemberMoreActions({
  member,
  canManage,
  canReadFinance,
}: {
  member: Record<string, any>;
  canManage: boolean;
  canReadFinance: boolean;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const client = useQueryClient();
  const app = useOptionalApp();
  const name = member.contact?.name || member.userId?.name || "member";
  const details = `/owner/members/${encodeURIComponent(member.publicId)}`;
  const canDelete =
    canManage && ["INACTIVE", "SUSPENDED", "ARCHIVED"].includes(member.status);
  const remove = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/owner/members/${encodeURIComponent(member.publicId)}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      setConfirmDelete(false);
      app?.notify?.(`${name} was removed from the active member directory.`);
      void client.invalidateQueries({ queryKey: ["api"] });
    },
  });
  return <>
    <details className="member-more-menu">
      <summary
        className="member-row-more"
        aria-label={`More actions for ${name}`}
        title="More actions"
      >
        <MoreVertical size={19} aria-hidden="true" />
      </summary>
      <div className="member-more-popover" role="menu" aria-label={`Actions for ${name}`}>
        <Link role="menuitem" to={details}>
          {canManage ? "View / edit member" : "View member"}
        </Link>
        {canManage && (
          <Link role="menuitem" to={`${details}#member-membership`}>
            {member.assignedTrainerId ? "Change trainer" : "Assign trainer"}
          </Link>
        )}
        <Link role="menuitem" to={`${details}#member-membership`}>
          Membership details
        </Link>
        {canReadFinance && (
          <Link role="menuitem" to={`${details}#member-payments`}>
            Payment history
          </Link>
        )}
        {canManage && member.status !== "ARCHIVED" && (
          <Link role="menuitem" to={`${details}#member-membership`}>
            Deactivate or manage access
          </Link>
        )}
        {member.invitation?.status === "PENDING" && canManage && (
          <div className="member-more-invitation" role="menuitem">
            <MemberInvitationStatus member={member} canManage actionOnly />
          </div>
        )}
        {canDelete && (
          <button
            type="button"
            className="member-remove-action"
            role="menuitem"
            onClick={() => setConfirmDelete(true)}
          >
            <Trash2 size={16} aria-hidden="true" />
            Remove member record
          </button>
        )}
      </div>
    </details>
    <Modal
      open={confirmDelete}
      title={`Remove ${name}?`}
      onClose={() => !remove.isPending && setConfirmDelete(false)}
    >
      <div className="page-stack">
        <p>
          This soft-deletes the gym member record from active lists. Payments,
          attendance, conversations and audit history are retained.
        </p>
        {remove.isError && <p className="form-alert" role="alert">{remove.error.message}</p>}
        <div className="heading-actions">
          <button
            type="button"
            className="btn btn-secondary"
            disabled={remove.isPending}
            onClick={() => setConfirmDelete(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            {remove.isPending ? "Removing…" : "Remove member"}
          </button>
        </div>
      </div>
    </Modal>
  </>;
}
