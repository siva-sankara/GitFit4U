import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { useData, QueryState, date, type Row } from "../live/LiveData";
export function MessagesPage() {
  const client = useQueryClient(),
    [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [active, setActive] = useState(""),
    [text, setText] = useState(""),
    [recipient, setRecipient] = useState(""),
    [older, setOlder] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | undefined>();
  const conversations = useQuery({
    queryKey: ["conversations", page],
    queryFn: () =>
      apiRequest<ApiEnvelope<Row[]>>(`/api/v1/conversations?page=${page}`),
    refetchInterval: 15000,
  });
  const contacts = useData<Row[]>("/api/v1/workspace/contacts");
  const messages = useQuery({
    queryKey: ["messages", active],
    enabled: !!active,
    queryFn: () =>
      apiRequest<ApiEnvelope<Row[]>>(
        `/api/v1/conversations/${active}/messages`,
      ),
    refetchInterval: 5000,
  });
  const create = useMutation({
    mutationFn: () =>
      apiRequest<ApiEnvelope<Row>>("/api/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ participantIds: [recipient], type: "DIRECT" }),
      }),
    onSuccess: (r) => {
      setActive(r.data.publicId);
      setRecipient("");
      client.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const send = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/conversations/${active}/messages`, {
        method: "POST",
        body: JSON.stringify({
          clientMessageId: crypto.randomUUID(),
          type: "TEXT",
          text: text.trim(),
        }),
      }),
    onSuccess: () => {
      setText("");
      client.invalidateQueries({ queryKey: ["messages", active] });
      client.invalidateQueries({ queryKey: ["conversations"] });
    },
  });
  const loadOlder = useMutation({
    mutationFn: () =>
      apiRequest<ApiEnvelope<Row[]>>(
        `/api/v1/conversations/${active}/messages?before=${encodeURIComponent(cursor || messages.data?.meta?.nextCursor || "")}`,
      ),
    onSuccess: (r) => {
      setOlder((v) => [...r.data, ...v]);
      setCursor(r.meta?.nextCursor || "");
    },
  });
  useEffect(() => {
    setOlder([]);
    setCursor(undefined);
    setText("");
    if (active)
      void apiRequest(`/api/v1/conversations/${active}/read`, {
        method: "POST",
      }).catch(() => undefined);
  }, [active]);
  const current = conversations.data?.data.find((r) => r.publicId === active);
  const combined = [
    ...new Map(
      [...older, ...(messages.data?.data || [])].map((row) => [
        row.publicId,
        row,
      ]),
    ).values(),
  ];
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Communication</span>
          <h1>Messages</h1>
        </div>
      </header>
      <form
        className="table-toolbar panel"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <label className="field">
          <span>Start a conversation</span>
          <select
            className="select"
            required
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
          >
            <option value="">Choose an authorized contact</option>
            {contacts.data?.data.map((r) => (
              <option key={r._id} value={r._id}>
                {r.name || r.publicId}
              </option>
            ))}
          </select>
        </label>
        <button
          className="btn btn-primary"
          disabled={!recipient || create.isPending}
        >
          Open conversation
        </button>
        {create.isError && <p role="alert">{create.error.message}</p>}
        {contacts.isError && <p role="alert">{contacts.error.message}</p>}
      </form>
      <section className="message-shell panel">
        <aside className="conversation-list">
          <input
            className="input"
            aria-label="Search this conversation page"
            placeholder="Search this page"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <QueryState query={conversations}>
            {conversations.data?.data
              .filter((r) =>
                `${r.title || ""} ${r.participants?.map((p: Row) => p.name).join(" ")}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
              )
              .map((r) => (
                <button
                  key={r.publicId}
                  className={
                    active === r.publicId
                      ? "conversation active"
                      : "conversation"
                  }
                  onClick={() => setActive(r.publicId)}
                >
                  <span>
                    <strong>
                      {r.title ||
                        r.participants
                          ?.map((p: Row) => p.name || "Member")
                          .join(", ")}
                    </strong>
                    <small>{r.lastMessageId?.text || "No messages yet"}</small>
                  </span>
                </button>
              ))}
            {!conversations.data?.data.length && <p>No conversations yet.</p>}
            <div className="heading-actions">
              <button
                className="btn btn-secondary"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </button>
              <button
                className="btn btn-secondary"
                disabled={page >= (conversations.data?.meta?.pages || 1)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </QueryState>
        </aside>
        <article className="chat-panel">
          {!active ? (
            <div className="state-card">
              Select a conversation or choose a contact.
            </div>
          ) : (
            <>
              <header>
                <strong>
                  {current?.title ||
                    current?.participants?.map((p: Row) => p.name).join(", ") ||
                    "Conversation"}
                </strong>
              </header>
              <div className="message-history">
                <QueryState query={messages}>
                  {(cursor === undefined
                    ? messages.data?.meta?.hasMore
                    : !!cursor) && (
                    <button
                      className="btn btn-secondary"
                      disabled={loadOlder.isPending}
                      onClick={() => loadOlder.mutate()}
                    >
                      Load earlier messages
                    </button>
                  )}
                  {loadOlder.isError && (
                    <p role="alert">{loadOlder.error.message}</p>
                  )}
                  {combined.map((m) => (
                    <article className="message-bubble" key={m.publicId}>
                      <strong>{m.senderId?.name || "Member"}</strong>
                      <p>{m.text}</p>
                      <small>{date(m.createdAt)}</small>
                    </article>
                  ))}
                </QueryState>
              </div>
              <form
                className="message-composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (text.trim()) send.mutate();
                }}
              >
                <input
                  aria-label="Message"
                  value={text}
                  maxLength={5000}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Write a message"
                />
                <button
                  className="btn btn-primary"
                  disabled={!text.trim() || send.isPending}
                >
                  {send.isPending ? "Sending…" : "Send"}
                </button>
                {send.isError && <p role="alert">{send.error.message}</p>}
              </form>
            </>
          )}
        </article>
      </section>
    </div>
  );
}
