import { Link } from "react-router-dom";

export function Brand({
  compact = false,
  to = "/",
}: {
  compact?: boolean;
  to?: string;
}) {
  return (
    <Link className="brand" to={to} aria-label="GETFIT4U home">
      <span className="brand-mark" aria-hidden="true">
        <img src="/brand/favicon.svg" alt="" />
      </span>
      {!compact && (
        <span>
          GETFIT<span>4U</span>
        </span>
      )}
    </Link>
  );
}
