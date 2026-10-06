import { useEffect, useState, type FormEvent } from "react";
import { useCurrentUser } from "../../api/hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { PhoneInput } from "../../components/PhoneInput";
import { StatusBadge } from "../../components/StatusBadge";
import { Avatar } from "../../components/Avatar";
import { MediaImageEditor } from "../../components/MediaImageEditor";
import type { MemberRow } from "./OwnerMembersPage";
import "../../styles/member-management.css";
import { EmptyState, Pagination, SkeletonTableRows } from "../../components/DataListControls";

export function OwnerTrainersPage() {
  const session = useCurrentUser(),
    canManage = session.data?.data.context.permissions.includes("class:write");
  const basePath = "/api/v1/owner/trainers",
    client = useQueryClient();
  const [page, setPage] = useState(1), [limit, setLimit] = useState(10);
  const [q, setQ] = useState(""), [search, setSearch] = useState("");
  const [editing, setEditing] = useState<MemberRow | null>(null);
  const [photo, setPhoto] = useState<{ id: string | null; url?: string }>();
  const [imageBusy, setImageBusy] = useState(false);
  const [availability, setAvailability] = useState<
    Array<{ day: number; from: string; to: string }>
  >([]);
  useEffect(() => {
    const timer = window.setTimeout(() => { setSearch(q.trim()); setPage(1); }, 350);
    return () => window.clearTimeout(timer);
  }, [q]);
  const path = `${basePath}?${new URLSearchParams({ page: String(page), limit: String(limit), q: search })}`;
  function openTrainer(row: MemberRow) {
    setPhoto(undefined);
    save.reset();
    setAvailability(
      (row.availability || []).map((entry: any) => ({
        day: entry.day,
        from: entry.from,
        to: entry.to,
      })),
    );
    setEditing(row);
  }
  const query = useQuery({
    queryKey: ["api", path],
    queryFn: () => apiRequest<ApiEnvelope<MemberRow[]>>(path),
    retry: false,
  });
  const save = useMutation({
    mutationFn: (body: object) =>
      apiRequest(basePath + (editing?.publicId ? "/" + editing.publicId : ""), {
        method: editing?.publicId ? "PATCH" : "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      setEditing(null);
      void client.invalidateQueries({ queryKey: ["api"] });
    },
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const data = new FormData(event.currentTarget),
      text = (name: string) => String(data.get(name) || "").trim();
    save.mutate({
      name: text("name"),
      email: text("email"),
      ...(text("phone") ? { phone: text("phone") } : {}),
      ...(photo ? { photoAttachmentId: photo.id } : {}),
      experienceYears: Number(text("experienceYears") || 0),
      specializations: text("specializations")
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
      qualifications: text("qualifications")
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
      bio: text("bio"),
      status: text("status"),
      availability,
    });
  }
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Gym team</span>
          <h1>Trainers</h1>
          <p>Manage gym assignments, qualifications and availability.</p>
        </div>
        {canManage && (
          <button
            className="btn btn-primary"
            onClick={() => {
              openTrainer({});
            }}
          >
            Add trainer
          </button>
        )}
      </header>
      <label className="search-field"><span className="sr-only">Search trainers</span><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search by name, email, or phone" /></label>
      {query.isPending ? (
        <SkeletonTableRows columns={6} />
      ) : query.isError ? (
        <div className="panel state-card" role="alert">
          <p>{query.error.message}</p>
          <button
            className="btn btn-secondary"
            onClick={() => void query.refetch()}
          >
            Retry
          </button>
        </div>
      ) : (
        <section className="panel member-management-scroll">
          <table className="member-management-table">
            <thead>
              <tr>
                <th>Trainer</th>
                <th>Contact</th>
                <th>Specialization</th>
                <th>Experience</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {query.data?.data.map((trainer) => (
                <tr key={trainer.publicId}>
                  <td>
                    <Avatar name={trainer.name} src={trainer.photoUrl} thumbnailSrc={trainer.photoThumbnailUrl} />
                    <strong>{trainer.name}</strong>
                  </td>
                  <td>
                    {trainer.phone || trainer.userId?.phone || "Not provided"}
                    <small>{trainer.email || trainer.userId?.email}</small>
                  </td>
                  <td>
                    {trainer.specializations?.join(", ") || "Not provided"}
                  </td>
                  <td>{trainer.experienceYears ?? 0} years</td>
                  <td>
                    <StatusBadge status={trainer.status} />
                  </td>
                  <td>
                    {canManage ? (
                      <button
                        className="btn btn-secondary"
                        onClick={() => {
                          openTrainer(trainer);
                        }}
                      >
                        View / Edit
                      </button>
                    ) : (
                      "Read only"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!query.data?.data.length && <EmptyState title="No trainers found" detail="Try another search or add a trainer." />}
          <Pagination page={page} limit={limit} total={query.data?.meta?.total || 0} loading={query.isFetching} onPageChange={setPage} onLimitChange={(value) => { setLimit(value); setPage(1); }} />
        </section>
      )}
      <Modal
        open={!!editing}
        title={editing?.publicId ? "Edit trainer" : "Add trainer"}
        onClose={() => {
          if (!save.isPending) setEditing(null);
        }}
        wide
      >
        {editing && (
          <form className="modal-form member-management-form" onSubmit={submit}>
            <p className="full-width">
              The trainer must already have a verified account. Gym assignment
              gives access only to this gym.
            </p>
            {(
              [
                ["name", "Full name", "text"],
                ["email", "Account email", "email"],
                ["phone", "Phone number", "tel"],
              ] as const
            ).map(([name, label, type]) => (
              <label className="field" key={name}>
                <span>{label}</span>
                {name === "phone" ? <PhoneInput name={name} defaultValue={editing.phone || editing.userId?.phone || ""} /> : <input
                  className="input"
                  name={name}
                  type={type}
                  required={name === "name" || name === "email"}
                  readOnly={name === "email" && !!editing.publicId}
                  defaultValue={editing[name] || editing.userId?.[name] || ""}
                />}
              </label>
            ))}
            <label className="field">
              <span>Experience (years)</span>
              <input
                className="input"
                type="number"
                name="experienceYears"
                min={0}
                max={70}
                defaultValue={editing.experienceYears || 0}
              />
            </label>
            <div className="full-width"><MediaImageEditor purpose="TRAINER_IMAGE" label="Trainer photo" previewUrl={photo ? photo.url : editing.photoUrl} onBusyChange={setImageBusy} onChange={(id, url) => setPhoto({ id, url })} /></div>
            <label className="field">
              <span>Status</span>
              <select
                className="select"
                name="status"
                defaultValue={editing.status || "ACTIVE"}
              >
                {["ACTIVE", "INACTIVE", "ARCHIVED"].map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
            </label>
            <label className="field full-width">
              <span>Specializations (comma separated)</span>
              <input
                className="input"
                name="specializations"
                defaultValue={editing.specializations?.join(", ")}
              />
            </label>
            <label className="field full-width">
              <span>Certifications and qualifications (one per line)</span>
              <textarea
                className="textarea"
                name="qualifications"
                defaultValue={editing.qualifications?.join("\n")}
              />
            </label>
            <label className="field full-width">
              <span>About trainer</span>
              <textarea
                className="textarea"
                name="bio"
                maxLength={3000}
                defaultValue={editing.bio}
              />
            </label>
            <fieldset className="full-width">
              <legend>Availability in gym local time</legend>
              {availability.map((slot, index) => (
                <div
                  className="heading-actions"
                  key={index}
                  style={{ marginBottom: 12 }}
                >
                  <label>
                    Day{" "}
                    <select
                      className="select"
                      value={slot.day}
                      onChange={(event) =>
                        setAvailability((rows) =>
                          rows.map((row, i) =>
                            i === index
                              ? { ...row, day: Number(event.target.value) }
                              : row,
                          ),
                        )
                      }
                    >
                      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                        (day, value) => (
                          <option key={day} value={value}>
                            {day}
                          </option>
                        ),
                      )}
                    </select>
                  </label>
                  <label>
                    From{" "}
                    <input
                      className="input"
                      type="time"
                      required
                      value={slot.from}
                      onChange={(event) =>
                        setAvailability((rows) =>
                          rows.map((row, i) =>
                            i === index
                              ? { ...row, from: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <label>
                    To{" "}
                    <input
                      className="input"
                      type="time"
                      required
                      value={slot.to}
                      onChange={(event) =>
                        setAvailability((rows) =>
                          rows.map((row, i) =>
                            i === index
                              ? { ...row, to: event.target.value }
                              : row,
                          ),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() =>
                      setAvailability((rows) =>
                        rows.filter((_, i) => i !== index),
                      )
                    }
                  >
                    Remove slot
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="btn btn-secondary"
                disabled={availability.length >= 21}
                onClick={() =>
                  setAvailability((rows) => [
                    ...rows,
                    { day: 1, from: "09:00", to: "18:00" },
                  ])
                }
              >
                Add availability
              </button>
            </fieldset>
            {save.isError && (
              <p className="form-alert full-width" role="alert">
                {save.error.message}
              </p>
            )}
            <button
              className="btn btn-primary full-width"
              disabled={save.isPending || imageBusy}
            >
              {save.isPending ? "Saving..." : "Save trainer"}
            </button>
          </form>
        )}
      </Modal>
    </div>
  );
}
