import { useRef, useState } from "react";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { useOptionalApp } from "../context/AppContext";
import { WhatsAppIcon } from "./WhatsAppIcon";

type ReminderReason =
  | "activation_invitation"
  | "renewal_reminder"
  | "payment_reminder"
  | "general_followup";

type ReminderResult = {
  communicationId: string;
  mode: "integrated" | "fallback";
  status: string;
  waUrl?: string;
  message: string;
  messageType: ReminderReason;
  inAppMessageCreated: boolean;
  notificationCreated: boolean;
};

export function memberReminderReason(member: Record<string, any>): ReminderReason {
  if (member.invitation?.status === "PENDING") return "activation_invitation";
  const subscription = member.currentSubscriptionId;
  if (member.directAccess && !subscription) return "general_followup";
  const payment = subscription?.latestPaymentId;
  if (
    subscription &&
    (subscription.status === "PENDING_PAYMENT" ||
      !payment ||
      ["CREATED", "PENDING", "AUTHORIZED", "FAILED", "CANCELLED"].includes(
        payment.status,
      ))
  )
    return "payment_reminder";
  if (
    subscription &&
    ["ACTIVE", "GRACE"].includes(subscription.status) &&
    subscription.renewalAt
  )
    return "renewal_reminder";
  return "general_followup";
}

export function MemberWhatsAppReminderAction({
  member,
  canManage,
}: {
  member: Record<string, any>;
  canManage: boolean;
}) {
  const app = useOptionalApp();
  const notify = app?.notify || (() => undefined);
  const busy = useRef(false);
  const requestKey = useRef(crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const name = member.contact?.name || member.userId?.name || "member";

  async function sendReminder() {
    if (busy.current || !canManage || !member.publicId) return;
    busy.current = true;
    setPending(true);
    try {
      const response = await apiRequest<ApiEnvelope<ReminderResult>>(
        `/api/v1/owner/members/${encodeURIComponent(member.publicId)}/communication/whatsapp-reminder`,
        {
          method: "POST",
          idempotencyKey: requestKey.current,
          body: JSON.stringify({
            reason: memberReminderReason(member),
            source: "members_list",
          }),
        },
      );
      if (response.data.mode === "fallback") {
        if (!response.data.waUrl)
          throw new Error("WhatsApp hand-off is unavailable for this member.");
        window.open(
          response.data.waUrl,
          "_blank",
          "noopener,noreferrer",
        );
        notify("WhatsApp opened with reminder text.");
      } else {
        notify("WhatsApp reminder queued.");
      }
      requestKey.current = crypto.randomUUID();
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "WhatsApp reminder could not be prepared.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      className="member-row-more member-row-whatsapp"
      onClick={() => void sendReminder()}
      disabled={!canManage || !member.publicId || pending}
      aria-label={
        pending
          ? `Preparing WhatsApp reminder for ${name}`
          : `Send WhatsApp reminder to ${name}`
      }
      title={
        canManage
          ? pending
            ? "Preparing WhatsApp reminder"
            : "Send WhatsApp reminder"
          : "Member management permission is required"
      }
    >
      <span className={pending ? "member-action-spinning" : undefined}>
        <WhatsAppIcon size={19} />
      </span>
    </button>
  );
}
