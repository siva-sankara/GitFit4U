import "../styles/status-badge.css";

const success = new Set([
  "ACTIVE",
  "CAPTURED",
  "PAID",
  "COMPLETED",
  "DELIVERED",
  "VERIFIED",
]);
const warning = new Set([
  "PENDING",
  "PENDING_PAYMENT",
  "TRIAL",
  "TRIALING",
  "EXPIRING",
  "GRACE",
  "DUE",
  "QUEUED",
  "PROCESSING",
  "CREATED",
  "AUTHORIZED",
]);
const danger = new Set([
  "INACTIVE",
  "EXPIRED",
  "FAILED",
  "CANCELLED",
  "SUSPENDED",
  "REJECTED",
]);

export function StatusBadge({ status }: { status?: string | null }) {
  const normalized =
    status?.trim().toUpperCase().replace(/[ -]/g, "_") || "UNKNOWN";
  const tone = success.has(normalized)
    ? "success"
    : warning.has(normalized)
      ? "warning"
      : danger.has(normalized)
        ? "danger"
        : "neutral";
  const text = normalized
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (letter) => letter.toUpperCase());
  return (
    <span className={`status-badge status-badge--${tone}`}>
      <span aria-hidden="true" />
      {text}
    </span>
  );
}
