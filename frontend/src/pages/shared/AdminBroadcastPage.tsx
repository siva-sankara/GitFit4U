import { PageHeader } from "../../components/PageHeader";
import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { QueryState, date, type Row } from "../live/LiveData";
import { StatusBadge } from "../../components/StatusBadge";
import "../../styles/messaging.css";

const audiences = [
  { value: "USER", label: "Users and members" },
  { value: "GYM_OWNER", label: "Gym owners" },
  { value: "TRAINER", label: "Trainers" },
  { value: "GYM_STAFF", label: "Gym staff" },
];
export function AdminBroadcastPage() {
  const client = useQueryClient(),
    key = useRef(crypto.randomUUID());
  const [name, setName] = useState(""),
    [message, setMessage] = useState("");
  const [roles, setRoles] = useState<string[]>(["USER"]),
    [page, setPage] = useState(1);
  const [notice, setNotice] = useState("");
  const history = useQuery({
    queryKey: ["admin-broadcasts", page],
    queryFn: () =>
      apiRequest<ApiEnvelope<Row[]>>(
        "/api/v1/conversations/broadcasts?page=" + page,
      ),
    refetchInterval: 10000,
  });
  const send = useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/conversations/broadcasts", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          message: message.trim(),
          roles,
          idempotencyKey: key.current,
        }),
      }),
    onSuccess: () => {
      setNotice(
        "Announcement queued. Delivery continues in the background; progress appears below.",
      );
      setName("");
      setMessage("");
      key.current = crypto.randomUUID();
      setPage(1);
      void client.invalidateQueries({ queryKey: ["admin-broadcasts"] });
    },
  });
  function changed() {
    key.current = crypto.randomUUID();
    setNotice("");
  }
  return (
    <div className="page-stack">
      <PageHeader>
        <div>
          <span className="eyebrow">Platform communication</span>
          <h1>Announcements</h1>
          <p>Send an announcement to selected account audiences.</p>
        </div>
      </PageHeader>
      <form
        className="panel broadcast-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (roles.length) send.mutate();
        }}
      >
        <label className="field">
          <span>Title</span>
          <input
            className="input"
            value={name}
            minLength={3}
            maxLength={120}
            required
            disabled={send.isPending}
            onChange={(event) => {
              setName(event.target.value);
              changed();
            }}
          />
        </label>
        <fieldset className="broadcast-audiences" disabled={send.isPending}>
          <legend>Audience</legend>
          {audiences.map((audience) => (
            <label key={audience.value}>
              <input
                type="checkbox"
                checked={roles.includes(audience.value)}
                onChange={(event) => {
                  setRoles((values) =>
                    event.target.checked
                      ? [...values, audience.value]
                      : values.filter((value) => value !== audience.value),
                  );
                  changed();
                }}
              />
              {audience.label}
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>Message</span>
          <textarea
            className="input"
            rows={5}
            value={message}
            minLength={5}
            maxLength={5000}
            required
            disabled={send.isPending}
            onChange={(event) => {
              setMessage(event.target.value);
              changed();
            }}
          />
        </label>
        <p className="muted">
          Delivered once to each eligible active account, even when audiences
          overlap. New accounts created after submission are excluded.
        </p>
        <div>
          <button
            className="btn btn-primary"
            disabled={send.isPending || !roles.length}
          >
            <Send size={16} />
            {send.isPending ? "Queuing…" : "Send announcement"}
          </button>
        </div>
        {send.isError && (
          <p role="alert">
            {send.error.message} Your draft is saved here; retry to continue.
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
      </form>
      <section className="broadcast-history" aria-label="Announcement history">
        <h2>Delivery history</h2>
        <QueryState query={history}>
          {history.data?.data.map((row) => (
            <article className="panel broadcast-card" key={row.publicId}>
              <header>
                <strong>{row.name}</strong>
                <StatusBadge status={row.status} />
              </header>
              <p>{row.message}</p>
              <small>
                {date(row.createdAt)} ·{" "}
                {(row.audience?.roles || [])
                  .map(
                    (role: string) =>
                      audiences.find((item) => item.value === role)?.label ||
                      role,
                  )
                  .join(", ")}
              </small>
              <p>
                {row.analytics?.delivered || 0} inbox deliveries
                {row.status === "COMPLETED"
                  ? " · Complete"
                  : " · Processing in background"}
              </p>
            </article>
          ))}
          {!history.data?.data.length && (
            <div className="state-card panel">No announcements sent yet.</div>
          )}
          <div className="heading-actions">
            <button
              className="btn btn-secondary"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Previous
            </button>
            <span>Page {page}</span>
            <button
              className="btn btn-secondary"
              disabled={page >= (history.data?.meta?.pages || 1)}
              onClick={() => setPage((value) => value + 1)}
            >
              Next
            </button>
          </div>
        </QueryState>
      </section>
    </div>
  );
}
