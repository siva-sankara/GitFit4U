import { useRef, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { useCurrentUser } from "../../api/hooks";
import { Modal } from "../../components/Modal";
import { StatusBadge } from "../../components/StatusBadge";
import { QueryState, date, type Row } from "../live/LiveData";
import "../../styles/support-tickets.css";

const endpoint = "/api/v1/conversations";
const statuses = ["OPEN", "IN_PROGRESS", "WAITING_FOR_USER", "RESOLVED", "CLOSED"];
export function SupportTicketsPage() {
  const client = useQueryClient(), [params, setParams] = useSearchParams();
  const [page, setPage] = useState(1), [creating, setCreating] = useState(false);
  const [subject, setSubject] = useState(""), [description, setDescription] = useState("");
  const key = useRef(crypto.randomUUID());
  const selected = params.get("ticket") || params.get("conversation") || "";
  const tickets = useQuery({
    queryKey: ["support-tickets", page],
    queryFn: () => apiRequest<ApiEnvelope<Row[]>>(endpoint + "?type=SUPPORT&limit=20&page=" + page),
    refetchInterval: 15000,
  });
  const create = useMutation({
    mutationFn: () => apiRequest<ApiEnvelope<Row>>("/api/v1/users/me/support-tickets", {
      method: "POST", idempotencyKey: key.current,
      body: JSON.stringify({ subject: subject.trim(), message: description.trim(), priority: "NORMAL" }),
    }),
    onSuccess: result => {
      setCreating(false); setSubject(""); setDescription(""); key.current = crypto.randomUUID();
      setPage(1); setParams({ ticket: result.data.conversationId });
      void client.invalidateQueries({ queryKey: ["support-tickets"] });
    },
  });
  return <div className="page-stack support-tickets-page">
    <header className="page-heading"><div><span className="eyebrow">Help center</span><h1>Support tickets</h1><p>Track requests, review their history and reply to support.</p></div>
      <button className="btn btn-primary" onClick={() => setCreating(true)}>Create ticket</button></header>
    <section className="panel support-ticket-list">
      <h2>Your support requests</h2>
      <QueryState query={tickets}>
        <div className="support-table-scroll"><table><thead><tr><th>Subject</th><th>Status</th><th>Priority</th><th>Updated</th><th>Action</th></tr></thead><tbody>
          {tickets.data?.data.map(row => <tr key={row.publicId} aria-selected={selected === row.publicId}>
            <td><strong>{row.supportTicketId?.subject || row.title}</strong><small>{row.supportTicketId?.publicId}</small>{row.unreadCount > 0 && <small>{row.unreadCount} unread responses</small>}</td>
            <td><StatusBadge status={row.supportTicketId?.status || "OPEN"} /></td><td>{row.supportTicketId?.priority || "NORMAL"}</td>
            <td>{date(row.supportTicketId?.updatedAt || row.lastMessageAt)}</td>
            <td><button className="btn btn-secondary" onClick={() => setParams({ ticket: row.publicId })}>View ticket</button></td>
          </tr>)}
        </tbody></table></div>
        {!tickets.data?.data.length && <p className="state-card">No support tickets yet.</p>}
        <nav className="support-ticket-pagination" aria-label="Support ticket pages">
          <button className="btn btn-secondary" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button>
          <span>Page {page} of {tickets.data?.meta?.pages || 1}</span>
          <button className="btn btn-secondary" disabled={page >= (tickets.data?.meta?.pages || 1)} onClick={() => setPage(value => value + 1)}>Next</button>
        </nav>
      </QueryState>
    </section>
    {selected && <TicketDetail key={selected} id={selected} onClose={() => setParams({})} />}
    <Modal open={creating} title="Create support ticket" onClose={() => { if (!create.isPending) setCreating(false); }}>
      <form className="modal-form" onSubmit={event => { event.preventDefault(); if (!create.isPending) create.mutate(); }}>
        <label className="field"><span>Subject</span><input className="input" required minLength={5} maxLength={160} value={subject} disabled={create.isPending} onChange={event => { setSubject(event.target.value); key.current = crypto.randomUUID(); }} /></label>
        <label className="field"><span>Describe the issue</span><textarea className="textarea" required minLength={10} maxLength={5000} value={description} disabled={create.isPending} onChange={event => { setDescription(event.target.value); key.current = crypto.randomUUID(); }} /></label>
        {create.isError && <p role="alert">{create.error.message}</p>}
        <button className="btn btn-primary" disabled={create.isPending}>{create.isPending ? "Submitting…" : "Submit ticket"}</button>
      </form>
    </Modal>
  </div>;
}

function TicketDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient(), me = useCurrentUser();
  const admin = me.data?.data.context.role === "ADMIN";
  const [reply, setReply] = useState(""), draft = useRef(crypto.randomUUID());
  const path = endpoint + "/" + encodeURIComponent(id);
  const detail = useQuery({ queryKey: ["support-ticket", id], queryFn: () => apiRequest<ApiEnvelope<Row>>(path), refetchInterval: 15000 });
  const ticket = detail.data?.data.supportTicketId;
  const history = useInfiniteQuery({
    queryKey: ["support-history", id], enabled: detail.data?.data.type === "SUPPORT",
    initialPageParam: "",
    queryFn: ({ pageParam }) => apiRequest<ApiEnvelope<Row[]>>(path + "/messages" + (pageParam ? "?before=" + encodeURIComponent(pageParam) : "")),
    getNextPageParam: last => last.meta?.hasMore ? last.meta.nextCursor : undefined,
    refetchInterval: 15000,
  });
  function refresh() {
    for (const queryKey of [["support-ticket", id], ["support-history", id], ["support-tickets"]]) void client.invalidateQueries({ queryKey });
  }
  const send = useMutation({
    mutationFn: () => apiRequest(path + "/messages", { method: "POST", body: JSON.stringify({ text: reply.trim(), type: "TEXT", clientMessageId: draft.current }) }),
    onSuccess: () => { setReply(""); draft.current = crypto.randomUUID(); refresh(); },
  });
  const status = useMutation({
    mutationFn: (value: string) => apiRequest(path + "/support-status", { method: "PATCH", body: JSON.stringify({ status: value }) }), onSuccess: refresh,
  });
  const read = useMutation({ mutationFn: () => apiRequest(path + "/read", { method: "POST" }), onSuccess: () => void client.invalidateQueries({ queryKey: ["support-tickets"] }) });
  const closed = ["RESOLVED", "CLOSED"].includes(ticket?.status);
  const entries = history.data?.pages.slice().reverse().flatMap(page => page.data) || [];
  return <section className="panel support-ticket-detail" aria-label="Ticket details">
    <div className="support-ticket-toolbar"><h2>Ticket details</h2><button className="btn btn-secondary" onClick={onClose}>Close details</button></div>
    <QueryState query={detail}>
      {detail.data?.data.type !== "SUPPORT" ? <p role="alert">This is not a support ticket.</p> : <>
        <h3>{ticket?.subject || detail.data?.data.title}</h3><StatusBadge status={ticket?.status || "OPEN"} />
        <div className="support-ticket-toolbar">
          {admin ? <label className="field"><span>Ticket status</span><select className="select" value={ticket?.status || "OPEN"} disabled={status.isPending} onChange={event => status.mutate(event.target.value)}>{statuses.map(value => <option key={value}>{value}</option>)}</select></label>
            : closed && <button className="btn btn-secondary" disabled={status.isPending} onClick={() => status.mutate("OPEN")}>Reopen ticket</button>}
          <button className="btn btn-secondary" disabled={read.isPending} onClick={() => read.mutate()}>Mark responses read</button>
        </div>
        {status.isError && <p role="alert">{status.error.message}</p>}{read.isError && <p role="alert">{read.error.message}</p>}
        <h3>Request history</h3>
        <QueryState query={history}>
          {history.hasNextPage && <button className="btn btn-secondary" disabled={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>Load earlier responses</button>}
          <ol className="support-ticket-timeline">{entries.map(entry => <li key={entry.publicId}>
            <header><strong>{entry.senderId?.name || "Support participant"}</strong><time dateTime={entry.createdAt}>{date(entry.createdAt)}</time></header>
            <p>{entry.deletedAt ? "Response deleted" : entry.text}</p>
            {!entry.deletedAt && entry.attachments?.map((file: Row, index: number) => <a key={index} href={file.url} target="_blank" rel="noreferrer">{file.name || "Attachment"}</a>)}
          </li>)}</ol>
        </QueryState>
        {closed ? <p>This ticket is closed. Reopen it to add a response.</p> : <form className="modal-form" onSubmit={event => { event.preventDefault(); if (!send.isPending) send.mutate(); }}>
          <label className="field"><span>{admin ? "Support response" : "Reply to support"}</span><textarea className="textarea" required maxLength={5000} value={reply} disabled={send.isPending} onChange={event => { setReply(event.target.value); draft.current = crypto.randomUUID(); }} /></label>
          {send.isError && <p role="alert">{send.error.message}</p>}
          <button className="btn btn-primary" disabled={send.isPending || !reply.trim()}>{send.isPending ? "Sending…" : "Send response"}</button>
        </form>}
      </>}
    </QueryState>
  </section>;
}
