import { useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, MessageSquareText, RefreshCw, Send } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../services/apiClient";
import "../styles/whatsapp.css";
import { Pagination } from "./DataListControls";

type Conversation = {
  publicId: string;
  contactName?: string;
  displayPhone?: string;
  unreadCount: number;
  lastMessageAt?: string;
  lastInboundAt?: string;
  archivedAt?: string;
  serviceWindowOpen?: boolean;
  serviceWindowEndsAt?: string;
  sender?: { name?: string; displayPhoneNumber?: string; outboundPaused?: boolean; status?: string };
};
type Message = {
  publicId: string;
  direction: "INBOUND" | "OUTBOUND";
  contentType: string;
  text?: string;
  template?: { name?: string; language?: string };
  status: string;
  createdAt: string;
};
type Template = { _id: string; name: string; language: string; category: string; status: string; components?: unknown };

const time = (value?: string) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "";

export function WhatsAppInbox() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const active = params.get("conversation") || "";
  const [text, setText] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1), [limit, setLimit] = useState(10);
  const [searchDraft, setSearchDraft] = useState(""), [search, setSearch] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(searchDraft.trim()); setPage(1); }, 350);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);
  const conversations = useQuery({
    queryKey: ["whatsapp-conversations", archived, search, page, limit],
    queryFn: () => apiRequest<ApiEnvelope<Conversation[]>>(`/api/v1/whatsapp/conversations?page=${page}&limit=${limit}&archived=${archived}&q=${encodeURIComponent(search)}`),
    refetchInterval: 10_000,
  });
  const details = useQuery({
    queryKey: ["whatsapp-conversation", active],
    enabled: Boolean(active),
    queryFn: () => apiRequest<ApiEnvelope<Conversation>>(`/api/v1/whatsapp/conversations/${encodeURIComponent(active)}`),
    refetchInterval: 10_000,
  });
  const messages = useInfiniteQuery({
    queryKey: ["whatsapp-messages", active],
    enabled: Boolean(active),
    initialPageParam: "",
    queryFn: ({ pageParam }) => apiRequest<ApiEnvelope<Message[]>>(`/api/v1/whatsapp/conversations/${encodeURIComponent(active)}/messages?limit=20${pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (last) => last.meta?.hasMore ? last.meta.nextCursor : undefined,
    refetchInterval: 5_000,
  });
  const templates = useQuery({
    queryKey: ["whatsapp-templates"],
    queryFn: () => apiRequest<ApiEnvelope<Template[]>>("/api/v1/whatsapp/templates"),
  });
  const usableTemplates = useMemo(() => (templates.data?.data || []).filter((item) => item.status === "APPROVED" && !JSON.stringify(item.components || []).includes("{{")), [templates.data]);
  useEffect(() => {
    if (!active) return;
    void apiRequest(`/api/v1/whatsapp/conversations/${encodeURIComponent(active)}/read`, { method: "POST", body: "{}" }).then(() => client.invalidateQueries({ queryKey: ["whatsapp-conversations"] })).catch(() => undefined);
  }, [active, client]);
  const send = useMutation({
    mutationFn: () => {
      const template = usableTemplates.find((item) => `${item.name}:${item.language}` === templateKey);
      return apiRequest(`/api/v1/whatsapp/conversations/${encodeURIComponent(active)}/messages`, {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify(template ? {
          idempotencyKey: crypto.randomUUID(),
          purpose: template.category === "MARKETING" ? "MARKETING" : "SERVICE",
          templateName: template.name,
          language: template.language,
          parameters: [],
        } : { idempotencyKey: crypto.randomUUID(), purpose: "SERVICE", text: text.trim() }),
      });
    },
    onSuccess: () => { setText(""); setTemplateKey(""); void client.invalidateQueries({ queryKey: ["whatsapp-messages", active] }); },
  });
  const archive = useMutation({
    mutationFn: (value: boolean) => apiRequest(`/api/v1/whatsapp/conversations/${encodeURIComponent(active)}/archive`, { method: "PATCH", body: JSON.stringify({ archived: value }) }),
    onSuccess: () => { const next = new URLSearchParams(params); next.delete("conversation"); setParams(next); void client.invalidateQueries({ queryKey: ["whatsapp-conversations"] }); },
  });
  const select = (id: string) => { const next = new URLSearchParams(params); next.set("channel", "whatsapp"); next.set("conversation", id); setParams(next); };
  const conversation = details.data?.data;
  const canText = Boolean(conversation?.serviceWindowOpen && !conversation.sender?.outboundPaused && conversation.sender?.status === "CONNECTED");
  const canTemplate = Boolean(templateKey && !conversation?.sender?.outboundPaused && conversation?.sender?.status === "CONNECTED");
  const messageRows = messages.data?.pages.slice().reverse().flatMap((entry) => entry.data) || [];
  return <div className="whatsapp-inbox">
    <aside className={`whatsapp-conversation-list ${active ? "is-selected" : ""}`} aria-label="WhatsApp conversations">
      <div className="whatsapp-list-header"><div><h2>WhatsApp</h2><p>Business API inbox</p></div><button className="icon-button" aria-label="Refresh WhatsApp conversations" onClick={() => void conversations.refetch()}><RefreshCw size={18} /></button></div>
      <div className="whatsapp-list-tools"><input className="input" type="search" value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Search contacts" aria-label="Search WhatsApp contacts" /><label><input type="checkbox" checked={archived} onChange={(event) => { setArchived(event.target.checked); setPage(1); }} /> Archived</label></div>
      {conversations.isPending && <p role="status">Loading conversations…</p>}
      {conversations.isError && <p role="alert">{conversations.error.message}</p>}
      <div className="whatsapp-list-scroll">{conversations.data?.data.map((item) => <button key={item.publicId} className={`whatsapp-conversation-row ${active === item.publicId ? "active" : ""}`} onClick={() => select(item.publicId)}><span className="whatsapp-avatar"><MessageSquareText size={20} /></span><span><strong>{item.contactName || "WhatsApp contact"}</strong><small>{item.displayPhone || "Private number"}</small><small>{time(item.lastMessageAt)}</small></span>{item.unreadCount > 0 && <b aria-label={`${item.unreadCount} unread`}>{item.unreadCount}</b>}</button>)}</div>
      {conversations.data && !conversations.data.data.length && <p className="whatsapp-empty">No {archived ? "archived " : ""}WhatsApp conversations.</p>}
      <Pagination page={page} limit={limit} total={conversations.data?.meta?.total || 0} loading={conversations.isFetching} onPageChange={setPage} onLimitChange={(value) => { setLimit(value); setPage(1); }} />
    </aside>
    <section className={`whatsapp-chat ${active ? "is-selected" : ""}`}>
      {!active ? <div className="whatsapp-empty-state"><MessageSquareText size={42} /><h2>Select a WhatsApp conversation</h2><p>Member-initiated messages and authorised business conversations appear here.</p></div> : <>
        <header className="whatsapp-chat-header"><div><h2>{conversation?.contactName || "WhatsApp contact"}</h2><p>{conversation?.displayPhone} · via {conversation?.sender?.name || conversation?.sender?.displayPhoneNumber || "business sender"}</p></div><button className="btn btn-ghost" disabled={archive.isPending} onClick={() => archive.mutate(!conversation?.archivedAt)}>{conversation?.archivedAt ? <ArchiveRestore size={17} /> : <Archive size={17} />}{conversation?.archivedAt ? "Restore" : "Archive"}</button></header>
        {!conversation?.serviceWindowOpen && <p className="whatsapp-window-notice">The 24-hour customer-service window is closed. Send an approved template to restart contact.</p>}
        {conversation?.sender?.outboundPaused && <p className="whatsapp-window-notice">Outbound WhatsApp delivery is paused for this sender.</p>}
        <div className="whatsapp-message-history" aria-live="polite">
          {messages.isPending && <p role="status">Loading messages…</p>}
          {messages.isError && <p role="alert">{messages.error.message}</p>}
          {messages.hasNextPage && <button type="button" className="btn btn-secondary" disabled={messages.isFetchingNextPage} onClick={() => void messages.fetchNextPage()}>{messages.isFetchingNextPage ? "Loading…" : "Load earlier messages"}</button>}
          {messageRows.map((message) => <article key={message.publicId} className={`whatsapp-bubble ${message.direction === "OUTBOUND" ? "outgoing" : "incoming"}`}><p>{message.contentType === "TEXT" ? message.text : message.template?.name ? `Template: ${message.template.name}` : `${message.contentType.toLowerCase()} message`}</p><footer><time>{time(message.createdAt)}</time>{message.direction === "OUTBOUND" && <span>{message.status.toLowerCase().replaceAll("_", " ")}</span>}</footer></article>)}
          {messages.data && !messageRows.length && <p className="whatsapp-empty">No messages in this conversation yet.</p>}
        </div>
        <form className="whatsapp-composer" onSubmit={(event) => { event.preventDefault(); if ((text.trim() && canText) || canTemplate) send.mutate(); }}>
          {!templateKey && <textarea rows={1} maxLength={5000} aria-label="WhatsApp message" value={text} disabled={!canText || send.isPending} onChange={(event) => setText(event.target.value)} placeholder={canText ? "Write a WhatsApp reply" : "Choose an approved template"} />}
          <select aria-label="Approved WhatsApp template" value={templateKey} disabled={send.isPending} onChange={(event) => { setTemplateKey(event.target.value); if (event.target.value) setText(""); }}><option value="">{canText ? "Free-form reply" : "Choose approved template"}</option>{usableTemplates.map((template) => <option key={`${template.name}:${template.language}`} value={`${template.name}:${template.language}`}>{template.name} · {template.language} · {template.category.toLowerCase()}</option>)}</select>
          <button className="btn btn-primary" disabled={send.isPending || (!canTemplate && (!canText || !text.trim()))} aria-label="Send WhatsApp message"><Send size={18} />{send.isPending ? "Sending…" : "Send"}</button>
          {send.isError && <p role="alert">{send.error.message}</p>}
        </form>
      </>}
    </section>
  </div>;
}
