import { useEffect, useRef, type ReactNode } from "react";
import "../styles/list-viewport.css";

/** Keep filters and pagination outside this region so long lists stay usable. */
export function ListViewport({ children, label, className = "", resetKey }: {
  children: ReactNode;
  label: string;
  className?: string;
  resetKey?: string | number;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 0;
  }, [resetKey]);
  return <div ref={viewport} className={`list-viewport ${className}`} role="region" aria-label={label} tabIndex={0}>
    {children}
  </div>;
}

export function OverflowText({ children, className = "" }: { children: string | number; className?: string }) {
  return <span className={`overflow-text ${className}`} title={String(children)}>{children}</span>;
}
