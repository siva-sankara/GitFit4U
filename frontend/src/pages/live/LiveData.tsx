import { useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import { LocationPicker } from "../../components/LocationPicker";
import { validCoordinates } from "../../services/location";
import { StatusBadge } from "../../components/StatusBadge";
export type Row = Record<string, any>;
export const read = (row: Row, path: string): any =>
  path.split(".").reduce((value, key) => value?.[key], row);
export const money = (value: unknown) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    Number(value || 0) / 100,
  );
export const date = (value: unknown) =>
  value && !Number.isNaN(new Date(String(value)).getTime())
    ? new Date(String(value)).toLocaleString()
    : "—";
export const label = (value: string) =>
  value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .replace(/^./, (v) => v.toUpperCase());
export function useData<T = any>(path: string, enabled = true) {
  return useQuery({
    queryKey: ["api", path],
    queryFn: () => apiRequest<ApiEnvelope<T>>(path),
    enabled,
  });
}
export function QueryState({
  query,
  children,
}: {
  query: any;
  children: ReactNode;
}) {
  if (query.isPending)
    return (
      <div className="state-card panel" role="status">
        Loading…
      </div>
    );
  if (query.isError)
    return (
      <div className="state-card panel">
        <p role="alert">{query.error.message}</p>
        <button className="btn btn-secondary" onClick={() => query.refetch()}>
          Retry
        </button>
      </div>
    );
  return <>{children}</>;
}
export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "email"
    | "number"
    | "money"
    | "date"
    | "datetime-local"
    | "textarea"
    | "lines"
    | "select"
    | "checkbox";
  required?: boolean;
  min?: number;
  max?: number;
  options?: string[];
  source?: string;
  optionValue?: string;
  createOnly?: boolean;
};
function set(object: Row, path: string, value: any) {
  const parts = path.split(".");
  const last = parts.pop()!;
  const parent = parts.reduce((value, key) => (value[key] ||= {}), object);
  parent[last] = value;
}
function RecordSelect({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (value: string) => void;
}) {
  const query = useData<Row[]>(field.source!, true);
  return (
    <>
      <select
        className="select"
        value={value}
        required={field.required}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">Select…</option>
        {query.data?.data.map((row) => (
          <option key={row._id} value={row[field.optionValue || "_id"]}>
            {row.name || row.userId?.name || row.memberCode}
          </option>
        ))}
      </select>
      {query.isError && <small role="alert">{query.error.message}</small>}
    </>
  );
}
export function EditForm({
  fields,
  initial = {},
  endpoint,
  method = "POST",
  onSaved,
  transform,
  submitLabel = "Save",
  onDirty,
  locationPicker = false,
}: {
  fields: Field[];
  initial?: Row;
  endpoint: string;
  method?: string;
  onSaved?: (data?: any) => void;
  onDirty?: () => void;
  locationPicker?: boolean;
  transform?: (body: Row) => Row;
  submitLabel?: string;
}) {
  const client = useQueryClient();
  const requestAttempt = useRef<{ signature: string; key: string } | null>(
    null,
  );
  const [values, setValues] = useState<Row>(() =>
    Object.fromEntries(
      fields.map((f) => {
        let value = read(initial, f.key);
        if (f.source && value && typeof value === "object")
          value = value[f.optionValue || "_id"];
        if (f.type === "money" && value != null) value = value / 100;
        if (f.type === "lines" && Array.isArray(value))
          value = value.join("\n");
        if (f.type === "date" && value) value = String(value).slice(0, 10);
        if (f.type === "datetime-local" && value) {
          const d = new Date(value);
          value = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
            .toISOString()
            .slice(0, 16);
        }
        return [f.key, value ?? (f.type === "checkbox" ? false : "")];
      }),
    ),
  );
  const selectedPoint = {
    latitude: values.latitude === "" ? undefined : Number(values.latitude),
    longitude: values.longitude === "" ? undefined : Number(values.longitude),
  };
  const save = useMutation({
    mutationFn: (body: Row) => {
      const serialized = JSON.stringify(transform ? transform(body) : body);
      const signature = `${method}:${endpoint}:${serialized}`;
      if (requestAttempt.current?.signature !== signature)
        requestAttempt.current = { signature, key: crypto.randomUUID() };
      return apiRequest(endpoint, {
        method,
        body: serialized,
        idempotencyKey: requestAttempt.current.key,
      });
    },
    onSuccess: async (response) => {
      requestAttempt.current = null;
      await client.invalidateQueries();
      onSaved?.(response);
    },
  });
  return (
    <form
      className="modal-form"
      onChange={onDirty}
      onSubmit={(e) => {
        e.preventDefault();
        if (locationPicker && !validCoordinates(selectedPoint)) return;
        const body: Row = {};
        for (const f of fields) {
          let value = values[f.key];
          if (value === "" && !f.required) continue;
          if (["number", "money"].includes(f.type || ""))
            value = Number(value) * (f.type === "money" ? 100 : 1);
          if (f.type === "money") value = Math.round(value);
          if (f.type === "lines")
            value = String(value)
              .split("\n")
              .map((v) => v.trim())
              .filter(Boolean);
          if (f.type === "datetime-local")
            value = new Date(value).toISOString();
          set(body, f.key, value);
        }
        save.mutate(body);
      }}
    >
      <div className="form-grid">
        {fields
          .filter(
            (f) =>
              !locationPicker || !["latitude", "longitude"].includes(f.key),
          )
          .map((f) => (
            <label
              className={`field ${["textarea", "lines"].includes(f.type || "") ? "full" : ""}`}
              key={f.key}
            >
              <span>
                {f.label}
                {f.required ? " *" : ""}
              </span>
              {f.source ? (
                <RecordSelect
                  field={f}
                  value={values[f.key]}
                  onChange={(value) => setValues({ ...values, [f.key]: value })}
                />
              ) : f.type === "select" ? (
                <select
                  className="select"
                  required={f.required}
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.value })
                  }
                >
                  <option value="">Select…</option>
                  {f.options?.map((v) => (
                    <option key={v} value={v}>
                      {label(v)}
                    </option>
                  ))}
                </select>
              ) : ["textarea", "lines"].includes(f.type || "") ? (
                <textarea
                  className="textarea"
                  maxLength={5000}
                  required={f.required}
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.value })
                  }
                />
              ) : f.type === "checkbox" ? (
                <input
                  type="checkbox"
                  checked={values[f.key]}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.checked })
                  }
                />
              ) : (
                <input
                  className="input"
                  type={f.type === "money" ? "number" : f.type || "text"}
                  step={
                    f.type === "money" || f.type === "number"
                      ? "any"
                      : undefined
                  }
                  min={f.min}
                  max={f.max}
                  required={f.required}
                  value={values[f.key]}
                  onChange={(e) =>
                    setValues({ ...values, [f.key]: e.target.value })
                  }
                />
              )}
            </label>
          ))}
      </div>
      {locationPicker && (
        <LocationPicker
          value={validCoordinates(selectedPoint) ? selectedPoint : undefined}
          addressQuery={[
            values["address.line1"],
            values["address.locality"],
            values["address.city"],
            values["address.state"],
            values["address.postalCode"],
          ]
            .filter(Boolean)
            .join(", ")}
          onChange={(point) => {
            setValues((previous) => {
              const next: Row = {
                ...previous,
                latitude: point.latitude,
                longitude: point.longitude,
              };
              for (const [key, value] of Object.entries(point.address || {})) {
                const fieldKey = `address.${key}`;
                if (fields.some((f) => f.key === fieldKey))
                  next[fieldKey] = value;
              }
              return next;
            });
            onDirty?.();
          }}
        />
      )}
      {save.isError && (
        <p className="form-alert" role="alert">
          {save.error.message}
        </p>
      )}
      {save.isSuccess && <p role="status">Saved successfully.</p>}
      <button
        className="btn btn-primary"
        disabled={
          save.isPending || (locationPicker && !validCoordinates(selectedPoint))
        }
      >
        {save.isPending ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}
