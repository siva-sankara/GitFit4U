import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { MessageCircle, Send, Users } from "lucide-react";
import { useCurrentUser } from "../../api/hooks";
import { apiRequest } from "../../services/apiClient";
import { navigationSessionScope } from "../../services/navigationSession";
import { PageHeader } from "../../components/PageHeader";
import { Modal } from "../../components/Modal";
import { Pagination } from "../../components/DataListControls";
import { StatusBadge } from "../../components/StatusBadge";
import { gymDate, membershipPresentation } from "../../components/MembershipStatusDot";
import {
  messagePresets, messageVariables, prepareRecipients, recipientMessage, renderWhatsAppMessage, whatsAppDeepLinkProvider,
  type MessageType, type MessagingEnvelope, type RecipientProgress, type WhatsAppMember,
} from "../../services/manualWhatsApp";
import "../../styles/manual-whatsapp.css";

const filters = [["", "All Members"], ["ACTIVE", "Active"], ["EXPIRING", "Expiring Soon"], ["EXPIRED", "Expired"], ["FROZEN", "Frozen"], ["DEACTIVATED", "Inactive"]];
const progressLabel = { PENDING: "Pending", OPENED_WHATSAPP: "WhatsApp opened", PROCESSED_BY_OWNER: "Processed", SKIPPED: "Skipped" };

export function OwnerWhatsAppMessagingPage() {
  const me = useCurrentUser();
  const context = me.data?.data.context;
  if (context?.role !== "GYM_OWNER" || !context.permissions.includes("member:read"))
    return <p role="alert">Gym owner access is required for WhatsApp Messaging.</p>;
  const scope = navigationSessionScope(context) || `${context.userId}:${context.gymId}`;
  // A gym/account switch discards drafts, selections and the recipient queue.
  return <MessagingWorkspace key={scope} scope={scope} />;
}

