import { useState } from "react";
import { Modal } from "./Modal";

export function ProfilePhotoViewer({ src, name, onClose }: { src: string; name: string; onClose: () => void }) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  return <Modal open title={`${name}'s profile photo`} onClose={onClose} className="profile-photo-viewer" wide>
    <div className="profile-photo-stage" onClick={event => { event.stopPropagation(); onClose(); }}>
      {status === "loading" && <p role="status">Loading photo…</p>}
      {status === "error" ? <p role="alert">This photo is unavailable. Close the viewer and refresh the profile to try again.</p> :
        <button type="button" className="profile-photo-image" aria-label="Close photo" onClick={event => { event.stopPropagation(); onClose(); }}>
          <img src={src} alt={`${name}'s profile photo`} referrerPolicy="no-referrer" decoding="async" onLoad={() => setStatus("ready")} onError={() => setStatus("error")} />
        </button>}
    </div>
  </Modal>;
}
