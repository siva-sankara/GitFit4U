import { useEffect, useState } from "react";
import { ProfilePhotoViewer } from "./ProfilePhotoViewer";
import "../styles/avatar.css";
export function Avatar({
  user,
  name,
  src,
  thumbnailSrc,
  size = 32,
  className = "",
  variant = "compact",
  interactive = true,
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
  variant?: "compact" | "profile";
  interactive?: boolean;
}) {
  const label = name || user?.name || "Member";
  const image =
    size <= 64 && variant !== "profile"
      ? thumbnailSrc || user?.avatarThumbnailUrl || src || user?.avatarUrl
      : src || user?.avatarUrl || thumbnailSrc || user?.avatarThumbnailUrl;
  const [failed, setFailed] = useState<string>();
  const fullImage = src || user?.avatarUrl || image;
  const [openedImage, setOpenedImage] = useState<string>();
  useEffect(() => {
    const close = (event: Event) => { if ((event as CustomEvent).detail?.changedSession) setOpenedImage(undefined); };
    window.addEventListener("gfu-auth", close);
    return () => window.removeEventListener("gfu-auth", close);
  }, []);
  const viewable = Boolean(interactive && image && failed !== image);
  const Element = viewable ? "button" : "span";
  return (
    <><Element
      className={`avatar ${variant === "profile" ? "avatar-profile" : ""} ${className}`}
      style={variant === "profile" ? undefined : { width: `${size / 16}rem`, height: `${size / 16}rem`, fontSize: `${Math.max(11, size * 0.34) / 16}rem` }}
      type={viewable ? "button" : undefined}
      role={viewable ? undefined : "img"}
      aria-label={`${viewable ? "View " : ""}${label}'s profile photo`}
      aria-haspopup={viewable ? "dialog" : undefined}
      onDoubleClick={viewable ? event => event.stopPropagation() : undefined}
      onKeyDown={viewable ? event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); } : undefined}
      onClick={viewable ? event => { event.preventDefault(); event.stopPropagation(); event.currentTarget.focus(); setOpenedImage(fullImage); } : undefined}
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
    </Element>
    {openedImage && openedImage === fullImage && viewable && <ProfilePhotoViewer key={openedImage} src={openedImage} name={label} onClose={() => setOpenedImage(undefined)} />}
    </>
  );
}
