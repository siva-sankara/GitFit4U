import { useEffect, useRef, useState } from "react";
import { uploadMedia } from "../services/mediaUpload";
export function MediaImageEditor({
  purpose,
  previewUrl,
  onChange,
  onBusyChange,
  label = "Image",
  gymId,
  disabled = false,
}: {
  purpose: "AVATAR" | "TRAINER_IMAGE" | "POST_IMAGE" | "STORY_IMAGE" | "MEMBER_AVATAR" | "REVIEW" | "AD";
  previewUrl?: string;
  onChange: (id: string | null, url?: string) => void;
  onBusyChange?: (busy: boolean) => void;
  label?: string;
  gymId?: string;
  disabled?: boolean;
}) {
  const [file, setFile] = useState<File>(),
    [preview, setPreview] = useState(""),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(0),
    [busy, setBusy] = useState(false);
  const upload = useRef<AbortController | null>(null);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => upload.current?.abort(), []);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  async function save(selected: File) {
    if (disabled) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(selected.type) ||
      !selected.size ||
      selected.size > 5_000_000
    ) {
      setError("Choose a JPG, PNG or WebP image up to 5 MB.");
      return;
    }
    upload.current?.abort();
    const controller = new AbortController();
    upload.current = controller;
    setFile(selected);
    setBusy(true);
    setError("");
    setProgress(0);
    try {
      const result = await uploadMedia(
        selected,
        purpose,
        setProgress,
        controller.signal,
        { gymId },
      );
      if (!controller.signal.aborted) {
        onChange(result._id, result.url);
        setFile(undefined);
      }
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "Image upload failed.");
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="media-image-editor">
      {(preview || previewUrl) && (
        <img
          src={preview || previewUrl}
          alt={`${label} preview`}
          width={96}
          height={96}
          style={{ objectFit: "cover", borderRadius: 16 }}
        />
      )}
      <label>
        {label}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={busy || disabled}
          onChange={(event) => {
            const selected = event.target.files?.[0];
            if (selected) void save(selected);
            event.target.value = "";
          }}
        />
      </label>
      <small>JPG, PNG or WebP · up to 5 MB · securely stored in S3</small>
      {busy && <p role="status">Uploading {progress}%…</p>}
      {error && (
        <p role="alert">
          {error}{" "}
          {file && (
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => void save(file)}
            >
              Retry upload
            </button>
          )}
        </p>
      )}
      {previewUrl && (
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy || disabled}
          onClick={() => {
            setFile(undefined);
            setError("");
            onChange(null);
          }}
        >
          Remove image
        </button>
      )}
    </div>
  );
}
