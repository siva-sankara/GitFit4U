import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "../styles/dialog.css";

const stack: HTMLElement[] = [];
let originalOverflow = "";
const focusable =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function Modal({
  open,
  title,
  children,
  onClose,
  wide = false,
  className = "",
  footer,
  externalOverlayActive = false,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
  className?: string;
  footer?: ReactNode;
  /** A child-owned gateway dialog temporarily owns focus and dismissal. */
  externalOverlayActive?: boolean;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const externalOverlay = useRef(externalOverlayActive);
  externalOverlay.current = externalOverlayActive;
  useEffect(() => {
    if (!open || !panel.current) return;
    const dialog = panel.current;
    const previous = document.activeElement as HTMLElement | null;
    if (!stack.length) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }
    stack.push(dialog);
    const elements = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).filter(
        (element) => !element.closest('[hidden],[inert],[aria-hidden="true"]'),
      );
    (
      dialog.querySelector<HTMLElement>("[autofocus]") ||
      elements()[0] ||
      dialog
    ).focus();
    const keydown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== dialog || externalOverlay.current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const items = elements(),
        first = items[0],
        last = items.at(-1);
      if (!first) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      if (
        event.shiftKey &&
        (document.activeElement === first || document.activeElement === dialog)
      ) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const focusin = (event: FocusEvent) => {
      if (!externalOverlay.current && stack.at(-1) === dialog && !dialog.contains(event.target as Node))
        (elements()[0] || dialog).focus();
    };
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
      const index = stack.indexOf(dialog);
      if (index >= 0) stack.splice(index, 1);
      if (!stack.length) document.body.style.overflow = originalOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
  useEffect(() => {
    const dialog = panel.current;
    if (open && !externalOverlayActive && dialog && stack.at(-1) === dialog && !dialog.contains(document.activeElement)) {
      const first = Array.from(dialog.querySelectorAll<HTMLElement>(focusable)).find(
        (element) => !element.closest('[hidden],[inert],[aria-hidden="true"]'),
      );
      (first || dialog).focus();
    }
  }, [open, externalOverlayActive]);
  if (!open) return null;
  return createPortal(
    <div
      className={`modal-backdrop modal-layer ${className}`}
      role="presentation"
      onMouseDown={event => event.stopPropagation()}
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); }}
      onClick={(event) => {
        event.stopPropagation();
        if (
          event.target === event.currentTarget &&
          !externalOverlayActive &&
          stack.at(-1) === panel.current
        )
          onClose();
      }}
    >
      <section
        ref={panel}
        className={`modal-panel${wide ? " modal-wide" : ""}`}
        role="dialog"
        aria-modal={externalOverlayActive ? undefined : true}
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="icon-btn"
            onClick={onClose}
            disabled={externalOverlayActive}
            aria-label="Close dialog"
          >
            <X size={19} />
          </button>
        </header>
        <div className="modal-content">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </section>
    </div>,
    document.body,
  );
}
