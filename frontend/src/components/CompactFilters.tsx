import { useEffect, useId, useState, type ReactNode } from "react";
import { SlidersHorizontal } from "lucide-react";
import "../styles/compact-layout.css";

/** Desktop controls stay visible; small screens use a keyboard-accessible disclosure. */
export function CompactFilters({ children, activeCount = 0, onReset, onApply }: {
  children: ReactNode;
  activeCount?: number;
  onReset: () => void;
  onApply?: () => boolean | void;
}) {
  const [narrow, setNarrow] = useState(() => window.matchMedia?.("(max-width: 680px)").matches ?? false);
  const [open, setOpen] = useState(false);
  const id = useId();
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 680px)");
    if (!media) return;
    const changed = () => setNarrow(media.matches);
    changed();
    media.addEventListener?.("change", changed);
    return () => media.removeEventListener?.("change", changed);
  }, []);
  return <div className="compact-filters">
    {narrow && <button type="button" className="btn btn-secondary compact-filter-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}>
      <SlidersHorizontal size={18} aria-hidden="true" />Filters{activeCount > 0 && <span className="filter-count" aria-label={`${activeCount} active filters`}>{activeCount}</span>}
    </button>}
    <div id={id} className="compact-filter-content" hidden={narrow && !open}>
      <div className="compact-filter-fields">{children}</div>
      <div className="compact-filter-actions">
        <button type="button" className="btn btn-ghost" onClick={onReset}>Reset filters</button>
        {narrow && <button type="button" className="btn btn-primary" onClick={event => {
          if (event.currentTarget.form && !event.currentTarget.form.reportValidity()) return;
          if (onApply?.() !== false) setOpen(false);
        }}>Apply filters</button>}
      </div>
    </div>
  </div>;
}
