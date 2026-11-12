import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { uploadDocumentBytes } from "../../services/documentUpload";
import { GymIdentity } from "../../components/GymIdentity";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import type { Row } from "../live/LiveData";

export function GymLogoEditor({
  gym,
  disabled = false,
  embedded = false,
}: {
  gym: Row;
  disabled?: boolean;
  embedded?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [progress, setProgress] = useState(0);
  const client = useQueryClient(),
    abort = useRef<AbortController | null>(null),
    staged = useRef<Row | null>(null),
    input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => () => abort.current?.abort(), []);
  const save = useMutation({
    mutationFn: async (remove: boolean) => {
      let attachmentId: string | null = null;
      if (!remove) {
        if (!file) throw new Error("Choose a logo to upload.");
        if (
          !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
          !file.size ||
          file.size > 5_000_000
        )
          throw new Error("Choose a JPG, PNG or WebP logo up to 5 MB.");
        if (!staged.current) {
          abort.current = new AbortController();
          const start = await apiRequest<ApiEnvelope<Row>>("/api/v1/uploads", {
            method: "POST",
            body: JSON.stringify({
              name: file.name,
              mimeType: file.type,
              size: file.size,
              purpose: "GYM_LOGO",
            }),
          });
          await uploadDocumentBytes(
            start.data.uploadUrl,
            file,
            setProgress,
            abort.current.signal,
          );
          const completed = await apiRequest<ApiEnvelope<Row>>(
            `/api/v1/uploads/${start.data.attachment.publicId}/complete`,
            { method: "POST", body: "{}" },
          );
          staged.current = completed.data;
        }
        attachmentId = staged.current!._id;
      }
      await apiRequest("/api/v1/owner/gym", {
        method: "PATCH",
        body: JSON.stringify({ logoAttachmentId: attachmentId }),
      });
      staged.current = null;
      setFile(null);
      setProgress(0);
      if (input.current) input.current.value = "";
      await client.invalidateQueries({ queryKey: ["api"] });
      await client.invalidateQueries({ queryKey: ["me"] });
    },
  });
  return (
    <section className={`${embedded ? "" : "panel form-section "}page-stack gym-logo-editor`} id={embedded ? undefined : "gym-logo"}>
      <div className="gym-logo-layout">
        <div className="gym-logo-current" aria-label="Gym logo preview">
          <GymIdentity
            name={gym.name}
            logoUrl={preview || gym.logoUrl}
            subtitle={file ? "Unsaved preview" : gym.logoUrl ? "Current logo" : "No logo uploaded"}
            className="gym-logo-preview"
          />
        </div>
      <fieldset
        disabled={disabled || save.isPending}
        className="profile-fieldset gym-logo-controls"
      >
        <div className="gym-logo-picker">
          <span className="gym-logo-upload-icon" aria-hidden="true"><ImagePlus size={22} /></span>
          <div className="gym-logo-picker-copy"><strong>Upload or replace logo</strong><small>JPG, PNG or WebP · Up to 5 MB<br />Recommended size: 800 × 800 px</small></div>
          <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()}><Upload size={16} aria-hidden="true" />Choose logo</button>
          <input
            ref={input}
            className="sr-only"
            tabIndex={-1}
            aria-label="Upload or replace logo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              setFile(event.target.files?.[0] || null);
              staged.current = null;
              setProgress(0);
              save.reset();
            }}
          />
        </div>
        {file && <div className="gym-logo-selection"><span title={file.name}>{file.name}</span><button type="button" className="btn btn-ghost" onClick={() => { setFile(null); staged.current = null; setProgress(0); save.reset(); if (input.current) input.current.value = ""; }}>Discard</button></div>}
        <div className="heading-actions gym-logo-actions">
          <button
            className="btn btn-primary"
            disabled={!file || save.isPending}
            onClick={() => save.mutate(false)}
          >
            {save.isPending ? "Saving..." : "Save logo"}
          </button>
          <button
            className="btn btn-secondary"
            disabled={!gym.logoUrl || save.isPending}
            onClick={() => save.mutate(true)}
          >
            <Trash2 size={16} aria-hidden="true" />Remove logo
          </button>
        </div>
      </fieldset>
      </div>
      {save.isPending && (
        <progress
          aria-label="Logo upload progress"
          value={progress}
          max={100}
        />
      )}
      {save.isError && <p role="alert">{save.error.message}</p>}
      {save.isSuccess && <p role="status">Gym logo saved.</p>}
    </section>
  );
}