export type Column = {
  key: string;
  title: string;
  format?: "money" | "date" | "status";
  link?: (row: Row) => string;
};
export function display(row: Row, c: Column) {
  const v = read(row, c.key);
  if (c.format === "money") return v == null ? "—" : money(v);
  if (c.format === "date") return date(v);
  if (c.format === "status") return label(String(v ?? "Unknown"));
  if (Array.isArray(v))
    return (
      v
        .map((x) => (typeof x === "object" ? x.name || x.description || "" : x))
        .join(", ") || "—"
    );
  return typeof v === "object"
    ? v?.name || v?.publicId || "—"
    : String(v ?? "—");
}
export function Table({
  rows,
  columns,
  actions,
}: {
  rows: Row[];
  columns: Column[];
  actions?: (row: Row) => ReactNode;
}) {
  return rows.length ? (
    <div
      className="responsive-table"
      tabIndex={0}
      role="region"
      aria-label="Records table"
    >
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.title}</th>
            ))}
            {actions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row._id || row.publicId || row.code}>
              {columns.map((c) => (
                <td key={c.key}>
                  {c.link ? (
                    <Link to={c.link(row)}>{display(row, c)}</Link>
                  ) : c.format === "status" ? (
                    <StatusBadge status={read(row, c.key)} />
                  ) : (
                    display(row, c)
                  )}
                </td>
              ))}
              {actions && (
                <td>
                  <div className="heading-actions">{actions(row)}</div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="state-card">No records match this view.</div>
  );
}
export function Action({
  path,
  body = {},
  method = "POST",
  children,
  onDone,
  confirmMessage,
}: {
  path: string;
  body?: Row;
  method?: string;
  children: ReactNode;
  onDone?: () => void;
  confirmMessage?: string;
}) {
  const client = useQueryClient();
  const action = useMutation({
    mutationFn: () =>
      apiRequest(path, {
        method,
        body: method === "DELETE" ? undefined : JSON.stringify(body),
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      await client.invalidateQueries();
      onDone?.();
    },
  });
  return (
    <span>
      <button
        className="btn btn-secondary"
        disabled={action.isPending}
        onClick={() => {
          if (!confirmMessage || window.confirm(confirmMessage))
            action.mutate();
        }}
      >
        {action.isPending ? "Working…" : children}
      </button>
      {action.isError && (
        <small className="form-alert" role="alert">
          {action.error.message}
        </small>
      )}
    </span>
  );
}
export function ResourcePage({
  title,
  resource,
  columns,
  fields,
  createPath,
  updatePath,
  statuses,
  actions,
  transform,
}: {
  title: string;
  resource: string;
  columns: Column[];
  fields?: Field[];
  createPath?: string;
  updatePath?: (row: Row) => string;
  statuses?: string[];
  actions?: (row: Row) => ReactNode;
  transform?: (body: Row) => Row;
}) {
  const [page, setPage] = useState(1),
    [q, setQ] = useState(""),
    [search, setSearch] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [status, setStatus] = useState(""),
    [editing, setEditing] = useState<Row | null>(null),
    [adding, setAdding] = useState(false);
  const query = useData<Row[]>(
    `/api/v1/workspace/records/${resource}?${new URLSearchParams({ page: String(page), q: search, status, ...(from ? { from } : {}), ...(to ? { to } : {}) })}`,
  );
  const rows = query.data?.data || [],
    meta = query.data?.meta;
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Workspace</span>
          <h1>{title}</h1>
          <p>{meta?.total ?? 0} records</p>
        </div>
        {createPath && fields && (
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            Create {title.toLowerCase().replace(/s$/, "")}
          </button>
        )}
      </header>
      <section className="panel">
        <form
          className="table-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setSearch(q);
          }}
        >
          <label className="search-field">
            <span className="sr-only">Search</span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search records"
            />
          </label>
          <button className="btn btn-secondary">Search</button>
          {columns.some((c) => c.format === "date") && (
            <>
              <label>
                From{" "}
                <input
                  className="input"
                  type="date"
                  aria-label="From date"
                  value={from}
                  max={to || undefined}
                  onChange={(e) => {
                    setFrom(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                To{" "}
                <input
                  className="input"
                  type="date"
                  aria-label="To date"
                  value={to}
                  min={from || undefined}
                  onChange={(e) => {
                    setTo(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </>
          )}
          {statuses && (
            <select
              className="select"
              aria-label="Status"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All statuses</option>
              {statuses.map((v) => (
                <option key={v} value={v}>
                  {label(v)}
                </option>
              ))}
            </select>
          )}
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => {
              const csv = [
                columns.map((c) => c.title),
                ...rows.map((row) => columns.map((c) => display(row, c))),
              ]
                .map((cells) =>
                  cells
                    .map(
                      (value) =>
                        '"' +
                        String(value)
                          .replace(/^[=+@-]/, "'$&")
                          .replace(/"/g, '""') +
                        '"',
                    )
                    .join(","),
                )
                .join("\r\n");
              const url = URL.createObjectURL(
                new Blob([csv], { type: "text/csv;charset=utf-8" }),
              );
              const a = document.createElement("a");
              a.href = url;
              a.download = `${resource}-page-${page}.csv`;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download
          </button>
        </form>
        <QueryState query={query}>
          <Table
            rows={rows}
            columns={columns}
            actions={
              updatePath || actions
                ? (row) => (
                    <>
                      {updatePath && (
                        <button
                          className="btn btn-secondary"
                          onClick={() => setEditing(row)}
                        >
                          Edit
                        </button>
                      )}
                      {actions?.(row)}
                    </>
                  )
                : undefined
            }
          />
          <footer className="table-footer">
            <span>
              Page {page} of {meta?.pages || 1} · {meta?.total || 0} records
            </span>
            <div>
              <button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous
              </button>
              <button
                disabled={page >= (meta?.pages || 1)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          </footer>
        </QueryState>
      </section>
      <Modal
        open={adding || !!editing}
        title={`${editing ? "Edit" : "Create"} ${title.toLowerCase()}`}
        onClose={() => {
          setEditing(null);
          setAdding(false);
        }}
      >
        {fields && (adding || editing) && (
          <EditForm
            key={editing?._id || "new"}
            fields={
              editing ? fields.filter((field) => !field.createOnly) : fields
            }
            initial={editing || {}}
            endpoint={editing ? updatePath!(editing) : createPath!}
            method={editing ? "PATCH" : "POST"}
            transform={transform}
            onSaved={() => {
              setEditing(null);
              setAdding(false);
            }}
          />
        )}
      </Modal>
    </div>
  );
}
