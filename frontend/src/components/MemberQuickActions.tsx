import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { MessageCircle, Phone } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import { normalizeContactPhone } from "../utils/contactPhone";
import "../styles/member-quick-actions.css";

export function MemberQuickActions({ member, expanded = false }: {
  member: Record<string, any>; expanded?: boolean;
}) {
  const navigate = useNavigate(), busy = useRef(false);
  const [pending, setPending] = useState(false), [error, setError] = useState("");
  const account = typeof member.userId === "object" ? member.userId : undefined;
  const name = member.contact?.name || account?.name || "member";
  const phone = normalizeContactPhone(account?.phone);
  const available = Boolean(account?._id && (!account.status || account.status === "ACTIVE"));
  async function message() {
    if (busy.current || !available) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      const result = await apiRequest<ApiEnvelope<{ publicId: string }>>("/api/v1/conversations", {
        method: "POST", body: JSON.stringify({ participantIds: [account._id], type: "DIRECT" }),
      });
      if (!result.data?.publicId) throw new Error("Conversation unavailable. Please try again.");
      navigate("/messages/" + encodeURIComponent(result.data.publicId));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not open this conversation.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return <span className="member-quick-actions" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()}>
    <span className="member-quick-action-buttons">
      {phone ? <a className="member-quick-action" href={"tel:" + phone} title={"Call registered number: " + phone} aria-label={"Call " + name}>
        <Phone size={18} aria-hidden="true" />{expanded && <span>Call</span>}
      </a> : <span title="Registered phone number unavailable"><button type="button" className="member-quick-action" disabled aria-label={"Call " + name + ": registered phone number unavailable"}>
        <Phone size={18} aria-hidden="true" />{expanded && <span>Call</span>}
      </button></span>}
      <button type="button" className="member-quick-action" onClick={() => void message()} disabled={!available || pending}
        title={available ? "Open conversation with " + name : "An active registered account is required"}
        aria-label={pending ? "Opening conversation with " + name : "Message " + name}>
        <MessageCircle size={18} aria-hidden="true" />{expanded && <span>{pending ? "Opening…" : "Message"}</span>}
      </button>
    </span>
    {error && <span className="member-quick-error" role="alert">{error}</span>}
  </span>;
}
