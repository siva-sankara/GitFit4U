import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  Archive,
  MessageSquare,
  Paperclip,
  Send,
  Trash2,
} from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { useCurrentUser } from "../../api/hooks";
import { uploadMedia } from "../../services/mediaUpload";
import { useData, QueryState, date, type Row } from "../live/LiveData";
import "../../styles/messaging.css";

export function messageBelongsToUser(message: Row, userId?: string) {
  return Boolean(
    userId && String(message.senderId?._id || message.senderId) === userId,
  );
}
const statuses = [
  "OPEN",
  "IN_PROGRESS",
  "WAITING_FOR_USER",
  "RESOLVED",
  "CLOSED",
];
const path = (id: string) => "/api/v1/conversations/" + id;
export function MessagesPage({
  supportOnly = false,
}: {
  supportOnly?: boolean;
}) {
  const client = useQueryClient(),
    me = useCurrentUser(),
    [params, setParams] = useSearchParams();
  const userId = me.data?.data?.user?._id,
    admin = me.data?.data?.context?.role === "ADMIN";
  const [page, setPage] = useState(1),
    [search, setSearch] = useState("");
  const [active, setActive] = useState(params.get("conversation") || "");
  const [text, setText] = useState(""),
    [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState(""),
    [description, setDescription] = useState("");
  const [older, setOlder] = useState<Row[]>([]),
    [cursor, setCursor] = useState<string | undefined>();
  const [attachments, setAttachments] = useState<Row[]>([]),
    [notice, setNotice] = useState("");
  const draftId = useRef(crypto.randomUUID()),
    supportDraftId = useRef(crypto.randomUUID()),
    previous = useRef("");
  const history = useRef<HTMLDivElement>(null),
    fileInput = useRef<HTMLInputElement>(null);
  const conversations = useQuery({
    queryKey: ["conversations", supportOnly, page],
    queryFn: () =>
      apiRequest<ApiEnvelope<Row[]>>(
        "/api/v1/conversations?page=" +
          page +
          "&limit=20" +
          (supportOnly ? "&type=SUPPORT" : ""),
      ),
    refetchInterval: 10000,
  });
  const contacts = useData<Row[]>("/api/v1/workspace/contacts", !supportOnly);
  const details = useQuery({
    queryKey: ["conversation", active],
    enabled: !!active,
    queryFn: () => apiRequest<ApiEnvelope<Row>>(path(active)),
    refetchInterval: 10000,
  });
  const messages = useQuery({
    queryKey: ["messages", active],
    enabled: !!active,
    queryFn: () => apiRequest<ApiEnvelope<Row[]>>(path(active) + "/messages"),
    refetchInterval: 5000,
  });
  function open(id: string) {
    setActive(id);
    setParams(id ? { conversation: id } : {}, { replace: true });
  }
  function refresh() {
    for (const key of [
      ["conversations"],
      ["conversation", active],
      ["messages", active],
    ])
      void client.invalidateQueries({ queryKey: key });
  }
  const create = useMutation({
    mutationFn: () =>
      apiRequest<ApiEnvelope<Row>>("/api/v1/conversations", {
        method: "POST",
        body: JSON.stringify({ participantIds: [recipient], type: "DIRECT" }),
      }),
    onSuccess: (result) => {
      open(result.data.publicId);
      setRecipient("");
      refresh();
    },
  });
  const createSupport = useMutation({
    mutationFn: () =>
      apiRequest<ApiEnvelope<Row>>("/api/v1/users/me/support-tickets", {
        method: "POST",
        idempotencyKey: supportDraftId.current,
        body: JSON.stringify({
          subject: subject.trim(),
          message: description.trim(),
          priority: "NORMAL",
        }),
      }),
    onSuccess: (result) => {
      open(result.data.conversationId);
      setSubject("");
      setDescription("");
      supportDraftId.current = crypto.randomUUID();
      setPage(1);
      refresh();
    },
  });
  const send = useMutation({
    mutationFn: (draft: {
      conversationId: string;
      clientMessageId: string;
      text: string;
      attachments: Row[];
    }) =>
      apiRequest(path(draft.conversationId) + "/messages", {
        method: "POST",
        body: JSON.stringify({
          clientMessageId: draft.clientMessageId,
          text: draft.text,
          attachments: draft.attachments.map((item) => ({
            key: item.publicId,
          })),
          type: draft.attachments.length ? "FILE" : "TEXT",
        }),
      }),
    onSuccess: (_result, draft) => {
      if (draft.conversationId === active) {
        setText("");
        setAttachments([]);
        draftId.current = crypto.randomUUID();
      }
      refresh();
      requestAnimationFrame(() =>
        history.current?.scrollTo({
          top: history.current.scrollHeight,
          behavior: "smooth",
        }),
      );
    },
  });
  const upload = useMutation({
    mutationFn: (file: File) => uploadMedia(file, "MESSAGE"),
    onSuccess: (result) => {
      setAttachments((value) => [...value, result]);
      draftId.current = crypto.randomUUID();
    },
  });
  const loadOlder = useMutation({
    mutationFn: () =>
      apiRequest<ApiEnvelope<Row[]>>(
        path(active) +
          "/messages?before=" +
          encodeURIComponent(cursor || messages.data?.meta?.nextCursor || ""),
      ),
    onSuccess: (result) => {
      const element = history.current,
        height = element?.scrollHeight || 0;
      setOlder((value) => [...result.data, ...value]);
      setCursor(result.meta?.nextCursor || "");
      requestAnimationFrame(() => {
        if (element) element.scrollTop += element.scrollHeight - height;
      });
    },
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      apiRequest(path(id) + "/read", { method: "POST" }),
    onSuccess: () =>
      void client.invalidateQueries({ queryKey: ["conversations"] }),
  });
  const archive = useMutation({
    mutationFn: () => apiRequest(path(active), { method: "DELETE" }),
    onSuccess: () => {
      open("");
      setNotice(
        "Conversation hidden for you. Other participants keep their history. A new message makes it visible again.",
      );
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      apiRequest(path(active) + "/messages/" + id, { method: "DELETE" }),
    onSuccess: () => {
      setOlder([]);
      setCursor(undefined);
      refresh();
    },
  });
  const changeStatus = useMutation({
    mutationFn: (status: string) =>
      apiRequest(path(active) + "/support-status", {
        method: "PATCH",
        body: JSON.stringify({ status }),
      }),
    onSuccess: refresh,
  });
  const lastMessage = messages.data?.data.at(-1)?.publicId;
  useEffect(() => {
    setActive(params.get("conversation") || "");
  }, [params]);
  useEffect(() => {
    setOlder([]);
    setCursor(undefined);
    setText("");
    setAttachments([]);
    draftId.current = crypto.randomUUID();
  }, [active]);
  useEffect(() => {
    if (!active || !lastMessage) return;
    read.mutate(active);
    const element = history.current;
    if (
      element &&
      (previous.current !== active ||
        element.scrollHeight - element.scrollTop - element.clientHeight < 200)
    )
      element.scrollTop = element.scrollHeight;
    previous.current = active;
  }, [active, lastMessage]);
  const current =
      details.data?.data ||
      conversations.data?.data.find((row) => row.publicId === active),
    ticket = current?.supportTicketId;
  const closed = Boolean(
    ticket && ["CLOSED", "RESOLVED"].includes(ticket.status),
  );
  const combined = [
    ...new Map(
      [...older, ...(messages.data?.data || [])].map((row) => [
        row.publicId,
        row,
      ]),
    ).values(),
  ];
  function name(row?: Row) {
    return (
      row?.title ||
      row?.participants
        ?.filter((person: Row) => String(person._id) !== userId)
        .map((person: Row) => person.name || "Member")
        .join(", ") ||
      "Conversation"
    );
  }
  const visible =
    conversations.data?.data.filter((row) =>
      (name(row) + " " + (row.gymId?.name || ""))
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) || [];
  const errors = [
    send,
    upload,
    loadOlder,
    archive,
    remove,
    changeStatus,
  ].filter((mutation) => mutation.isError);
  return (
    <div className="page-stack messaging-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Communication</span>
          <h1>{supportOnly ? "Support conversations" : "Messages"}</h1>
          <p>
            {supportOnly
              ? "Get help and keep every reply in one conversation."
              : "Stay in touch with your gym and training team."}
          </p>
        </div>
      </header>
      {notice && (
        <p role="status" className="chat-notice">
          {notice}
        </p>
      )}
      <details className="chat-start panel">
        <summary>
          {supportOnly
            ? "Start a support conversation"
            : "Start a conversation"}
        </summary>
        {supportOnly ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              createSupport.mutate();
            }}
          >
            <label className="field">
              <span>Subject</span>
              <input
                className="input"
                value={subject}
                disabled={createSupport.isPending}
                onChange={(event) => {
                  setSubject(event.target.value);
                  supportDraftId.current = crypto.randomUUID();
                }}
                minLength={5}
                maxLength={120}
                required
              />
            </label>
            <label className="field">
              <span>How can we help?</span>
              <textarea
                className="input"
                value={description}
                disabled={createSupport.isPending}
                onChange={(event) => {
                  setDescription(event.target.value);
                  supportDraftId.current = crypto.randomUUID();
                }}
                minLength={10}
                maxLength={5000}
                required
              />
            </label>
            <button
              className="btn btn-primary"
              disabled={createSupport.isPending}
            >
              {createSupport.isPending ? "Opening…" : "Contact support"}
            </button>
            {createSupport.isError && (
              <p role="alert">{createSupport.error.message}</p>
            )}
          </form>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              create.mutate();
            }}
          >
            <label className="field">
              <span>Contact</span>
              <select
                className="select"
                required
                value={recipient}
                onChange={(event) => setRecipient(event.target.value)}
              >
                <option value="">Choose a contact</option>
                {contacts.data?.data.map((row) => (
                  <option key={row._id} value={row._id}>
                    {row.name || row.publicId}
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
        )}
      </details>
      <section
        className={
          "message-shell panel modern-chat" + (active ? " has-selection" : "")
        }
      >
        <aside className="conversation-list" aria-label="Conversations">
          <input
            className="input"
            aria-label="Search conversations on this page"
            placeholder="Search conversations"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="conversation-scroll">
            <QueryState query={conversations}>
              {visible.map((row) => (
                <button
                  key={row.publicId}
                  className={
                    "conversation" + (active === row.publicId ? " active" : "")
                  }
                  onClick={() => open(row.publicId)}
                  aria-current={active === row.publicId ? "true" : undefined}
                >
                  <span className="chat-avatar">
                    {row.gymId?.logo?.url || row.gymId?.logoUrl ? (
                      <img
                        src={row.gymId.logo?.url || row.gymId.logoUrl}
                        alt=""
                      />
                    ) : (
                      <MessageSquare size={20} />
                    )}
                  </span>
                  <span className="conversation-copy">
                    <strong>{name(row)}</strong>
                    <small>
                      {row.lastMessageId?.deletedAt
                        ? "Message deleted"
                        : row.lastMessageId?.text || "Start the conversation"}
                    </small>
                    {row.supportTicketId && (
                      <small>
                        {row.supportTicketId.status.replaceAll("_", " ")}
                      </small>
                    )}
                  </span>
                  <span className="conversation-meta">
                    <time dateTime={row.lastMessageAt}>
                      {row.lastMessageAt
                        ? new Date(row.lastMessageAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )
                        : ""}
                    </time>
                    {row.unreadCount > 0 && (
                      <span
                        className="chat-unread"
                        aria-label={row.unreadCount + " unread messages"}
                      >
                        {row.unreadCount}
                      </span>
                    )}
                  </span>
                </button>
              ))}
              {!visible.length && (
                <div className="state-card">
                  {search
                    ? "No conversations match your search."
                    : "No conversations yet."}
                </div>
              )}
            </QueryState>
          </div>
          <div className="chat-pagination">
            <button
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>
              {page} / {Math.max(1, conversations.data?.meta?.pages || 1)}
            </span>
            <button
              className="btn btn-secondary"
              disabled={page >= (conversations.data?.meta?.pages || 1)}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </aside>
        <article className="chat-panel">
          {!active ? (
            <div className="state-card chat-empty">
              <MessageSquare size={38} />
              <strong>Your conversations</strong>
              <p>Select a conversation to read and reply.</p>
            </div>
          ) : (
            <>
              <header className="chat-header">
                <button
                  className="btn btn-secondary chat-back"
                  aria-label="Back to conversations"
                  onClick={() => open("")}
                >
                  <ArrowLeft size={18} />
                </button>
                <div className="chat-heading">
                  <strong>{name(current)}</strong>
                  <small>
                    {ticket
                      ? "Support · " + ticket.status.replaceAll("_", " ")
                      : current?.gymId?.name || "Private conversation"}
                  </small>
                </div>
                <button
                  className="btn btn-secondary"
                  aria-label="Hide conversation for me"
                  title="Hide for me; other participants keep their history"
                  disabled={archive.isPending}
                  onClick={() => {
                    if (
                      window.confirm(
                        "Hide this conversation for you? Other participants keep their history.",
                      )
                    )
                      archive.mutate();
                  }}
                >
                  <Archive size={17} />
                  <span className="chat-action-label">Hide for me</span>
                </button>
                {ticket && admin && (
                  <select
                    className="select support-status"
                    aria-label="Support status"
                    value={ticket.status}
                    disabled={changeStatus.isPending}
                    onChange={(event) =>
                      changeStatus.mutate(event.target.value)
                    }
                  >
                    {statuses.map((status) => (
                      <option value={status} key={status}>
                        {status.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                )}
              </header>
              <div
                ref={history}
                className="message-history"
                role="log"
                aria-label="Message history"
                aria-live="polite"
              >
                {details.isError && <p role="alert">{details.error.message}</p>}
                <QueryState query={messages}>
                  {(cursor === undefined
                    ? messages.data?.meta?.hasMore
                    : !!cursor) && (
                    <button
                      className="btn btn-secondary chat-load"
                      disabled={loadOlder.isPending}
                      onClick={() => loadOlder.mutate()}
                    >
                      Load earlier messages
                    </button>
                  )}
                  {!combined.length && (
                    <div className="state-card">
                      No messages yet. Say hello.
                    </div>
                  )}
                  {combined.map((message) => {
                    const mine = messageBelongsToUser(message, userId);
                    return (
                      <article
                        className={
                          "message-bubble " +
                          (mine ? "outgoing" : "incoming") +
                          (message.deletedAt ? " deleted" : "")
                        }
                        key={message.publicId}
                        aria-label={
                          mine
                            ? "Your message"
                            : "Message from " +
                              (message.senderId?.name || "Member")
                        }
                      >
                        {!mine && (
                          <strong>{message.senderId?.name || "Member"}</strong>
                        )}
                        <p>
                          {message.deletedAt
                            ? "This message was deleted."
                            : message.text}
                        </p>
                        {!message.deletedAt &&
                          message.attachments?.map(
                            (attachment: Row, index: number) => (
                              <a
                                key={attachment.key || index}
                                href={attachment.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="chat-attachment"
                              >
                                <Paperclip size={15} />
                                {attachment.name || "Attachment"}
                              </a>
                            ),
                          )}
                        <footer>
                          <time
                            dateTime={message.createdAt}
                            title={date(message.createdAt)}
                          >
                            {new Date(message.createdAt).toLocaleTimeString(
                              undefined,
                              { hour: "2-digit", minute: "2-digit" },
                            )}
                          </time>
                          {mine && !message.deletedAt && (
                            <small>
                              {message.readBy?.some(
                                (entry: Row) => String(entry.userId) !== userId,
                              )
                                ? "Read"
                                : "Sent"}
                            </small>
                          )}
                          {mine && !message.deletedAt && (
                            <button
                              type="button"
                              className="message-delete"
                              title="Delete for everyone"
                              aria-label="Delete your message for everyone"
                              disabled={remove.isPending}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "Delete this message for everyone?",
                                  )
                                )
                                  remove.mutate(message.publicId);
                              }}
                            >
                              <Trash2 size={13} />
                            </button>
                          )}
                        </footer>
                      </article>
                    );
                  })}
                </QueryState>
              </div>
              <div className="chat-compose-area">
                {read.isError && (
                  <p role="alert">
                    Could not update read status.{" "}
                    <button type="button" onClick={() => read.mutate(active)}>
                      Retry
                    </button>
                  </p>
                )}
                {errors.map((mutation, index) => (
                  <p role="alert" key={index}>
                    {mutation.error?.message}
                  </p>
                ))}
                {closed ? (
                  <div className="chat-closed">
                    <span>
                      This support conversation is {ticket.status.toLowerCase()}
                      .
                    </span>
                    <button
                      className="btn btn-secondary"
                      disabled={changeStatus.isPending}
                      onClick={() => changeStatus.mutate("OPEN")}
                    >
                      Reopen conversation
                    </button>
                  </div>
                ) : (
                  <form
                    className="message-composer"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (
                        !send.isPending &&
                        !upload.isPending &&
                        (text.trim() || attachments.length)
                      )
                        send.mutate({
                          conversationId: active,
                          clientMessageId: draftId.current,
                          text: text.trim(),
                          attachments,
                        });
                    }}
                  >
                    {attachments.length > 0 && (
                      <div className="chat-drafts">
                        {attachments.map((item) => (
                          <span key={item.publicId}>
                            {item.originalName}
                            <button
                              type="button"
                              aria-label={"Remove " + item.originalName}
                              onClick={() => {
                                setAttachments((values) =>
                                  values.filter(
                                    (value) => value.publicId !== item.publicId,
                                  ),
                                );
                                draftId.current = crypto.randomUUID();
                              }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      ref={fileInput}
                      type="file"
                      hidden
                      accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) upload.mutate(file);
                        event.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label="Attach a file"
                      disabled={
                        upload.isPending ||
                        send.isPending ||
                        attachments.length >= 10
                      }
                      onClick={() => fileInput.current?.click()}
                    >
                      <Paperclip size={18} />
                    </button>
                    <textarea
                      aria-label="Message"
                      value={text}
                      rows={1}
                      maxLength={5000}
                      disabled={send.isPending}
                      onChange={(event) => {
                        setText(event.target.value);
                        draftId.current = crypto.randomUUID();
                      }}
                      placeholder={
                        upload.isPending
                          ? "Uploading attachment…"
                          : "Write a message"
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.shiftKey &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          event.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <button
                      className="btn btn-primary"
                      aria-label="Send message"
                      disabled={
                        (!text.trim() && !attachments.length) ||
                        send.isPending ||
                        upload.isPending
                      }
                    >
                      <Send size={18} />
                      <span className="chat-action-label">
                        {send.isPending ? "Sending…" : "Send"}
                      </span>
                    </button>
                  </form>
                )}
              </div>
            </>
          )}
        </article>
      </section>
    </div>
  );
}
