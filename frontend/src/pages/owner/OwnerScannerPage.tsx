import { useState } from "react";
import { useCurrentUser } from "../../api/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { Modal } from "../../components/Modal";
import "../../styles/member-management.css";

type GymQr = {
  token: string;
  gymName: string;
  revision: number;
  locationRequired: boolean;
};
export function OwnerScannerPage() {
  const session = useCurrentUser();
  const permissions = session.data?.data.context.permissions || [];
  const [replace, setReplace] = useState(false),
    [memberCode, setMemberCode] = useState(""),
    [reason, setReason] = useState("");
  const qr = useQuery({
    queryKey: ["api", "/api/v1/owner/attendance/qr"],
    queryFn: () =>
      apiRequest<ApiEnvelope<GymQr>>("/api/v1/owner/attendance/qr"),
    retry: false,
  });
  const rotate = useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/owner/attendance/qr/rotate", {
        method: "POST",
        body: "{}",
      }),
    onSuccess: () => {
      setReplace(false);
      void qr.refetch();
    },
  });
  const manual = useMutation({
    mutationFn: async () => {
      return apiRequest<ApiEnvelope<{ duplicate: boolean }>>(
        "/api/v1/owner/scanner/check-in",
        {
          method: "POST",
          idempotencyKey: crypto.randomUUID(),
          body: JSON.stringify({
            memberIdentifier: memberCode.trim(),
            source: "MANUAL",
            reason: reason.trim() || undefined,
          }),
        },
      );
    },
  });
  function download() {
    const svg = document.querySelector("#gym-attendance-qr svg");
    if (!svg) return;
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(svg)], {
        type: "image/svg+xml",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "gym-attendance-qr.svg";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="page-stack">
      <header className="page-heading">
        <div>
          <span className="eyebrow">Attendance</span>
          <h1>Gym attendance QR</h1>
          <p>
            Display this code at reception. Members scan it from their own
            phone.
          </p>
        </div>
      </header>
      {qr.isPending && <p role="status">Loading your gym QR...</p>}
      {qr.isError && (
        <div className="panel state-card" role="alert">
          <p>{qr.error.message}</p>
          <button
            className="btn btn-secondary"
            onClick={() => void qr.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      <div className="owner-attendance-grid">
        {qr.data && (
          <section className="panel attendance-qr-card">
            <h2>{qr.data.data.gymName}</h2>
            <div
              id="gym-attendance-qr"
              style={{
                display: "inline-flex",
                padding: 20,
                background: "#fff",
                borderRadius: 16,
              }}
            >
              <QRCodeSVG
                value={qr.data.data.token}
                size={210}
                marginSize={2}
                level="M"
              />
            </div>
            <p>Persistent gym QR - Version {qr.data.data.revision}</p>
            <p>
              {qr.data.data.locationRequired
                ? "Members must enable location and be near this gym."
                : "Membership and daily duplicate checks are required for every scan."}
            </p>
            <div className="heading-actions">
              <button className="btn btn-primary" onClick={download}>
                Download QR
              </button>
              {permissions.includes("gym:update") && (
                <button
                  className="btn btn-secondary"
                  onClick={() => setReplace(true)}
                >
                  Replace QR
                </button>
              )}
            </div>
          </section>
        )}
        {permissions.includes("attendance:scan") && (
          <section className="panel attendance-manual-card">
            <h2>Manual attendance exception</h2>
            <p>Record an eligible member's attendance now. Location permission is not required.</p>
            <form
              className="modal-form"
              onSubmit={(event) => {
                event.preventDefault();
                manual.mutate();
              }}
            >
              <label className="field">
                <span>Member code</span>
                <input
                  className="input"
                  required
                  minLength={3}
                  value={memberCode}
                  onChange={(event) => setMemberCode(event.target.value)}
                />
              </label>
              <label className="field">
                <span>Reason (optional)</span>
                <textarea className="input" maxLength={500} value={reason} onChange={event => setReason(event.target.value)} />
              </label>
              <button className="btn btn-secondary" disabled={manual.isPending}>
                {manual.isPending ? "Recording..." : "Record check-in"}
              </button>
              {manual.isError && <p role="alert">{manual.error.message}</p>}
              {manual.isSuccess && (
                <p role="status">
                  {manual.data.data.duplicate
                    ? "This member is already checked in today."
                    : "Attendance recorded."}
                </p>
              )}
            </form>
          </section>
        )}
      </div>
      <Modal
        open={replace}
        title="Replace gym QR?"
        onClose={() => {
          if (!rotate.isPending) setReplace(false);
        }}
      >
        <p>
          The previous printed or downloaded code will stop working. Display the
          replacement code at reception.
        </p>
        {rotate.isError && <p role="alert">{rotate.error.message}</p>}
        <button
          className="btn btn-primary"
          disabled={rotate.isPending}
          onClick={() => rotate.mutate()}
        >
          {rotate.isPending
            ? "Replacing..."
            : "Replace and revoke previous code"}
        </button>
      </Modal>
    </div>
  );
}
