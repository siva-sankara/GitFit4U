import { useEffect, useRef, useState } from "react";
import { Modal } from "../../components/Modal";
import { GymLogoEditor } from "./GymLogoEditor";
import { GymTermsEditor } from "./GymTermsEditor";
import { OwnerClassManagement } from "./OwnerClassManagement";
import { Link } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "../../api/hooks";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { uploadDocumentBytes } from "../../services/documentUpload";
import { LocationPicker } from "../../components/LocationPicker";
import { validCoordinates, type LocatedPoint } from "../../services/location";
import {
  EditForm,
  QueryState,
  useData,
  date,
  money,
  type Row,
  type Field,
} from "../live/LiveData";

const days = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];
const field = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  required = false,
): Field => ({ key, label, type, required });
function useSaveGym() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: Row) =>
      apiRequest("/api/v1/owner/gym", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["api"] }),
  });
}
function SaveResult({ save }: { save: ReturnType<typeof useSaveGym> }) {
  return (
    <>
      {save.isError && <p role="alert">{save.error.message}</p>}
      {save.isSuccess && <p role="status">Changes saved.</p>}
    </>
  );
}
export function GymProfileEditor({
  classFields,
  planFields,
}: {
  classFields: Field[];
  planFields: Field[];
}) {
  const gym = useData<Row>("/api/v1/owner/gym");
  const me = useCurrentUser();
  const permissions = me.data?.data.context?.permissions || [];
  const canEdit = permissions.includes("gym:update");
  return (
    <div className="page-stack gym-profile-editor">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Your gym</span>
          <h1>{gym.data?.data?.name || "Gym profile"}</h1>
          <p>Show members your space, what you offer, and when to visit.</p>
        </div>
        {gym.data?.data?.status === "ACTIVE" &&
          gym.data.data.platformSubscriptionStatus === "ACTIVE" && (
            <Link
              className="btn btn-secondary"
              to={`/gyms/${gym.data.data.slug}`}
            >
              View public gym page
            </Link>
          )}
      </header>
      {gym.data?.data &&
        (gym.data.data.status !== "ACTIVE" ||
          gym.data.data.platformSubscriptionStatus !== "ACTIVE") && (
          <p className="form-alert" role="status">
            Your member plans are saved under {gym.data.data.name}, but this gym
            is not available for public subscriptions. Gym status:{" "}
            {gym.data.data.status}. Platform subscription:{" "}
            {gym.data.data.platformSubscriptionStatus || "NONE"}. An active
            platform subscription is required for public checkout.
          </p>
        )}
      <nav className="profile-section-nav" aria-label="Gym profile sections">
        {[
          "Details",
          "Logo",
          "Memberships",
          "Media",
          "Location",
          "Hours",
          "Classes",
          "Terms",
        ].map((s) => (
          <a key={s} href={`#gym-${s.toLowerCase()}`}>
            {s}
          </a>
        ))}
      </nav>
      <QueryState query={gym}>
        {gym.data?.data && (
          <>
            <GymLogoEditor
              key={`logo-${gym.data.data._id}`}
              gym={gym.data.data}
              disabled={!canEdit}
            />
            <section id="gym-details" className="panel form-section page-stack">
              <h2>About your gym</h2>
              <fieldset disabled={!canEdit} className="profile-fieldset">
                <EditForm
                  method="PATCH"
                  endpoint="/api/v1/owner/gym"
                  initial={gym.data.data}
                  transform={(body) => ({
                    ...body,
                    description: body.description || "",
                    benefits: body.benefits || [],
                    facilities: body.facilities || [],
                    amenities: body.amenities || [],
                  })}
                  fields={[
                    field("name", "Gym name", "text", true),
                    field("description", "About the gym", "textarea"),
                    { ...field("contact.phone", "Contact phone"), clearable: true },
                    { ...field("contact.email", "Contact email", "email"), clearable: true },
                    { ...field("contact.whatsapp", "WhatsApp number"), clearable: true },
                    { ...field("contact.website", "Website", "text"), clearable: true },
                    field("facilities", "Facilities (one per line)", "lines"),
                    field("amenities", "Amenities (one per line)", "lines"),
                    field(
                      "benefits",
                      "Member benefits (one per line)",
                      "lines",
                    ),
                  ]}
                />
              </fieldset>
            </section>
            {permissions.includes("gym:read") && (
              <GymProfilePlans
                fields={planFields}
                canWrite={permissions.includes("plan:write")}
                slug={gym.data.data.slug}
                published={
                  gym.data.data.status === "ACTIVE" &&
                  gym.data.data.platformSubscriptionStatus === "ACTIVE"
                }
              />
            )}
            <section id="gym-media" className="panel form-section page-stack">
              <h2>Photos and videos</h2>
              <p>
                Add photos of your training areas and an MP4 tour. Choose a
                photo as the cover for gym listings.
              </p>
              <GymMediaEditor
                key={`media-${gym.data.data._id}`}
                gym={gym.data.data}
                disabled={!canEdit}
              />
            </section>
            <section
              id="gym-location"
              className="panel form-section page-stack"
            >
              <h2>Location and entrance</h2>
              <GymLocationEditor gym={gym.data.data} disabled={!canEdit} />
            </section>
            <section id="gym-hours" className="panel form-section page-stack">
              <h2>Opening hours</h2>
              <GymHoursEditor gym={gym.data.data} disabled={!canEdit} />
            </section>
            <GymProfileClasses
              fields={classFields}
              canWrite={permissions.includes("class:write")}
              canRead={permissions.includes("gym:read")}
            />
            <ClassReminderSettings gym={gym.data.data} disabled={!canEdit} />
            <MembershipReminderSettings gym={gym.data.data} disabled={!canEdit} />
            <GymTermsEditor terms={gym.data.data.terms} disabled={!canEdit} />
          </>
        )}
      </QueryState>
    </div>
  );
}
export function MembershipReminderSettings({ gym, disabled }: { gym: Row; disabled: boolean }) {
  const save = useSaveGym();
  return <section className="panel form-section page-stack"><h2>Membership renewal reminders</h2>
    <p>Daily reminders begin seven days before a member's gym membership expires. Choose how long to follow up after expiry; member notification preferences still apply.</p>
    <form onSubmit={(event) => {
      event.preventDefault(); const values = new FormData(event.currentTarget);
      save.mutate({ membershipReminders: { postExpiryDays: Number(values.get("postExpiryDays")) } });
    }}><fieldset className="profile-fieldset" disabled={disabled || save.isPending}>
      <label className="field"><span>Days after membership expiry</span><input className="input" name="postExpiryDays" type="number" min={0} max={7} step={1} required defaultValue={gym.membershipReminders?.postExpiryDays ?? 7} /></label>
      <small>0 stops reminders at expiry; the maximum is 7 days. Platform subscription reminders are managed separately.</small>
      <button className="btn btn-primary">Save renewal reminders</button>
    </fieldset><SaveResult save={save} /></form>
  </section>;
}
function ClassReminderSettings({ gym, disabled }: { gym: Row; disabled: boolean }) {
  const save = useSaveGym();
  return <section className="panel form-section page-stack"><h2>Class reminders</h2>
    <p>Remind confirmed attendees before their class. Their notification preferences still apply.</p>
    <form onSubmit={(event) => {
      event.preventDefault(); const values = new FormData(event.currentTarget);
      save.mutate({ classReminders: { enabled: values.get("enabled") === "on", leadMinutes: Number(values.get("leadMinutes")) } });
    }}><fieldset className="profile-fieldset" disabled={disabled || save.isPending}>
      <label><input type="checkbox" name="enabled" defaultChecked={gym.classReminders?.enabled !== false} /> Enable class reminders</label>
      <label className="field"><span>Minutes before class</span><input className="input" name="leadMinutes" type="number" min={15} max={1440} required defaultValue={gym.classReminders?.leadMinutes ?? 60} /></label>
      <button className="btn btn-primary">Save reminder settings</button>
    </fieldset><SaveResult save={save} /></form>
  </section>;
}
export function GymMediaEditor({
  gym,
  disabled = false,
}: {
  gym: Row;
  disabled?: boolean;
}) {
  const save = useSaveGym(),
    client = useQueryClient();
  const [file, setFile] = useState<File | null>(null),
    [progress, setProgress] = useState(0),
    [error, setError] = useState("");
  const staged = useRef<Row | null>(null),
    abort = useRef<AbortController | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const upload = useMutation({
    mutationFn: async () => {
      if (!file) return;
      setError("");
      const allowed = ["image/jpeg", "image/png", "image/webp", "video/mp4"];
      if (!allowed.includes(file.type))
        throw new Error("Choose a JPG, PNG, WebP photo or MP4 video.");
      if (
        !file.size ||
        file.size > (file.type === "video/mp4" ? 50_000_000 : 10_000_000)
      )
        throw new Error(
          "Photos must be 10 MB or smaller; videos must be 50 MB or smaller.",
        );
      if ((gym.mediaAttachmentIds || []).length >= 25)
        throw new Error(
          "Remove a file before adding more. The gallery supports 25 files.",
        );
      if (!staged.current) {
        abort.current = new AbortController();
        const start = await apiRequest<ApiEnvelope<Row>>("/api/v1/uploads", {
          method: "POST",
          body: JSON.stringify({
            name: file.name,
            mimeType: file.type,
            size: file.size,
            purpose: "GYM_GALLERY",
          }),
        });
        await uploadDocumentBytes(
          start.data.uploadUrl,
          file,
          setProgress,
          abort.current.signal,
        );
        const completed = await apiRequest<ApiEnvelope<Row>>(
          `/api/v1/uploads/${start.data.attachment.publicId}/complete`,
          { method: "POST", body: "{}" },
        );
        staged.current = completed.data;
      }
      await apiRequest("/api/v1/owner/gym", {
        method: "PATCH",
        body: JSON.stringify({
          mediaAttachmentIds: [
            ...new Set([
              ...(gym.mediaAttachmentIds || []),
              staged.current!._id,
            ]),
          ],
        }),
      });
      staged.current = null;
      setFile(null);
      setProgress(0);
      if (input.current) input.current.value = "";
      await client.invalidateQueries({ queryKey: ["api"] });
    },
    onError: (e) => setError(e.message),
  });
  const busy = upload.isPending || save.isPending;
  return (
    <>
      <fieldset
        className="profile-fieldset upload-area"
        disabled={disabled || busy}
      >
        <label className="field">
          <span>Choose photo or video</span>
          <input
            ref={input}
            type="file"
            accept="image/jpeg,image/png,image/webp,video/mp4"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              staged.current = null;
              setError("");
              setProgress(0);
            }}
          />
        </label>
        <small>
          JPG, PNG, WebP up to 10 MB. MP4 up to 50 MB. Maximum 25 files.
        </small>
        {file && (
          <p>
            {file.name} ({(file.size / 1_000_000).toFixed(1)} MB)
          </p>
        )}
        <button
          className="btn btn-primary"
          disabled={!file || busy}
          onClick={() => upload.mutate()}
        >
          {upload.isPending ? "Uploading..." : "Upload and add to profile"}
        </button>
      </fieldset>
      {upload.isPending && (
        <div role="status">
          <progress value={progress} max={100} aria-label="Upload progress" />
          <p>
            {progress === 100
              ? "Checking upload and saving to profile..."
              : `Uploading ${progress}%`}
          </p>
        </div>
      )}
      {error && (
        <p role="alert">{error} Your selected file is retained for retry.</p>
      )}
      {upload.isSuccess && !file && (
        <p role="status">Media added to your gym profile.</p>
      )}
      <div className="gym-media-grid">
        {(gym.media || []).map((m: Row) => (
          <article className="gym-media-item" key={m._id}>
            {m.mimeType.startsWith("video/") ? (
              <video
                controls
                preload="metadata"
                src={m.url}
                aria-label={m.name}
              />
            ) : (
              <img loading="lazy" src={m.url} alt={m.name} />
            )}
            <p>{m.name}</p>
            <div className="heading-actions">
              {m.mimeType.startsWith("image/") && (
                <button
                  className="btn btn-secondary"
                  disabled={disabled || busy || gym.coverAttachmentId === m._id}
                  onClick={() => save.mutate({ coverAttachmentId: m._id })}
                >
                  {gym.coverAttachmentId === m._id
                    ? "Cover photo"
                    : "Use as cover"}
                </button>
              )}
              <button
                className="btn btn-ghost"
                disabled={disabled || busy}
                onClick={() =>
                  save.mutate({
                    mediaAttachmentIds: gym.mediaAttachmentIds.filter(
                      (id: string) => id !== m._id,
                    ),
                    ...(gym.coverAttachmentId === m._id
                      ? { coverAttachmentId: null }
                      : {}),
                  })
                }
              >
                Remove from profile
              </button>
            </div>
          </article>
        ))}
      </div>
      {!gym.media?.length && <p>No uploaded photos or videos yet.</p>}
      <SaveResult save={save} />
    </>
  );
}
export function GymHoursEditor({
  gym,
  disabled = false,
}: {
  gym: Row;
  disabled?: boolean;
}) {
  const [hours, setHours] = useState<Row[]>(() =>
    days.map((_, day) => ({
      day,
      closed: true,
      opensAt: "06:00",
      closesAt: "22:00",
      ...gym.openingHours?.find((h: Row) => h.day === day),
    })),
  );
  const [timezone, setTimezone] = useState(gym.timezone || "Asia/Kolkata");
  const save = useSaveGym();
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          openingHours: hours.map((h) =>
            h.closed ? { day: h.day, closed: true } : h,
          ),
          timezone,
        });
      }}
    >
      <fieldset
        disabled={disabled || save.isPending}
        className="profile-fieldset page-stack"
      >
        <p>
          Set each day's hours. A closing time earlier than opening means the
          gym closes the following day.
        </p>
        <label className="field">
          <span>Gym timezone</span>
          <input
            className="input"
            required
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </label>
        {hours.map((h, i) => (
          <div key={h.day} className="gym-hours-row">
            <strong>{days[h.day]}</strong>
            <label>
              <input
                type="checkbox"
                checked={!h.closed}
                onChange={(e) =>
                  setHours(
                    hours.map((v, j) =>
                      i === j ? { ...v, closed: !e.target.checked } : v,
                    ),
                  )
                }
              />{" "}
              Open
            </label>
            {!h.closed ? (
              <>
                <label>
                  Opens
                  <input
                    type="time"
                    required
                    aria-label={`${days[h.day]} opens`}
                    value={h.opensAt}
                    onChange={(e) =>
                      setHours(
                        hours.map((v, j) =>
                          i === j ? { ...v, opensAt: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label>
                  Closes
                  <input
                    type="time"
                    required
                    aria-label={`${days[h.day]} closes`}
                    value={h.closesAt}
                    onChange={(e) =>
                      setHours(
                        hours.map((v, j) =>
                          i === j ? { ...v, closesAt: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
              </>
            ) : (
              <span>Closed</span>
            )}
          </div>
        ))}
        <button className="btn btn-primary">
          {save.isPending ? "Saving..." : "Save opening hours"}
        </button>
      </fieldset>
      <SaveResult save={save} />
    </form>
  );
}
export function GymLocationEditor({
  gym,
  disabled = false,
}: {
  gym: Row;
  disabled?: boolean;
}) {
  const [point, setPoint] = useState<LocatedPoint | undefined>(() =>
    gym.location?.coordinates
      ? {
          longitude: gym.location.coordinates[0],
          latitude: gym.location.coordinates[1],
        }
      : undefined,
  );
  const [address, setAddress] = useState<Row>({ ...gym.address }),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false);
  const save = useSaveGym();
  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (confirmed && validCoordinates(point) && !busy)
            save.mutate({
              address,
              location: { coordinates: [point.longitude, point.latitude] },
            });
        }}
      >
        <fieldset
          disabled={disabled || save.isPending}
          className="profile-fieldset page-stack"
        >
          <LocationPicker
            value={point}
            onBusyChange={setBusy}
            addressQuery={Object.values(address).filter(Boolean).join(", ")}
            onChange={(p) => {
              setPoint(p);
              setConfirmed(false);
              if (p.address) setAddress((a) => ({ ...a, ...p.address }));
            }}
          />
          <h3>Check the address members will see</h3>
          <div className="form-grid">
            {[
              ["line1", "Building and street"],
              ["line2", "Floor or landmark"],
              ["locality", "Area / locality"],
              ["city", "City"],
              ["state", "State"],
              ["postalCode", "Postal code"],
              ["country", "Country code"],
            ].map(([key, title]) => (
              <label className="field" key={key}>
                <span>{title}</span>
                <input
                  className="input"
                  required={[
                    "line1",
                    "city",
                    "state",
                    "postalCode",
                    "country",
                  ].includes(key)}
                  maxLength={
                    key === "country" ? 2 : key === "postalCode" ? 12 : 160
                  }
                  value={address[key] || ""}
                  onChange={(e) => {
                    setAddress({
                      ...address,
                      [key]:
                        key === "country"
                          ? e.target.value.toUpperCase()
                          : e.target.value,
                    });
                    setConfirmed(false);
                  }}
                />
              </label>
            ))}
          </div>
          <label className="registration-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={busy || !validCoordinates(point)}
              onChange={(e) => setConfirmed(e.target.checked)}
            />{" "}
            I checked the address and the pin marks the gym entrance.
          </label>
          <button
            className="btn btn-primary"
            disabled={!confirmed || busy || !validCoordinates(point)}
          >
            {save.isPending ? "Saving..." : "Save gym location"}
          </button>
        </fieldset>
        <SaveResult save={save} />
      </form>
      <details className="registration-section">
        <summary>Attendance location checks</summary>
        <fieldset disabled={disabled} className="profile-fieldset">
          <EditForm
            initial={gym}
            endpoint="/api/v1/owner/gym"
            method="PATCH"
            fields={[
              field(
                "attendanceLocationRequired",
                "Require scanner location",
                "checkbox",
              ),
              {
                ...field(
                  "attendanceRadiusMeters",
                  "Allowed distance from entrance (metres)",
                  "number",
                ),
                min: 25,
                max: 1000,
              },
            ]}
          />
        </fieldset>
      </details>
    </>
  );
}
function GymProfileClasses({
  fields,
  canWrite,
  canRead,
}: {
  fields: Field[];
  canWrite: boolean;
  canRead: boolean;
}) {
  return <OwnerClassManagement embedded canRead={canRead} canWrite={canWrite} />;
}

export function GymProfilePlans({
  fields,
  canWrite,
  slug,
  published = true,
}: {
  fields: Field[];
  canWrite: boolean;
  slug: string;
  published?: boolean;
}) {
  const plans = useData<Row[]>("/api/v1/owner/plans");
  const [editing, setEditing] = useState<Row | null>(null);
  return (
    <section id="gym-memberships" className="panel form-section page-stack">
      <div className="page-heading">
        <div>
          <h2>Member subscription plans</h2>
          <p>
            Set the memberships people can buy to join your gym. Active plans
            appear on your gym page. Draft and inactive plans stay hidden.
          </p>
        </div>
        {canWrite && (
          <button
            className="btn btn-primary"
            onClick={() => setEditing({ status: "ACTIVE" })}
          >
            Add membership plan
          </button>
        )}
      </div>
      <p>
        Your gym registration payment covers your platform subscription. Create
        your member prices and benefits here.
      </p>
      <QueryState query={plans}>
        {!plans.data?.data.some((p) => p.status === "ACTIVE") && (
          <p role="status">
            No published memberships yet. Add a plan or edit a draft and select
            Active so members can subscribe.
          </p>
        )}
        <div className="live-card-grid">
          {plans.data?.data.map((p) => (
            <article className="panel form-section" key={p.publicId}>
              <span className="chip">
                {p.status === "ACTIVE"
                  ? "Published"
                  : p.status === "DRAFT"
                    ? "Draft ? hidden"
                    : "Inactive ? hidden"}
              </span>
              <h3>{p.name}</h3>
              <p>
                {money(p.priceMinor)} / {p.durationDays} days
              </p>
              {p.benefits?.length > 0 && (
                <ul>
                  {p.benefits.map((b: string) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {canWrite && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setEditing(p)}
                >
                  Edit {p.name}
                </button>
              )}
            </article>
          ))}
        </div>
      </QueryState>
      {published && (
        <Link className="btn btn-secondary" to={`/gyms/${slug}#gym-plans`}>
          Preview member plans
        </Link>
      )}
      <Modal
        open={!!editing}
        title={
          editing?.publicId ? "Edit membership plan" : "Add membership plan"
        }
        onClose={() => setEditing(null)}
      >
        {editing && (
          <>
            <p>
              Choose Active to publish this plan for members. Prices are entered
              in rupees; the final payment includes your configured discounts
              and taxes.
            </p>
            <EditForm
              key={editing.publicId || "new"}
              fields={fields}
              initial={editing}
              endpoint={
                editing.publicId
                  ? `/api/v1/owner/plans/${editing.publicId}`
                  : "/api/v1/owner/plans"
              }
              method={editing.publicId ? "PATCH" : "POST"}
              transform={(body) => ({
                ...body,
                benefits: body.benefits || [],
                discountMinor: body.discountMinor || 0,
                taxRateBasisPoints: body.taxRateBasisPoints || 0,
              })}
              submitLabel={
                editing.publicId
                  ? "Save membership plan"
                  : "Create membership plan"
              }
              onSaved={() => setEditing(null)}
            />
          </>
        )}
      </Modal>
    </section>
  );
}
