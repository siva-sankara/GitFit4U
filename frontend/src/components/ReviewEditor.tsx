import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "../services/apiClient";
import { MediaImageEditor } from "./MediaImageEditor";
import "../styles/reviews.css";
type Review = {
  publicId?: string;
  rating?: number;
  title?: string;
  body?: string;
  images?: { id: string; url: string; thumbnailUrl?: string }[];
  photoUrls?: string[];
};
export function ReviewEditor({
  gymId,
  initial = {},
  onSaved,
  onBusyChange,
}: {
  gymId: string;
  initial?: Review;
  onSaved: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [images, setImages] = useState(initial.images || []);
  const [removeLegacy, setRemoveLegacy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const save = useMutation({
    mutationFn: (body: object) =>
      apiRequest(
        initial.publicId
          ? `/api/v1/users/me/reviews/${initial.publicId}`
          : "/api/v1/users/me/reviews",
        {
          method: initial.publicId ? "PATCH" : "POST",
          body: JSON.stringify(body),
        },
      ),
    onSuccess: onSaved,
  });
  useEffect(() => {
    onBusyChange?.(uploading || save.isPending);
  }, [uploading, save.isPending, onBusyChange]);
  return (
    <form
      className="modal-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (uploading || save.isPending) return;
        const data = new FormData(event.currentTarget);
        save.mutate({
          ...(!initial.publicId ? { gymId } : {}),
          rating: Number(data.get("rating")),
          title: String(data.get("title") || "").trim(),
          body: String(data.get("body") || "").trim(),
          attachmentIds: images.map((image) => image.id),
          removeLegacyPhotos: removeLegacy,
        });
      }}
    >
      <label>
        Rating (1–5)
        <input
          className="input"
          name="rating"
          type="number"
          min={1}
          max={5}
          required
          defaultValue={initial.rating || 5}
        />
      </label>
      <label>
        Title
        <input
          className="input"
          name="title"
          maxLength={160}
          defaultValue={initial.title || ""}
        />
      </label>
      <label>
        Your review
        <textarea
          className="input"
          name="body"
          maxLength={3000}
          required
          defaultValue={initial.body || ""}
        />
      </label>
      <div className="review-photo-grid">
        {images.map((image, index) => (
          <figure key={image.id}>
            <img
              src={image.thumbnailUrl || image.url}
              width={96}
              height={96}
              style={{ objectFit: "cover" }}
              alt={`Review photo ${index + 1}`}
            />
            <button
              type="button"
              disabled={save.isPending || uploading}
              onClick={() =>
                setImages((current) =>
                  current.filter((item) => item.id !== image.id),
                )
              }
            >
              Remove photo {index + 1}
            </button>
          </figure>
        ))}
      </div>
      <div hidden={images.length >= 8}>
        <MediaImageEditor
          purpose="REVIEW"
          label="Add review photo"
          disabled={save.isPending || images.length >= 8}
          onBusyChange={setUploading}
          onChange={(id, url) => {
            if (id && url)
              setImages((current) =>
                [
                  ...current.filter((item) => item.id !== id),
                  { id, url },
                ].slice(0, 8),
              );
          }}
        />
      </div>
      {!!initial.photoUrls?.length && (
        <label>
          <input
            type="checkbox"
            checked={removeLegacy}
            onChange={(event) => setRemoveLegacy(event.target.checked)}
          />
          Remove {initial.photoUrls.length} legacy review photo(s). New photos
          are uploaded securely to S3.
        </label>
      )}
      {save.error && <p role="alert">{save.error.message}</p>}
      <button
        className="btn btn-primary"
        disabled={save.isPending || uploading}
      >
        {save.isPending ? "Saving…" : "Save review"}
      </button>
    </form>
  );
}
