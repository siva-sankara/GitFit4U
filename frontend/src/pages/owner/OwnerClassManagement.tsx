import { PageHeader } from "../../components/PageHeader";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../api/hooks";
import { apiRequest, ApiError } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { ClassCard } from "../../components/ClassCard";
import { MediaImageEditor } from "../../components/MediaImageEditor";
import { QueryState, Table, useData, type Row } from "../live/LiveData";
import { EmptyState, Pagination } from "../../components/DataListControls";

const localInput = (value?: string) => {
  const date = value ? new Date(value) : new Date(Date.now() + 3600000);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
};
export function ClassEditor({
  value,
  onClose,
  onSaved,
}: {
  value?: Row;
  onClose: () => void;
  onSaved: () => void;
}) {
  const trainers = useData<Row[]>("/api/v1/owner/trainers?limit=100");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [imageAttachmentId, setImageAttachmentId] = useState<string | null | undefined>(value?.imageAttachmentId);
  const [imageUrl, setImageUrl] = useState<string | undefined>(value?.imageUrl);
  const [uploading, setUploading] = useState(false);
  const attempt = useRef({ signature: "", key: "" });
  const save = useMutation({
    mutationFn: (body: Row) => {
      const serialized = JSON.stringify(body);
      if (attempt.current.signature !== serialized)
        attempt.current = { signature: serialized, key: crypto.randomUUID() };
      return apiRequest(
        value
          ? `/api/v1/workspace/classes/${value.publicId}`
          : "/api/v1/owner/classes",
        {
          method: value ? "PATCH" : "POST",
          body: serialized,
          idempotencyKey: attempt.current.key,
        },
      );
    },
    onSuccess: onSaved,
    onError: (error: Error) => {
      if (error instanceof ApiError) {
        const details = error.details as {
          fieldErrors?: Record<string, string[]>;
        };
        if (details?.fieldErrors)
          setErrors(
            Object.fromEntries(
              Object.entries(details.fieldErrors).map(([key, messages]) => [
                key,
                messages.join(" "),
              ]),
            ),
          );
      }
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (uploading) return;
    const form = new FormData(event.currentTarget),
      text = (name: string) => String(form.get(name) || "").trim();
    const start = new Date(text("startsAt")),
      end = new Date(text("endsAt"));
    const issues: Record<string, string> = {};
    if (!Number.isFinite(start.getTime()))
      issues.startsAt = "Choose a valid start date and time.";
    if (!Number.isFinite(end.getTime()) || end <= start)
      issues.endsAt = "End time must be later than start time.";
    const capacity = Number(text("capacity"));
    if (
      !Number.isInteger(capacity) ||
      capacity < Math.max(1, value?.bookedCount || 0) ||
      capacity > 1000
    )
      issues.capacity =
        "Capacity must cover existing bookings and be between 1 and 1,000.";
    setErrors(issues);
    if (Object.keys(issues).length) return;
    save.mutate({
      name: text("name"),
      category: text("category"),
      trainerId: text("trainerId") || null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      capacity,
      room: text("room"),
      description: text("description"),
      status: text("status") || "SCHEDULED",
      ...(imageAttachmentId !== undefined ? { imageAttachmentId } : {}),
    });
  }
  const fieldError = (name: string) =>
    errors[name] ? (
      <small id={`class-${name}-error`} role="alert" className="form-alert">
        {errors[name]}
      </small>
    ) : null;
  return (
    <Modal
      open
      title={value ? "Edit class" : "Create class"}
      onClose={() => {
        if (!save.isPending && !uploading) onClose();
      }}
      wide
    >
      <form className="class-editor" onSubmit={submit}>
        <fieldset disabled={save.isPending}>
          <legend>Basic information</legend>
          <div className="class-form-grid">
            <label className="field">
              <span>Class name</span>
              <input
                className="input"
                name="name"
                required
                maxLength={160}
                defaultValue={value?.name}
                aria-invalid={!!errors.name}
              />
              {fieldError("name")}
            </label>
            <label className="field">
              <span>Category</span>
              <select
                className="select"
                name="category"
                defaultValue={value?.category || "OTHER"}
              >
                {[
                  "YOGA",
                  "ZUMBA",
                  "CROSSFIT",
                  "HIIT",
                  "STRENGTH",
                  "CARDIO",
                  "OTHER",
                ].map((category) => (
                  <option key={category}>{category}</option>
                ))}
              </select>
              {fieldError("category")}
            </label>
            <label className="field class-form-wide">
              <span>Description</span>
              <textarea
                className="textarea"
                name="description"
                maxLength={3000}
                defaultValue={value?.description}
              />
            </label>
          </div>
          <MediaImageEditor purpose="CLASS_IMAGE" label="Class image" previewUrl={imageUrl}
            disabled={save.isPending} onBusyChange={setUploading}
            onChange={(id, url) => { setImageAttachmentId(id); setImageUrl(url); }} />
          {fieldError("imageAttachmentId")}
        </fieldset>
        <fieldset>
          <legend>Schedule</legend>
          <p>
            Times are entered in{" "}
            {Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone.replaceAll("_", " ")}{" "}
            and saved with their timezone offset.
          </p>
          <div className="class-form-grid">
            <label className="field">
              <span>Start date and time</span>
              <input
                className="input"
                name="startsAt"
                type="datetime-local"
                required
                defaultValue={localInput(value?.startsAt)}
                aria-invalid={!!errors.startsAt}
                aria-describedby={
                  errors.startsAt ? "class-startsAt-error" : undefined
                }
              />
              {fieldError("startsAt")}
            </label>
            <label className="field">
              <span>End date and time</span>
              <input
                className="input"
                name="endsAt"
                type="datetime-local"
                required
                defaultValue={
                  value?.endsAt
                    ? localInput(value.endsAt)
                    : localInput(new Date(Date.now() + 7200000).toISOString())
                }
                aria-invalid={!!errors.endsAt}
                aria-describedby={
                  errors.endsAt ? "class-endsAt-error" : undefined
                }
              />
              {fieldError("endsAt")}
            </label>
            <label className="field">
              <span>Room</span>
              <input
                className="input"
                name="room"
                maxLength={160}
                defaultValue={value?.room}
              />
            </label>
            {value && (
              <label className="field">
                <span>Status</span>
                <select
                  className="select"
                  name="status"
                  defaultValue={value.status}
                >
                  <option>SCHEDULED</option>
                  <option>COMPLETED</option>
                </select>
                {fieldError("status")}
              </label>
            )}
          </div>
        </fieldset>
        <fieldset>
          <legend>Trainer and booking capacity</legend>
          <div className="class-form-grid">
            <label className="field">
              <span>Trainer</span>
              <select
                className="select"
                name="trainerId"
                defaultValue={value?.trainerId?._id || value?.trainerId || ""}
              >
                <option value="">Assign later</option>
                {trainers.data?.data
                  .filter((trainer) => trainer.status === "ACTIVE")
                  .map((trainer) => (
                    <option key={trainer._id} value={trainer._id}>
                      {trainer.name}
                    </option>
                  ))}
              </select>
              {fieldError("trainerId")}
            </label>
            <label className="field">
              <span>Capacity</span>
              <input
                className="input"
                name="capacity"
                type="number"
                required
                min={Math.max(1, value?.bookedCount || 0)}
                max={1000}
                defaultValue={value?.capacity || 10}
                aria-invalid={!!errors.capacity}
              />
              {fieldError("capacity")}
            </label>
          </div>
          <p>
            Bookings require an eligible membership covering the class.{" "}
            {value?.bookedCount || 0} members are currently booked.
          </p>
        </fieldset>
        {trainers.isError && <p role="alert">{trainers.error.message}</p>}
        {save.isError && (
          <p role="alert" className="form-alert">
            {save.error.message}
          </p>
        )}
        <footer className="heading-actions">
          <button className="btn btn-primary" disabled={save.isPending || uploading}>
            {save.isPending ? "Saving…" : value ? "Save class" : "Create class"}
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={save.isPending || uploading}
            onClick={onClose}
          >
            Cancel
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function OwnerClassManagement({
  embedded = false,
  canRead,
  canWrite,
}: {
  embedded?: boolean;
  canRead?: boolean;
  canWrite?: boolean;
}) {
  const me = useCurrentUser(),
    permissions = me.data?.data.context.permissions || [];
  const read = canRead ?? permissions.includes("gym:read"),
    write = canWrite ?? permissions.includes("class:write");
  const [page, setPage] = useState(1),
    [limit, setLimit] = useState(10),
    [status, setStatus] = useState(""),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [bookingClass, setBookingClass] = useState<Row | null>(null),
    [bookingPage, setBookingPage] = useState(1),
    [bookingLimit, setBookingLimit] = useState(10),
    [cancelling, setCancelling] = useState<Row | null>(null),
    [reason, setReason] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(q.trim());
      setPage(1);
    }, 350);
    return () => window.clearTimeout(timer);
  }, [q]);
  const client = useQueryClient();
  const classes = useData<Row[]>(
    `/api/v1/owner/classes?${new URLSearchParams({ page: String(page), limit: String(limit), status, q: search })}`,
    read,
  );
  const bookings = useData<Row[]>(
    bookingClass ? `/api/v1/owner/classes/${bookingClass.publicId}/bookings?page=${bookingPage}&limit=${bookingLimit}` : "/api/v1/owner/classes/unselected/bookings",
    Boolean(bookingClass),
  );
  const saved = () => {
    setEditing(null);
    setCancelling(null);
    void client.invalidateQueries({ queryKey: ["api"] });
  };
  const cancel = useMutation({
    mutationFn: () =>
      apiRequest(`/api/v1/owner/classes/${cancelling!.publicId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason }),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: saved,
  });
  return (
    <section
      className={embedded ? "panel form-section page-stack" : "page-stack"}
      id={embedded ? "gym-classes" : undefined}
    >
      <PageHeader>
        <div>
          {embedded ? (
            <h2>Classes and group sessions</h2>
          ) : (
            <h1>Classes and bookings</h1>
          )}
          <p>Manage schedules, trainers and available places.</p>
        </div>
        {write && (
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            Create class
          </button>
        )}
      </PageHeader>
      {read && (
        <>
          <div className="table-toolbar">
            <label className="search-field"><span className="sr-only">Search classes</span><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search classes" /></label>
            <label className="field class-status-filter"><span>Class status</span><select className="select" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">All classes</option><option>SCHEDULED</option><option>CANCELLED</option><option>COMPLETED</option></select></label>
          </div>
          <QueryState query={classes}>
            <div className="class-card-grid">
              {classes.data?.data.map((session) => (
                <ClassCard
                  key={session.publicId}
                  session={session}
                  actions={
                    (
                      <>
                        <button className="btn btn-secondary" onClick={() => { setBookingPage(1); setBookingClass(session); }}>View bookings</button>
                        {write && session.status !== "CANCELLED" && <button className="btn btn-secondary" onClick={() => setEditing(session)}>Edit / assign trainer</button>}
                        {write && session.status === "SCHEDULED" && (
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              setReason("");
                              cancel.reset();
                              setCancelling(session);
                            }}
                          >
                            Cancel class
                          </button>
                        )}
                      </>
                    )
                  }
                />
              ))}
            </div>
            {!classes.data?.data.length && <EmptyState title="No classes found" detail="Try changing your search or class status." />}
          </QueryState>
          <Pagination page={page} limit={limit} total={classes.data?.meta?.total || 0} loading={classes.isFetching} onPageChange={setPage} onLimitChange={(value) => { setLimit(value); setPage(1); }} />
        </>
      )}
      {editing && (
        <ClassEditor
          value={editing.publicId ? editing : undefined}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
      <Modal open={!!bookingClass} title={`${bookingClass?.name || "Class"} bookings`} onClose={() => setBookingClass(null)} wide>
        <QueryState query={bookings}>
          <Table rows={bookings.data?.data || []} columns={[
            { key: "memberProfileId.contact.name", title: "Member", render: (row) => row.memberProfileId?.contact?.name || row.memberProfileId?.memberCode || "Member" },
            { key: "memberProfileId.memberCode", title: "Member ID" },
            { key: "status", title: "Booking status", format: "status" },
            { key: "bookedAt", title: "Booked", format: "date" },
          ]} actions={(row) => row.memberProfileId?.publicId ? <a className="btn btn-secondary" href={`/owner/members/${row.memberProfileId.publicId}`}>View member</a> : null} />
          {!bookings.data?.data.length && <EmptyState title="No bookings yet" detail="Bookings for this class will appear here." />}
          <Pagination page={bookingPage} limit={bookingLimit} total={bookings.data?.meta?.total || 0} loading={bookings.isFetching} onPageChange={setBookingPage} onLimitChange={(value) => { setBookingLimit(value); setBookingPage(1); }} />
        </QueryState>
      </Modal>
      <Modal
        open={!!cancelling}
        title="Cancel class?"
        onClose={() => {
          if (!cancel.isPending) setCancelling(null);
        }}
      >
        <form
          className="modal-form"
          onSubmit={(event) => {
            event.preventDefault();
            cancel.mutate();
          }}
        >
          <p>
            All active bookings for {cancelling?.name} will be cancelled and
            affected members notified. Attendance history is retained.
          </p>
          <label className="field">
            <span>Reason</span>
            <textarea
              className="textarea"
              required
              minLength={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          {cancel.isError && <p role="alert">{cancel.error.message}</p>}
          <button className="btn btn-primary" disabled={cancel.isPending}>
            {cancel.isPending ? "Cancelling…" : "Confirm cancellation"}
          </button>
        </form>
      </Modal>
    </section>
  );
}
