import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "../../services/apiClient";

export function GymTermsEditor({
  terms,
  disabled = false,
}: {
  terms?: { text?: string; updatedAt?: string };
  disabled?: boolean;
}) {
  const [text, setText] = useState(terms?.text || "");
  const [editing, setEditing] = useState(false);
  const client = useQueryClient();
  const save = useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/owner/gym/terms", {
        method: "PATCH",
        body: JSON.stringify({ text }),
      }),
    onSuccess: async () => {
      setEditing(false);
      await client.invalidateQueries({ queryKey: ["api"] });
    },
  });
  return (
    <section id="gym-terms" className="panel form-section page-stack">
      <div className="heading-actions">
        <h2>Terms &amp; Conditions</h2>
        {!editing && !disabled && (
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              setText(terms?.text || "");
              setEditing(true);
            }}
          >
            Edit terms
          </button>
        )}
      </div>
      <p>
        Gym-specific policies are displayed as plain text. Review them with your
        business before publishing.
      </p>
      {editing ? (
        <form
          className="page-stack"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <label className="field">
            <span>Gym terms</span>
            <textarea
              className="textarea"
              value={text}
              maxLength={20000}
              rows={10}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          {save.isError && <p role="alert">{save.error.message}</p>}
          <div className="heading-actions">
            <button className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save terms"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={save.isPending}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {terms?.text || "No gym-specific terms have been published."}
        </p>
      )}
      {terms?.updatedAt && (
        <small>Updated {new Date(terms.updatedAt).toLocaleString()}</small>
      )}
      {save.isSuccess && !editing && <p role="status">Terms saved.</p>}
    </section>
  );
}
