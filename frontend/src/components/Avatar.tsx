import { useState } from "react";
import "../styles/avatar.css";
export function Avatar({
  user,
  name,
  src,
  thumbnailSrc,
  size = 32,
  className = "",
}: {
  user?: {
    name?: string;
    avatarUrl?: string;
    avatarThumbnailUrl?: string;
  } | null;
  name?: string;
  src?: string;
  thumbnailSrc?: string;
  size?: number;
  className?: string;
}) {
  const label = name || user?.name || "Member";
  const image =
    size <= 64
      ? thumbnailSrc || user?.avatarThumbnailUrl || src || user?.avatarUrl
      : src || user?.avatarUrl || thumbnailSrc || user?.avatarThumbnailUrl;
  const [failed, setFailed] = useState<string>();
  return (
    <span
      className={`avatar ${className}`}
      style={{ width: size, height: size, fontSize: Math.max(11, size * 0.34) }}
      role="img"
      aria-label={`${label}'s profile photo`}
    >
      {image && failed !== image ? (
        <img
          src={image}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(image)}
        />
      ) : (
        label
          .trim()
          .split(/\s+/)
          .slice(0, 2)
          .map((part) => part[0])
          .join("")
          .toUpperCase()
      )}
    </span>
  );
}
