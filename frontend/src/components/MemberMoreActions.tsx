import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();
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

  // Render outside the scrolling table so every row's actions remain reachable.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !popoverRef.current) return;
    const trigger = triggerRef.current.getBoundingClientRect();
    const popover = popoverRef.current;
    const height = popover.getBoundingClientRect().height;
    const below = window.innerHeight - trigger.bottom - 8;
    const above = trigger.top - 8;
    const showAbove = height > below && above > below;
    const available = Math.max(0, showAbove ? above : below);
    popover.style.maxHeight = `${available}px`;
    popover.style.top = `${showAbove ? Math.max(8, trigger.top - Math.min(height, available) - 4) : trigger.bottom + 4}px`;
    popover.style.left = `${Math.max(8, Math.min(trigger.right - popover.offsetWidth, window.innerWidth - popover.offsetWidth - 8))}px`;
    popover.querySelector<HTMLElement>("a, button:not(:disabled)")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: Event) => {
      if (event.target instanceof Node && !triggerRef.current?.contains(event.target) && !popoverRef.current?.contains(event.target))
        setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    const scroll = (event: Event) => {
      if (event.target instanceof Node && popoverRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const resize = () => setOpen(false);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    document.addEventListener("keydown", escape);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("keydown", escape);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [open]);
  return <>
      <button
        ref={triggerRef}
        type="button"
        className="member-row-more"
        aria-label={`More actions for ${name}`}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        title="More actions"
        onClick={() => setOpen((current) => !current)}
      >
        <MoreVertical size={19} aria-hidden="true" />
      </button>
      {open && createPortal(<div
        ref={popoverRef}
        id={popoverId}
        className="member-more-popover"
        role="group"
        aria-label={`Actions for ${name}`}
        onClick={(event) => {
          if (event.target instanceof Element && event.target.closest("a")) setOpen(false);
        }}
      >
        <Link to={details}>
          {canManage ? "View / edit member" : "View member"}
        </Link>
        {canManage && (
          <Link to={`${details}#member-membership`}>
            {member.assignedTrainerId ? "Change trainer" : "Assign trainer"}
          </Link>
        )}
        <Link to={`${details}#member-membership`}>
          Membership details
        </Link>
        {canReadFinance && (
          <Link to={`${details}#member-payments`}>
            Payment history
          </Link>
        )}
        {canManage && member.status !== "ARCHIVED" && (
          <Link to={`${details}#member-membership`}>
            Deactivate or manage access
          </Link>
        )}
        {member.invitation?.status === "PENDING" && canManage && (
          <div className="member-more-invitation">
            <MemberInvitationStatus member={member} canManage actionOnly />
          </div>
        )}
        {canDelete && (
          <button
            type="button"
            className="member-remove-action"
            onClick={() => {
              triggerRef.current?.focus();
              setOpen(false);
              setConfirmDelete(true);
            }}
          >
            <Trash2 size={16} aria-hidden="true" />
            Remove member record
          </button>
        )}
      </div>, document.body)}
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
