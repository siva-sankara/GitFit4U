import { useEffect, useState } from "react";
export function GymIdentity({
  name,
  logoUrl,
  subtitle,
  className = "",
}: {
  name: string;
  logoUrl?: string;
  subtitle?: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [logoUrl]);
  return (
    <span className={`gym-identity ${className}`}>
      <span className={`gym-identity-logo${logoUrl && !failed ? " has-image" : ""}`}>
        {logoUrl && !failed ? (
          <img
            src={logoUrl}
            alt={`${name} logo`}
            onError={() => setFailed(true)}
          />
        ) : (
          <span aria-hidden="true">
            {name
              .split(/\s+/)
              .slice(0, 2)
              .map((word) => word[0])
              .join("")
              .toUpperCase()}
          </span>
        )}
      </span>
      <span className="gym-identity-copy">
        <strong title={name}>{name}</strong>
        {subtitle && <small>{subtitle}</small>}
      </span>
    </span>
  );
}
