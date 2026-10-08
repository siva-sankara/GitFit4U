import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { uploadMedia } from "../../services/mediaUpload";
import { useCurrentUser } from "../../api/hooks";
import { PageHeader } from "../../components/PageHeader";
import { Modal } from "../../components/Modal";
import { CompactFilters } from "../../components/CompactFilters";
import { StatusBadge } from "../../components/StatusBadge";
import { Pagination } from "../../components/DataListControls";
import { QueryState, date, label, type Row } from "../live/LiveData";
import "../../styles/support-tickets.css";

const endpoint = "/api/v1/conversations";
const statuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"];
const categories = ["ACCOUNT", "PAYMENT", "MEMBERSHIP", "BOOKING", "GYM", "TECHNICAL", "OTHER"];
type FileRow = Awaited<ReturnType<typeof uploadMedia>>;
function TicketAttachments({ files, onChange, disabled, onBusy }: { files: FileRow[]; onChange: (files: FileRow[]) => void; disabled: boolean; onBusy: (busy: boolean) => void }) {
  const upload = useMutation({ mutationFn: (file: File) => uploadMedia(file, "MESSAGE"), onMutate: () => onBusy(true), onSuccess: file => onChange([...files, file]), onSettled: () => onBusy(false) });
  return <div className="support-attachments">
    <label className="field"><span>Attachments (optional)</span><input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={disabled || upload.isPending || files.length >= 5}
      onChange={event => { const file = event.target.files?.[0]; if (file) upload.mutate(file); event.target.value = ""; }} /></label>
    <small>Private images or PDF files. Files are checked before attachment.</small>
    {upload.isPending && <p role="status">Uploading attachment…</p>}{upload.isError && <p role="alert">{upload.error.message}</p>}
    {files.map(file => <div className="support-file" key={file.publicId}><span>{file.originalName}</span><button type="button" className="btn btn-ghost" disabled={disabled || upload.isPending} onClick={() => onChange(files.filter(item => item.publicId !== file.publicId))}>Remove</button></div>)}
  </div>;
}
const options = (values: string[]) => values.map(value => <option key={value} value={value}>{label(value)}</option>);

