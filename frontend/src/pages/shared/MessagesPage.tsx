import { PageHeader } from "../../components/PageHeader";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import {
  Archive,
  ArchiveRestore,
  MessageSquare,
  Paperclip,
  Send,
  Trash2,
} from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { useCurrentUser } from "../../api/hooks";
import { uploadMedia } from "../../services/mediaUpload";
import { Avatar } from "../../components/Avatar";
import { BackIconButton, BackIconLink } from "../../components/BackIconControl";
import { safeReturnTo } from "../../services/authRedirect";
import { WhatsAppInbox } from "../../components/WhatsAppInbox";
import { WhatsAppConnectionSettings } from "../../components/WhatsAppConnectionSettings";
import { QueryState, date, type Row } from "../live/LiveData";
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
type ConversationScope = { conversationId: string };
function InternalMessagesPage({
  supportOnly = false,
}: {
  supportOnly?: boolean;
}) {
  const client = useQueryClient(),
    me = useCurrentUser(),
    location = useLocation(),
    [params, setParams] = useSearchParams();
  const sourceState = location.state as
    | { returnTo?: string; returnLabel?: string }
    | null;
  const returnTo = safeReturnTo(sourceState?.returnTo);
  const userId = me.data?.data?.user?._id,
    admin = me.data?.data?.context?.role === "ADMIN";
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""), [searchDraft, setSearchDraft] = useState("");
  const [archived, setArchived] = useState(false);
  const [contactSearch, setContactSearch] = useState(""), [contactQuery, setContactQuery] = useState(""), [contactPage, setContactPage] = useState(1), [contactOpen, setContactOpen] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => { setContactQuery(contactSearch.trim()); setContactPage(1); setRecipient(""); }, 300);
    return () => clearTimeout(timer);
  }, [contactSearch]);
  useEffect(() => {
    const timer = setTimeout(() => { setSearch(searchDraft.trim()); setPage(1); }, 300);
    return () => clearTimeout(timer);
  }, [searchDraft]);
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
  // Every selection gets a fresh identity, including A -> B -> A. Late work
  // must not attach a file or clear a draft created during a later selection.
  const scope = useRef<ConversationScope>({ conversationId: active });
  function selectConversation(id: string) {
    if (scope.current.conversationId === id) return;
    scope.current = { conversationId: id };
    setActive(id);
    setOlder([]);
    setCursor(undefined);
    setText("");
    setAttachments([]);
    draftId.current = crypto.randomUUID();
  }
  const conversations = useQuery({
    queryKey: ["conversations", supportOnly, page, archived, search],
    queryFn: () =>
      apiRequest<ApiEnvelope<Row[]>>(
        "/api/v1/conversations?page=" +
          page +
          "&limit=10" +
          (archived ? "&archived=true" : "") +
          (supportOnly ? "&type=SUPPORT" : "") +
          (search ? "&q=" + encodeURIComponent(search) : ""),
      ),
    refetchInterval: 10000,
  });
  const contacts = useQuery({
    queryKey: ["conversation-contacts", me.data?.data.context?.role, me.data?.data.context?.gymId, contactQuery, contactPage],
    enabled: !supportOnly && contactOpen && (contactQuery.length === 0 || contactQuery.length >= 2),
    queryFn: () => apiRequest<ApiEnvelope<Row[]>>("/api/v1/conversations/contacts?q=" + encodeURIComponent(contactQuery) + "&page=" + contactPage + "&limit=10"),
  });
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
    selectConversation(id);
    setParams(id ? { conversation: id } : {}, {
      replace: true,
      state: location.state,
    });
  }
  function refresh(conversationId = scope.current.conversationId) {
    for (const key of [
      ["conversations"],
      ["conversation", conversationId],
      ["messages", conversationId],
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
      scope: ConversationScope;
      clientMessageId: string;
      text: string;
      attachments: Row[];
    }) =>
      apiRequest(path(draft.scope.conversationId) + "/messages", {
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
      if (draft.scope === scope.current && draft.clientMessageId === draftId.current) {
        setText("");
        setAttachments([]);
        draftId.current = crypto.randomUUID();
      }
      refresh(draft.scope.conversationId);
      requestAnimationFrame(() => {
        if (draft.scope !== scope.current) return;
        history.current?.scrollTo({
          top: history.current.scrollHeight,
          behavior: "smooth",
        });
      });
    },
  });
  const upload = useMutation({
    mutationFn: (input: { file: File; scope: ConversationScope }) => uploadMedia(input.file, "MESSAGE"),
    onSuccess: (result, input) => {
      if (input.scope !== scope.current) return;
      setAttachments((value) => [...value, result]);
      draftId.current = crypto.randomUUID();
    },
  });
  const loadOlder = useMutation({
    mutationFn: (input: { scope: ConversationScope; cursor: string }) =>
      apiRequest<ApiEnvelope<Row[]>>(
        path(input.scope.conversationId) +
          "/messages?before=" +
          encodeURIComponent(input.cursor),
      ),
    onSuccess: (result, input) => {
      if (input.scope !== scope.current) return;
      const element = history.current,
        height = element?.scrollHeight || 0;
      setOlder((value) => [...result.data, ...value]);
      setCursor(result.meta?.nextCursor || "");
      requestAnimationFrame(() => {
        if (input.scope !== scope.current) return;
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
    mutationFn: (input: { scope: ConversationScope }) => apiRequest(path(input.scope.conversationId), { method: "DELETE" }),
    onSuccess: (_result, input) => {
      refresh(input.scope.conversationId);
      if (input.scope !== scope.current) return;
      open("");
      setNotice(
        "Conversation archived for you. Open Archived chats to restore it. Other participants are not affected.",
      );
    },
  });
  const restore = useMutation({
    mutationFn: (input: { scope: ConversationScope }) => apiRequest(path(input.scope.conversationId) + "/restore", { method: "POST" }),
    onSuccess: (_result, input) => {
      refresh(input.scope.conversationId);
      if (input.scope !== scope.current) return;
      setArchived(false);
      setPage(1);
      setNotice("Conversation restored.");
    },
  });
  const remove = useMutation({
    mutationFn: (input: { id: string; scope: ConversationScope }) =>
      apiRequest(path(input.scope.conversationId) + "/messages/" + input.id, { method: "DELETE" }),
    onSuccess: (_result, input) => {
      refresh(input.scope.conversationId);
      if (input.scope !== scope.current) return;
      setOlder([]);
      setCursor(undefined);
    },
  });
  const changeStatus = useMutation({
    mutationFn: (input: { status: string; scope: ConversationScope }) =>
      apiRequest(path(input.scope.conversationId) + "/support-status", {
        method: "PATCH",
        body: JSON.stringify({ status: input.status }),
      }),
    onSuccess: (_result, input) => refresh(input.scope.conversationId),
  });
  const lastMessage = messages.data?.data.at(-1)?.publicId;
  useEffect(() => {
    selectConversation(params.get("conversation") || "");
  }, [params]);
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
  const isArchived = Boolean(
    current?.archivedBy?.some((id: string) => String(id) === String(userId)),
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
  function contactPhone(row?: Row) {
    return row?.type === "DIRECT" ? row.participants?.find((person: Row) => String(person._id) !== String(userId))?.phone : undefined;
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
    restore,
    remove,
    changeStatus,
  ].filter((mutation) => mutation.isError && mutation.variables?.scope === scope.current);
  const sendingHere = send.isPending && send.variables?.scope === scope.current;
  const uploadingHere = upload.isPending && upload.variables?.scope === scope.current;
  return (
    <div className="page-stack messaging-page">
      <PageHeader>
        <div>
          {returnTo && (
            <BackIconLink
              to={returnTo}
              label={sourceState?.returnLabel || "Back"}
            />
          )}
          <span className="eyebrow">Communication</span>
          <h1>{supportOnly ? "Support conversations" : "Messages"}</h1>
          <p>
            {supportOnly
              ? "Get help and keep every reply in one conversation."
              : "Stay in touch with your gym and training team."}
          </p>
        </div>
      </PageHeader>
      {notice && (
        <p role="status" className="chat-notice">
          {notice}
        </p>
      )}
      <details className="chat-start panel" onToggle={event => setContactOpen(event.currentTarget.open)}>
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
              <span>Find a contact</span>
              <input className="input" value={contactSearch} maxLength={80}
                placeholder={admin ? "Name, phone, email or gym name" : "Search your gym contacts"}
                onChange={event => setContactSearch(event.target.value)} />
              {contactQuery.length === 1 && <small>Enter at least two characters to search.</small>}
            </label>
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
                    {(row.name || row.publicId) + (row.phone ? " · " + row.phone : "")}
                  </option>
                ))}
              </select>
            </label>
            {contacts.isFetching && <span role="status">Finding contacts…</span>}
            {!contacts.isPending && !contacts.isError && !contacts.data?.data.length && contactQuery.length !== 1 && <p>No eligible contacts found.</p>}
            <div className="chat-contact-pagination">
              <button type="button" className="btn btn-secondary" aria-label="Previous contacts" disabled={contactPage <= 1 || contacts.isFetching} onClick={() => { setContactPage(value => value - 1); setRecipient(""); }}>Previous</button>
              <span>Page {contactPage} of {Math.max(1, contacts.data?.meta?.pages || 1)}</span>
              <button type="button" className="btn btn-secondary" aria-label="Next contacts" disabled={contactPage >= (contacts.data?.meta?.pages || 1) || contacts.isFetching} onClick={() => { setContactPage(value => value + 1); setRecipient(""); }}>Next</button>
            </div>
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
          <div
            className="chat-list-filter"
            role="group"
            aria-label="Conversation visibility"
          >
            <button
              className="btn btn-secondary"
              aria-pressed={!archived}
              onClick={() => {
                setArchived(false);
                setPage(1);
                open("");
              }}
            >
              Inbox
            </button>
            <button
              className="btn btn-secondary"
              aria-pressed={archived}
              onClick={() => {
                setArchived(true);
                setPage(1);
                open("");
              }}
            >
              <Archive size={15} />
              Archived chats
            </button>
          </div>
          <input
            className="input"
            aria-label="Search conversations"
            placeholder="Search conversations"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
          />
          <div className="conversation-scroll">
            <QueryState query={conversations}>
              {visible.map((row) => (
                <div
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
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <Avatar
                        user={row.participants?.find(
                          (person: Row) =>
                            String(person._id) !== String(userId),
                        )}
                        name={name(row)}
                        size={40}
                      />
                    )}
                  </span>
                  <button type="button" className="conversation-copy">
                    <strong>{name(row)}</strong>
                    {contactPhone(row) && <small className="chat-contact-phone">{contactPhone(row)}</small>}
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
                  </button>
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
                </div>
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
                <BackIconButton
                  className="btn btn-secondary chat-back"
                  label="Back to conversations"
                  onClick={() => open("")}
                />
                <div className="chat-heading">
                  <strong>{name(current)}</strong>
                  {contactPhone(current) && <small className="chat-contact-phone">{contactPhone(current)}</small>}
                  <small>
                    {ticket
                      ? "Support · " + ticket.status.replaceAll("_", " ")
                      : current?.gymId?.name || "Private conversation"}
                  </small>
                </div>
                <button
                  className="btn btn-secondary"
                  aria-label={
                    isArchived
                      ? "Restore conversation"
                      : "Archive conversation for me"
                  }
                  title={
                    isArchived
                      ? "Move back to your inbox"
                      : "Archive for me; other participants keep their history"
                  }
                  disabled={archive.isPending || restore.isPending}
                  onClick={() => {
                    if (isArchived) {
                      restore.mutate({ scope: scope.current });
                      return;
                    }
                    if (
                      window.confirm(
                        "Archive this conversation for you? Restore it anytime from Archived chats. Other participants keep their history.",
                      )
                    )
                      archive.mutate({ scope: scope.current });
                  }}
                >
                  {isArchived ? (
                    <ArchiveRestore size={17} />
                  ) : (
                    <Archive size={17} />
                  )}
                  <span className="chat-action-label">
                    {isArchived ? "Restore" : "Archive"}
                  </span>
                </button>
                {ticket && admin && (
                  <select
                    className="select support-status"
                    aria-label="Support status"
                    value={ticket.status}
                    disabled={changeStatus.isPending}
                    onChange={(event) =>
                      changeStatus.mutate({ status: event.target.value, scope: scope.current })
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
                      onClick={() => loadOlder.mutate({ scope: scope.current, cursor: cursor || messages.data?.meta?.nextCursor || "" })}
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
                              (message.type === "SYSTEM" ? "GETFIT4U" : message.senderId?.name || "Member")
                        }
                      >
                        {!mine && (
                          <div className="chat-sender">
                            <Avatar user={message.senderId} size={24} />
                            <strong>
                              {message.type === "SYSTEM" ? "GETFIT4U" : message.senderId?.name || "Member"}
                            </strong>
                          </div>
                        )}
                        <p>
                          {message.deletedAt
                            ? "This message was deleted."
                            : message.text}
                        </p>
                        {message.type === "SYSTEM" && ["/app/profile/payments", "/owner/payments"].includes(message.actionUrl) && <Link className="chat-attachment" to={message.actionUrl}>View / Download Invoice</Link>}
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
                                  remove.mutate({ id: message.publicId, scope: scope.current });
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
                {read.isError && read.variables === active && (
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
                {details.data?.data?.type === "SYSTEM" ? <p className="chat-closed">GETFIT4U receipts are read-only. Contact your gym through a separate conversation.</p> : closed ? (
                  <div className="chat-closed">
                    <span>
                      This support conversation is {ticket.status.toLowerCase()}
                      .
                    </span>
                    <button
                      className="btn btn-secondary"
                      disabled={changeStatus.isPending}
                      onClick={() => changeStatus.mutate({ status: "OPEN", scope: scope.current })}
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
                        !sendingHere &&
                        !uploadingHere &&
                        (text.trim() || attachments.length)
                      )
                        send.mutate({
                          scope: scope.current,
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
                              disabled={sendingHere}
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
                        if (file) upload.mutate({ file, scope: scope.current });
                        event.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-secondary"
                      aria-label="Attach a file"
                      disabled={
                        uploadingHere ||
                        sendingHere ||
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
                      disabled={sendingHere}
                      onChange={(event) => {
                        setText(event.target.value);
                        draftId.current = crypto.randomUUID();
                      }}
                      placeholder={
                        uploadingHere
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
                        sendingHere ||
                        uploadingHere
                      }
                    >
                      <Send size={18} />
                      <span className="chat-action-label">
                        {sendingHere ? "Sending…" : "Send"}
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

export function MessagesPage({ supportOnly = false }: { supportOnly?: boolean }) {
  const me = useCurrentUser();
  const [params] = useSearchParams();
  const role = me.data?.data.context?.role;
  const permissions = me.data?.data.context?.permissions || [];
  const businessInbox =
    !supportOnly &&
    ["ADMIN", "GYM_OWNER", "GYM_STAFF"].includes(role || "") &&
    (permissions.includes("member:read") || permissions.includes("admin:platform"));
  if (!businessInbox) return <InternalMessagesPage supportOnly={supportOnly} />;
  const channel = params.get("channel") === "whatsapp" ? "whatsapp" : "internal";
  return <div className="page-stack">
    <nav className="message-channel-tabs" aria-label="Message channels">
      <Link to="?channel=internal" aria-current={channel === "internal" ? "page" : undefined}>In-app messages</Link>
      <Link to="?channel=whatsapp" aria-current={channel === "whatsapp" ? "page" : undefined}>WhatsApp Business</Link>
    </nav>
    {channel === "whatsapp" ? <><details className="panel"><summary>WhatsApp sender settings</summary><WhatsAppConnectionSettings /></details><WhatsAppInbox /></> : <InternalMessagesPage />}
  </div>;
}