function MessagingWorkspace({ scope }: { scope: string }) {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [selected, setSelected] = useState<string[]>([]);
  const [type, setType] = useState<MessageType>("renewal");
  const [drafts, setDrafts] = useState({ general: messagePresets.general.text as string, custom: "" });
  const [previewIndex, setPreviewIndex] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [batch, setBatch] = useState<RecipientProgress[] | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchStarted, setBatchStarted] = useState(false);
  const [generic, setGeneric] = useState("Hi everyone,\n\nAn update from {{gymName}}:\n\n");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const composer = useRef<HTMLElement>(null);
  const memberScroll = useRef<HTMLDivElement>(null);
  useEffect(() => { const timer = window.setTimeout(() => setDebouncedSearch(search), 300); return () => clearTimeout(timer); }, [search]);
  const queryString = new URLSearchParams({ view: "messaging", page: String(page), limit: String(limit), q: debouncedSearch, membershipStatus: filter });
  const query = useQuery({
    queryKey: ["manual-whatsapp-members", scope, queryString.toString()],
    queryFn: ({ signal }) => apiRequest<MessagingEnvelope>(`/api/v1/owner/members?${queryString}`, { signal }),
  });
  const rows = query.data?.data || [];
  const context = query.data?.meta;
  const busy = query.isFetching || search !== debouncedSearch;
  const recipients = rows.filter(row => selected.includes(row.publicId));
  const editable = type === "general" || type === "custom";
  const template = editable ? drafts[type] : messagePresets[type].text;
  const previewMember = recipients[Math.min(previewIndex, recipients.length - 1)];
  const preview = context && previewMember ? recipientMessage(previewMember, template, context) : null;
  const genericPreview = context ? renderWhatsAppMessage(generic, context) : null;
  const current = batch?.findIndex(item => item.status === "PENDING" || item.status === "OPENED_WHATSAPP") ?? -1;
  const currentRecipient = batch && current >= 0 ? batch[current] : null;
  const clearSelection = () => { setSelected([]); setPreviewIndex(0); };
  function changeList(change: () => void) {
    clearSelection(); setNotice(""); setError("");
    if (memberScroll.current) memberScroll.current.scrollTop = 0;
    change();
  }
  function selectVisible(state?: string) {
    if (!context) return;
    setSelected(rows.filter(row => {
      const status = membershipPresentation(row, context.timezone, new Date(context.serverNow)).state;
      return !state || status === state || (state === "ACTIVE" && status === "EXPIRING");
    }).map(row => row.publicId));
    setPreviewIndex(0);
  }
  function openMember(member: WhatsAppMember, normalChat = false) {
    if (!context) return;
    setError(""); setNotice("");
    const text = normalChat ? (editable ? drafts[type] : drafts.custom) : template;
    const result = recipientMessage(member, text, context);
    const issues = normalChat && !text.trim()
      ? result.issues.filter(issue => issue.includes("valid mobile number")) : result.issues;
    if (issues.length) { setError(issues.join(" ")); return; }
    try {
      whatsAppDeepLinkProvider.openChat(member.chatUrl!, normalChat && !text.trim() ? undefined : result.text);
      setNotice(`WhatsApp opened for ${member.name}. Send the message in WhatsApp; if no tab appeared, allow pop-ups and try again.`);
    } catch (failure) { setError((failure as Error).message); }
  }
  function startBatch() {
    if (!context || recipients.length < 2) return;
    setBatch(prepareRecipients(recipients, template, context)); setBatchStarted(false); setBatchOpen(true);
  }
  function updateCurrent(status: RecipientProgress["status"]) {
    setBatch(previous => previous?.map((item, index) => index === current ? { ...item, status } : item) || null);
  }
  function insertVariable(key: string) {
    if (!editable || !textarea.current) return;
    const element = textarea.current;
    const start = element.selectionStart, end = element.selectionEnd;
    const token = `{{${key}}}`;
    const next = template.slice(0, start) + token + template.slice(end);
    if (next.length > 4000) return;
    setDrafts({ ...drafts, [type]: next });
    requestAnimationFrame(() => { element.focus(); element.setSelectionRange(start + token.length, start + token.length); });
  }
  return <div className="page-stack manual-whatsapp">
    <nav className="message-channel-tabs" aria-label="Message channels">
      <Link to="/owner/messages?channel=internal">In-app messages</Link>
      <Link to="/owner/whatsapp" aria-current="page">WhatsApp Messaging</Link>
      <Link to="/owner/messages?channel=whatsapp">WhatsApp Business</Link>
    </nav>
    <PageHeader><div><h1>WhatsApp Messaging</h1><p>Select members and prepare a message. You send each message in WhatsApp.</p></div><Link className="btn btn-secondary" to="/owner/gym-profile#gym-communication">Group settings</Link></PageHeader>
    {notice && <p role="status" className="wa-notice">{notice}</p>}
    {error && <p role="alert" className="form-alert">{error}</p>}
    <div className="wa-workspace">
      <section className="panel wa-members" aria-label="Gym members">
        <div className="wa-filters">
          <label>Search members<input type="search" placeholder="Name, mobile number or plan" maxLength={120} value={search} onChange={event => changeList(() => { setSearch(event.target.value); setPage(1); })} /></label>
          <label>Membership status<select value={filter} onChange={event => changeList(() => { setFilter(event.target.value); setPage(1); })}>{filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        <div className="wa-selection-tools">
          <label className="wa-check"><input type="checkbox" disabled={!rows.length || busy} checked={rows.length > 0 && recipients.length === rows.length} onChange={event => event.target.checked ? selectVisible() : clearSelection()} />Select All Visible</label>
          <div className="wa-buttons">{[["ACTIVE", "Select Active"], ["EXPIRING", "Select Expiring Soon"], ["EXPIRED", "Select Expired"]].map(([state, label]) => <button className="btn btn-ghost" key={state} disabled={busy || !rows.length} onClick={() => selectVisible(state)}>{label}</button>)}</div>
          <p>{recipients.length} selected · Visible page only. Changing search, filters or pages clears selection.</p>
        </div>
        <div className="wa-member-scroll" role="region" aria-label="Member list" tabIndex={0} ref={memberScroll}>
        {query.isPending && <p role="status">Loading members…</p>}
        {query.isError && <div role="alert"><p>{query.error.message}</p><button className="btn btn-secondary" onClick={() => void query.refetch()}>Retry members</button></div>}
        {!query.isPending && !query.isError && !rows.length && <p className="wa-empty">No members match this search. Try another filter.</p>}
        <ul className="wa-member-list" aria-busy={busy}>
          {context && rows.map(member => {
            const view = membershipPresentation(member, context.timezone, new Date(context.serverNow));
            return <li key={member.publicId} className={selected.includes(member.publicId) ? "wa-member is-selected" : "wa-member"}>
              <label className="wa-check wa-member-identity">
                <input type="checkbox" aria-label={`Select ${member.name}`} disabled={busy} checked={selected.includes(member.publicId)} onChange={event => { setSelected(previous => event.target.checked ? [...new Set([...previous, member.publicId])] : previous.filter(id => id !== member.publicId)); setPreviewIndex(0); }} />
                <span><strong>{member.name}</strong><span className="wa-member-phone">{member.phone || "No mobile number"}</span></span>
              </label>
              <div className="wa-member-status">
                <StatusBadge status={view.state === "DEACTIVATED" ? "INACTIVE" : view.state === "EXPIRING" ? "EXPIRING SOON" : view.state} />
                <span>{view.daysRemaining === null ? "No expiry recorded" : view.daysRemaining < 0 ? `Expired ${Math.abs(view.daysRemaining)} days ago` : `${view.daysRemaining} days left`}</span>
              </div>
              <button className="btn btn-secondary wa-member-chat" disabled={busy} aria-label={`Open WhatsApp for ${member.name}`} title={`Open WhatsApp for ${member.name}`} onClick={() => openMember(member)}><MessageCircle size={19} aria-hidden="true" /></button>
              <dl className="wa-dates"><div><dt>Plan</dt><dd>{view.plan}</dd></div><div><dt>Start date</dt><dd>{gymDate(member.currentSubscriptionId?.startsAt, context.timezone)}</dd></div><div><dt>Expiry date</dt><dd>{gymDate(member.currentSubscriptionId?.endsAt, context.timezone)}</dd></div></dl>
              {!member.chatUrl && <p className="wa-invalid wa-member-validation">Invalid or missing mobile number</p>}
            </li>;
          })}
        </ul>
        </div>
        <Pagination page={page} limit={limit} total={context?.total || 0} loading={busy} onPageChange={value => changeList(() => setPage(value))} onLimitChange={value => changeList(() => { setLimit(value); setPage(1); })} />
      </section>
      <section className="panel page-stack wa-composer" ref={composer} tabIndex={-1} aria-label="Message composer">
        <h2>Message type</h2>
        <div className="wa-presets">{Object.entries(messagePresets).map(([key, preset]) => <button key={key} className="btn btn-secondary" aria-pressed={type === key} onClick={() => { setType(key as MessageType); setError(""); }}>{preset.label}</button>)}</div>
        {editable && <><label>Message<textarea ref={textarea} rows={4} maxLength={4000} value={template} onChange={event => setDrafts({ ...drafts, [type]: event.target.value })} /></label><div className="wa-variables" aria-label="Insert message variable">{Object.entries(messageVariables).map(([key, label]) => <button key={key} className="btn btn-ghost" onClick={() => insertVariable(key)}>{label}</button>)}</div><small>Renewal Amount requires a current quote; historical payments are not used.</small></>}
        {type === "group" && <p>{context?.group.inviteLink ? `Inviting members to ${context.group.name}.` : <>Save a WhatsApp group invite link in <Link to="/owner/gym-profile#gym-communication">Group settings</Link> first.</>}</p>}
        <div className="wa-preview" aria-live="polite">
          <h3>Message Preview</h3>
          {preview && previewMember ? <><p>Previewing message for: <strong>{previewMember.name}</strong></p>{preview.issues.length ? <ul className="wa-invalid">{preview.issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <pre>{preview.text}</pre>}
            {recipients.length > 1 && <div className="wa-buttons"><button className="btn btn-secondary" disabled={previewIndex <= 0} onClick={() => setPreviewIndex(index => index - 1)}>Previous</button><span>{Math.min(previewIndex + 1, recipients.length)} / {recipients.length}</span><button className="btn btn-secondary" disabled={previewIndex >= recipients.length - 1} onClick={() => setPreviewIndex(index => index + 1)}>Next</button></div>}</> : <p>Select a member to preview their personalized message.</p>}
        </div>
        <div className="wa-recipient-actions"><h3>Selected Recipients · {recipients.length}</h3><div className="wa-buttons">
          <button className="btn btn-primary" disabled={busy || !context || !recipients.length || (recipients.length === 1 && Boolean(preview?.issues.length))} onClick={() => recipients.length === 1 ? openMember(recipients[0]) : startBatch()}><Send size={17} aria-hidden="true" />{recipients.length > 1 ? "Send Individually" : "Open in WhatsApp"}</button>
          {recipients.length === 1 && <button className="btn btn-secondary" disabled={busy} onClick={() => openMember(recipients[0], true)}>Normal Chat</button>}
          <button className="btn btn-ghost" disabled={!recipients.length} onClick={clearSelection}>Clear Selection</button>
        </div></div>
        {batch && <button className="btn btn-secondary" onClick={() => setBatchOpen(true)}>View recipient progress</button>}
        <details className="wa-share"><summary>Share via WhatsApp</summary><div className="page-stack">
          <p>WhatsApp will open and allow you to choose recipients. These contacts are independent of your selection here. For personalized messages, use Send Individually.</p>
          <label>Generic message<textarea rows={5} value={generic} maxLength={4000} onChange={event => setGeneric(event.target.value)} /></label>
          <small>Use Gym Name, Owner Name or Group Invite Link variables. Member details cannot be shared in this message.</small>
          {genericPreview?.issues.length ? <p className="wa-invalid">{genericPreview.issues.join(" ")}</p> : <pre className="wa-share-preview">{genericPreview?.text}</pre>}
          <button className="btn btn-secondary" disabled={!genericPreview || Boolean(genericPreview.issues.length)} onClick={() => { try { whatsAppDeepLinkProvider.openShare(genericPreview!.text); setNotice("WhatsApp opened. Choose your recipients and send there."); } catch (failure) { setError((failure as Error).message); } }}><Users size={17} aria-hidden="true" />Share via WhatsApp</button>
        </div></details>
      </section>
    </div>
    {recipients.length > 0 && <div className="wa-mobile-actions"><strong>{recipients.length} Selected</strong><button className="btn btn-primary" onClick={() => { composer.current?.scrollIntoView({ behavior: "smooth", block: "start" }); composer.current?.focus({ preventScroll: true }); }}>Message</button><button className="btn btn-secondary" onClick={clearSelection}>Clear</button></div>}
    <Modal open={batchOpen} title="WhatsApp Messages" onClose={() => setBatchOpen(false)} className="wa-batch-modal">
      {batch && <div className="page-stack">
        <p>{batch.length} members selected. WhatsApp requires you to confirm each message. GETFIT4U will guide you through them one by one.</p>
        <p>Progress is kept while this page stays open. Closing this dialog pauses your progress; leaving or reloading the page clears it.</p>
        {!batchStarted ? <><p>{batch.filter(item => item.status === "SKIPPED").length} recipients will be skipped because their phone number or message details are unavailable.</p><button className="btn btn-primary" onClick={() => setBatchStarted(true)}>Start</button></> : <>
          <p role="status">{batch.filter(item => item.status === "PROCESSED_BY_OWNER").length} of {batch.length} processed · {batch.filter(item => item.status === "SKIPPED").length} skipped</p>
          {currentRecipient ? <section className="wa-preview page-stack"><p>Recipient {current + 1} / {batch.length}</p><h3>{currentRecipient.member.name}</h3><p>{currentRecipient.member.phone}</p><pre>{currentRecipient.text}</pre><p>Status: {progressLabel[currentRecipient.status]}</p>
            <button className="btn btn-primary" onClick={() => { try { whatsAppDeepLinkProvider.openChat(currentRecipient.member.chatUrl!, currentRecipient.text); updateCurrent("OPENED_WHATSAPP"); } catch (failure) { setError((failure as Error).message); } }}>Open {currentRecipient.member.name} in WhatsApp</button>
            <p>Send in WhatsApp, then return here. If no tab appeared, allow pop-ups and open it again.</p>
            <div className="wa-buttons"><button className="btn btn-secondary" disabled={currentRecipient.status !== "OPENED_WHATSAPP"} onClick={() => updateCurrent("PROCESSED_BY_OWNER")}>Mark Complete &amp; Next</button><button className="btn btn-ghost" onClick={() => updateCurrent("SKIPPED")}>Skip recipient</button></div>
            {batch.slice(current + 1).find(item => item.status === "PENDING") && <small>Next recipient: {batch.slice(current + 1).find(item => item.status === "PENDING")!.member.name}</small>}
          </section> : <p role="status">All selected recipients have been processed or skipped. Delivery is confirmed only in WhatsApp.</p>}
        </>}
        <ol className="wa-progress">{batch.map(item => <li key={item.member.publicId}><strong>{item.member.name}</strong> — {progressLabel[item.status]}{item.issues.length > 0 && <p>{item.issues.join(" ")}</p>}</li>)}</ol>
      </div>}
    </Modal>
  </div>;
}
