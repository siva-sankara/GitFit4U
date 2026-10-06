import {
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";

export function PageSizeSelector({
  value,
  onChange,
  disabled = false,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className="page-size-selector">
      <span>Rows</span>
      <select
        className="select"
        aria-label="Rows per page"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        {[10, 25, 50].map((size) => (
          <option key={size} value={size}>{size}</option>
        ))}
      </select>
    </label>
  );
}

export function Pagination({
  page,
  limit,
  total,
  onPageChange,
  onLimitChange,
  loading = false,
}: {
  page: number;
  limit: number;
  total: number;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  loading?: boolean;
}) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const safePage = Math.min(page, totalPages);
  const start = total ? (safePage - 1) * limit + 1 : 0;
  const end = Math.min(total, safePage * limit);
  const pages = useMemo(() => {
    const first = Math.max(1, Math.min(totalPages - 4, safePage - 2));
    return Array.from({ length: Math.min(5, totalPages) }, (_, index) => first + index);
  }, [safePage, totalPages]);
  return (
    <nav className="data-pagination" aria-label="Pagination">
      <span className="pagination-summary">Showing {start}–{end} of {total}</span>
      {onLimitChange && (
        <PageSizeSelector
          value={limit}
          disabled={loading}
          onChange={onLimitChange}
        />
      )}
      <div className="pagination-buttons">
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading || safePage <= 1}
          onClick={() => onPageChange(safePage - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={17} aria-hidden="true" />
          <span>Previous</span>
        </button>
        <span className="pagination-compact">Page {safePage} of {totalPages}</span>
        <div className="pagination-pages" aria-label={`Page ${safePage} of ${totalPages}`}>
          {pages.map((item) => (
            <button
              type="button"
              key={item}
              disabled={loading}
              className={item === safePage ? "is-current" : ""}
              aria-current={item === safePage ? "page" : undefined}
              aria-label={`Page ${item}`}
              onClick={() => onPageChange(item)}
            >
              {item}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={loading || safePage >= totalPages}
          onClick={() => onPageChange(safePage + 1)}
          aria-label="Next page"
        >
          <span>Next</span>
          <ChevronRight size={17} aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

export function EmptyState({
  title = "No records found",
  detail,
  action,
}: {
  title?: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {action}
    </div>
  );
}

export function SkeletonTableRows({ rows = 6, columns = 5 }: { rows?: number; columns?: number }) {
  return (
    <div className="skeleton-table" role="status" aria-label="Loading records">
      {Array.from({ length: rows }, (_, row) => (
        <div
          className="skeleton-table-row"
          key={row}
          style={{ gridTemplateColumns: `repeat(${columns}, minmax(80px, 1fr))` }}
        >
          {Array.from({ length: columns }, (_, column) => (
            <span key={column} className="skeleton-line" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BulkActionBar({
  count,
  onClear,
  children,
}: {
  count: number;
  onClear: () => void;
  children: ReactNode;
}) {
  if (!count) return null;
  return (
    <aside className="bulk-action-bar" aria-label="Bulk member actions">
      <strong>{count} selected</strong>
      <div className="bulk-action-items">{children}</div>
      <button type="button" className="btn btn-ghost" onClick={onClear}>
        <X size={17} aria-hidden="true" /> Clear selection
      </button>
    </aside>
  );
}

export function TooltipButton({
  tooltip,
  icon: Icon,
  children,
  className = "btn btn-secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tooltip: string;
  icon?: LucideIcon;
}) {
  return (
    <button
      {...props}
      type={props.type || "button"}
      className={`${className} tooltip-button`}
      title={tooltip}
      aria-label={props["aria-label"] || tooltip}
      data-tooltip={tooltip}
    >
      {Icon && <Icon size={17} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function ResponsiveActionButtons({ children }: { children: ReactNode }) {
  return <div className="responsive-action-buttons">{children}</div>;
}

export function SectionAccordion({
  title,
  description,
  defaultOpen = false,
  actions,
  children,
  id,
}: {
  title: string;
  description?: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  const generated = useId();
  const regionId = `${id || generated}-content`;
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section id={id} className={`panel section-accordion${open ? " is-open" : ""}`}>
      <header className="section-accordion-header">
        <button
          type="button"
          className="section-accordion-toggle"
          aria-expanded={open}
          aria-controls={regionId}
          onClick={() => setOpen((value) => !value)}
        >
          <span>
            <strong>{title}</strong>
            {description && <small>{description}</small>}
          </span>
          <ChevronsUpDown size={18} aria-hidden="true" />
        </button>
        {actions && <div className="section-accordion-actions">{actions}</div>}
      </header>
      <div id={regionId} className="section-accordion-content" hidden={!open}>
        {children}
      </div>
    </section>
  );
}