export function SupportTicketsPage() {
  const client = useQueryClient(), [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1), [limit, setLimit] = useState(10), [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(""), [query, setQuery] = useState(""), [statusFilter, setStatusFilter] = useState(""), [categoryFilter, setCategoryFilter] = useState("");
  const [subject, setSubject] = useState(""), [description, setDescription] = useState(""), [category, setCategory] = useState("OTHER");
  const [gymId, setGymId] = useState(""), [related, setRelated] = useState(""), [files, setFiles] = useState<FileRow[]>([]), [uploading, setUploading] = useState(false);
  const key = useRef(crypto.randomUUID());
  const selected = params.get("ticket") || params.get("conversation") || "";
  const tickets = useQuery({
    queryKey: ["support-tickets", page, limit, query, statusFilter, categoryFilter],
    queryFn: () => apiRequest<ApiEnvelope<Row[]> & { meta?: { total: number; statusCounts?: Record<string, number> } }>(endpoint + "?" + new URLSearchParams({ type: "SUPPORT", limit: String(limit), page: String(page), q: query, status: statusFilter, category: categoryFilter })), refetchInterval: 15000,
  });
  const context = useQuery({ queryKey: ["support-context"], enabled: creating, queryFn: () => apiRequest<ApiEnvelope<{ gyms: Row[]; references: Row[] }>>("/api/v1/users/me/support-context") });
  const create = useMutation({
    mutationFn: async () => {
      const reference = context.data?.data.references.find(row => `${row.type}:${row.id}` === related);
      const result = await apiRequest<ApiEnvelope<Row>>("/api/v1/users/me/support-tickets", { method: "POST", idempotencyKey: key.current,
        body: JSON.stringify({ subject: subject.trim(), message: description.trim(), priority: "NORMAL", category, ...(gymId ? { gymId } : {}), ...(reference ? { related: { type: reference.type, id: reference.id } } : {}) }) });
      if (files.length) await apiRequest(`${endpoint}/${result.data.conversationId}/messages`, { method: "POST", body: JSON.stringify({ text: "Attachments for this support request", type: "FILE", attachments: files.map(file => ({ key: file.publicId })), clientMessageId: `${key.current}-files` }) });
      return result;
    },
    onSuccess: result => {
      setCreating(false); setSubject(""); setDescription(""); setFiles([]); setGymId(""); setRelated(""); key.current = crypto.randomUUID();
      setPage(1); setParams({ ticket: result.data.conversationId }); void client.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
  return <div className="page-stack support-tickets-page">
    <PageHeader><div><span className="eyebrow">Help center</span><h1>Support</h1><p>Your requests, replies and progress in one place.</p></div><button className="btn btn-primary" onClick={() => setCreating(true)}>New ticket</button></PageHeader>
    {tickets.data?.meta?.statusCounts && <div className="support-summary" aria-label="Ticket status summary">{statuses.map(status => <button key={status} className="panel" aria-pressed={statusFilter === status} onClick={() => { setStatusFilter(statusFilter === status ? "" : status); setPage(1); }}><strong>{tickets.data!.meta!.statusCounts![status] || 0}</strong><span>{label(status)}</span></button>)}</div>}
    <section className="panel support-ticket-list">
      <form className="table-toolbar" role="search" onSubmit={event => { event.preventDefault(); setQuery(search.trim()); setPage(1); }}>
        <label className="field"><span>Search tickets</span><input className="input" type="search" maxLength={80} value={search} onChange={event => setSearch(event.target.value)} placeholder="Subject or reference" /></label><button className="btn btn-secondary">Search</button>
        <CompactFilters activeCount={[statusFilter, categoryFilter].filter(Boolean).length} onReset={() => { setStatusFilter(""); setCategoryFilter(""); setPage(1); }}>
          <label className="field"><span>Status</span><select className="select" value={statusFilter} onChange={event => { setStatusFilter(event.target.value); setPage(1); }}><option value="">All statuses</option>{options(statuses)}</select></label>
          <label className="field"><span>Category</span><select className="select" value={categoryFilter} onChange={event => { setCategoryFilter(event.target.value); setPage(1); }}><option value="">All categories</option>{options(categories)}</select></label>
        </CompactFilters>
      </form>
      <QueryState query={tickets}><table><thead><tr><th>Ticket</th><th>Category / priority</th><th>Status</th><th>Assigned / updated</th><th>Action</th></tr></thead><tbody>
        {tickets.data?.data.map(row => { const ticket = row.supportTicketId || {}; return <tr key={row.publicId} aria-selected={selected === row.publicId}>
          <td><strong>{ticket.subject || row.title}</strong><small>{ticket.publicId}</small><small>Created {date(ticket.createdAt)}</small>{row.unreadCount > 0 && <span className="support-unread">{row.unreadCount} new replies</span>}</td>
          <td data-label="Category / priority">{label(ticket.category || "OTHER")}<small>{label(ticket.priority || "NORMAL")}</small></td><td data-label="Status"><StatusBadge status={ticket.status || "OPEN"} /></td>
          <td data-label="Assigned / updated">{ticket.assignedTo?.name || "Unassigned"}<small>{date(ticket.updatedAt || row.lastMessageAt)}</small></td><td><button className="btn btn-secondary" onClick={() => setParams({ ticket: row.publicId })}>View ticket</button></td>
        </tr>; })}</tbody></table>
        {!tickets.data?.data.length && <div className="state-card"><h2>{query || statusFilter || categoryFilter ? "No matching tickets" : "No tickets yet"}</h2><p>{query || statusFilter || categoryFilter ? "Adjust your search or filters." : "Create a ticket when you need help from GETFIT4U."}</p></div>}
        <Pagination page={page} limit={limit} total={tickets.data?.meta?.total || 0} loading={tickets.isFetching} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
      </QueryState>
    </section>
    {selected && <TicketDetail key={selected} id={selected} onClose={() => setParams({})} />}
    <Modal open={creating} title="New support ticket" onClose={() => { if (!create.isPending && !uploading) setCreating(false); }}>
      <form className="modal-form" onChange={() => { key.current = crypto.randomUUID(); }} onSubmit={event => { event.preventDefault(); if (!create.isPending && !uploading) create.mutate(); }}>
        <fieldset disabled={create.isPending} className="support-form-fields">
          <label className="field"><span>Subject</span><input className="input" required minLength={5} maxLength={160} value={subject} onChange={event => setSubject(event.target.value)} /></label>
          <label className="field"><span>Category</span><select className="select" value={category} onChange={event => setCategory(event.target.value)}>{options(categories)}</select></label>
          <label className="field"><span>Context</span><select className="select" value={gymId} onChange={event => { setGymId(event.target.value); setRelated(""); }}><option value="">GETFIT4U platform / account</option>{context.data?.data.gyms.map(row => <option key={row._id} value={row._id}>{row.name}</option>)}</select></label>
          <p className="subtle">Private to you and platform support. Selecting a gym does not share this ticket with that gym.</p>
          <label className="field"><span>Related record (optional)</span><select className="select" value={related} onChange={event => setRelated(event.target.value)}><option value="">No related record</option>{context.data?.data.references.filter(row => !gymId || String(row.gymId) === gymId).map(row => <option key={`${row.type}:${row.id}`} value={`${row.type}:${row.id}`}>{row.label}</option>)}</select></label>
          {context.isError && <p role="alert">Unable to load related records. You can still describe your issue below.</p>}
          <label className="field"><span>Description</span><textarea className="textarea" required minLength={10} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} /></label>
          <TicketAttachments files={files} onChange={setFiles} disabled={create.isPending} onBusy={setUploading} />
        </fieldset>
        {create.isError && <p role="alert">{create.error.message} Your draft is preserved; retry to complete this request.</p>}
        <button className="btn btn-primary" disabled={create.isPending || uploading}>{create.isPending ? "Submitting…" : "Submit ticket"}</button>
      </form>
    </Modal>
  </div>;
}

function TicketDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient(), me = useCurrentUser(), admin = me.data?.data.context.role === "ADMIN";
  const [reply, setReply] = useState(""), [files, setFiles] = useState<FileRow[]>([]), [uploading, setUploading] = useState(false), draft = useRef(crypto.randomUUID());
  const [note, setNote] = useState(""), noteKey = useRef(crypto.randomUUID());
  const path = endpoint + "/" + encodeURIComponent(id);
  const detail = useQuery({ queryKey: ["support-ticket", id], queryFn: () => apiRequest<ApiEnvelope<Row>>(path), refetchInterval: 15000 });
  const ticket = detail.data?.data.supportTicketId;
  const history = useInfiniteQuery({ queryKey: ["support-history", id], enabled: detail.data?.data.type === "SUPPORT", initialPageParam: "", queryFn: ({ pageParam }) => apiRequest<ApiEnvelope<Row[]>>(path + "/messages" + (pageParam ? "?before=" + encodeURIComponent(pageParam) : "")), getNextPageParam: last => last.meta?.hasMore ? last.meta.nextCursor : undefined, refetchInterval: 15000 });
  const management = useQuery({ queryKey: ["support-management", id], enabled: admin && Boolean(ticket), queryFn: () => apiRequest<ApiEnvelope<{ notes: Row[]; assignees: Row[] }>>(path + "/support-management") });
  function refresh() { for (const queryKey of [["support-ticket", id], ["support-history", id], ["support-tickets"], ["support-management", id]]) void client.invalidateQueries({ queryKey }); }
  const send = useMutation({ mutationFn: () => apiRequest(path + "/messages", { method: "POST", body: JSON.stringify({ text: reply.trim(), type: files.length ? "FILE" : "TEXT", attachments: files.map(file => ({ key: file.publicId })), clientMessageId: draft.current }) }), onSuccess: () => { setReply(""); setFiles([]); draft.current = crypto.randomUUID(); refresh(); } });
  const update = useMutation({ mutationFn: (body: Row) => apiRequest(path + "/support-management", { method: "PATCH", body: JSON.stringify(body) }), onSuccess: refresh });
  const saveNote = useMutation({ mutationFn: () => apiRequest(path + "/internal-notes", { method: "POST", body: JSON.stringify({ key: noteKey.current, body: note.trim() }) }), onSuccess: () => { setNote(""); noteKey.current = crypto.randomUUID(); refresh(); } });
  const read = useMutation({ mutationFn: () => apiRequest(path + "/read", { method: "POST" }), onSuccess: refresh });
  const closed = ["RESOLVED", "CLOSED"].includes(ticket?.status), entries = history.data?.pages.slice().reverse().flatMap(page => page.data) || [];
  return <Modal open title={ticket?.subject || "Ticket details"} wide onClose={() => { if (!send.isPending && !saveNote.isPending && !uploading) onClose(); }}>
    <div className="support-ticket-detail"><QueryState query={detail}>{detail.data?.data.type !== "SUPPORT" ? <p role="alert">This is not a support ticket.</p> : <>
      <header className="support-ticket-meta"><span>{ticket?.publicId}</span><StatusBadge status={ticket?.status || "OPEN"} /><span>{label(ticket?.category || "OTHER")} · {label(ticket?.priority || "NORMAL")}</span></header>
      {ticket?.related?.label && <p>Related to: {ticket.related.label}</p>}
      <div className="support-ticket-toolbar">{admin ? <>
        <label className="field"><span>Status</span><select className="select" value={ticket?.status || "OPEN"} disabled={update.isPending} onChange={event => update.mutate({ status: event.target.value })}>{options(statuses)}</select></label>
        <label className="field"><span>Priority</span><select className="select" value={ticket?.priority || "NORMAL"} disabled={update.isPending} onChange={event => update.mutate({ priority: event.target.value })}>{options(["LOW", "NORMAL", "HIGH", "URGENT"])}</select></label>
        <label className="field"><span>Assigned support person</span><select className="select" value={ticket?.assignedTo?._id || ""} disabled={update.isPending || management.isPending} onChange={event => update.mutate({ assignedTo: event.target.value || null })}><option value="">Unassigned</option>{management.data?.data.assignees.map(row => <option key={row._id} value={row._id}>{row.name}</option>)}</select></label>
      </> : closed && <button className="btn btn-secondary" disabled={update.isPending} onClick={() => update.mutate({ status: "OPEN" })}>Reopen ticket</button>}
        <button className="btn btn-ghost" disabled={read.isPending} onClick={() => read.mutate()}>Mark replies read</button>
      </div>{update.isError && <p role="alert">{update.error.message}</p>}{read.isError && <p role="alert">{read.error.message}</p>}
      <div className="support-detail-grid"><section aria-label="Ticket replies"><h3>Replies</h3><QueryState query={history}>
        {history.hasNextPage && <button className="btn btn-secondary" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>Earlier replies</button>}
        <ol className="support-ticket-timeline">{entries.map(entry => <li key={entry.publicId} className={entry.senderId?._id === me.data?.data.user._id ? "support-own-reply" : ""}><header><strong>{entry.senderId?.name || "Support participant"}</strong><time dateTime={entry.createdAt}>{date(entry.createdAt)}</time></header><p>{entry.deletedAt ? "Response deleted" : entry.text}</p>{!entry.deletedAt && entry.attachments?.map((file: Row, index: number) => <a key={index} href={file.url} target="_blank" rel="noopener noreferrer">{file.name || "Attachment"}</a>)}</li>)}</ol>
      </QueryState>{closed ? <p>This ticket is closed. Reopen it to add a reply.</p> : <form className="modal-form support-composer" onSubmit={event => { event.preventDefault(); if (!send.isPending && !uploading) send.mutate(); }}>
        <label className="field"><span>{admin ? "Reply to requester" : "Reply to support"}</span><textarea className="textarea" maxLength={5000} value={reply} disabled={send.isPending} onChange={event => { setReply(event.target.value); draft.current = crypto.randomUUID(); }} /></label>
        <TicketAttachments files={files} onChange={value => { setFiles(value); draft.current = crypto.randomUUID(); }} disabled={send.isPending} onBusy={setUploading} />
        {send.isError && <p role="alert">{send.error.message}</p>}<button className="btn btn-primary" disabled={send.isPending || uploading || (!reply.trim() && !files.length)}>{send.isPending ? "Sending…" : "Send reply"}</button>
      </form>}</section><aside className="support-activity"><h3>Activity</h3><ol>{(ticket?.activity || []).map((entry: Row, index: number) => <li key={entry._id || index}><strong>{entry.type === "ASSIGNMENT" ? "Assignment updated" : `${label(entry.type)}${entry.to ? ` · ${label(entry.to)}` : ""}`}</strong><small>{entry.actorId?.name || "Support"} · {date(entry.at)}</small></li>)}</ol><p className="subtle">Created {date(ticket?.createdAt)}</p>
        {admin && <section className="support-internal"><h3>Internal notes</h3><p className="subtle">Visible only to platform support administrators.</p><QueryState query={management}>{management.data?.data.notes.map(entry => <article key={entry.key}><strong>{entry.authorId?.name || "Support"}</strong><p>{entry.body}</p><small>{date(entry.at)}</small></article>)}</QueryState>
          <form className="modal-form" onSubmit={event => { event.preventDefault(); if (!saveNote.isPending) saveNote.mutate(); }}><label className="field"><span>Add internal note</span><textarea className="textarea" required maxLength={5000} disabled={saveNote.isPending} value={note} onChange={event => { setNote(event.target.value); noteKey.current = crypto.randomUUID(); }} /></label>{saveNote.isError && <p role="alert">{saveNote.error.message}</p>}<button className="btn btn-secondary" disabled={saveNote.isPending || !note.trim()}>Save internal note</button></form>
        </section>}
      </aside></div>
    </>}</QueryState></div>
  </Modal>;
}
