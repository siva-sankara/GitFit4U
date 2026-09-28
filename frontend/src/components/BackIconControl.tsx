import { ArrowLeft } from "lucide-react";
import type { ButtonHTMLAttributes } from "react";
import { Link, type LinkProps } from "react-router-dom";

type LabelledControl = {
  label: string;
  className?: string;
};

const classes = (className = "") =>
  `icon-btn back-icon-control ${className}`.trim();

/** A consistent icon-only back link. The accessible name and tooltip stay textual. */
export function BackIconLink({
  label,
  className,
  ...props
}: LabelledControl & Omit<LinkProps, "children" | "aria-label" | "title">) {
  return (
    <Link
      {...props}
      className={classes(className)}
      aria-label={label}
      title={label}
    >
      <ArrowLeft size={20} aria-hidden="true" />
    </Link>
  );
}

/** A consistent icon-only back button for guarded/custom navigation. */
export function BackIconButton({
  label,
  className,
  type = "button",
  ...props
}: LabelledControl &
  Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "children" | "aria-label" | "title"
  >) {
  return (
    <button
      {...props}
      type={type}
      className={classes(className)}
      aria-label={label}
      title={label}
    >
      <ArrowLeft size={20} aria-hidden="true" />
    </button>
  );
}
