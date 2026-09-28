import { useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { useCurrentUser } from "../../api/hooks";
import { useMutation, useQuery } from "@tanstack/react-query";
import { QRCodeSVG } from "qrcode.react";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import "../../styles/member-management.css";

type GymQr = {
  token: string;
  gymName: string;
  revision?: number;
  locationRequired: boolean;
};
export function OwnerScannerPage() {
  const session = useCurrentUser();
  const permissions = session.data?.data.context.permissions || [];
  const [memberCode, setMemberCode] = useState(""),
    [reason, setReason] = useState("");
  const qr = useQuery({
    queryKey: ["api", "/api/v1/owner/attendance/qr", session.data?.data.context.gymId],
    enabled: Boolean(session.data?.data.context.gymId),
    queryFn: () =>
      apiRequest<ApiEnvelope<GymQr>>("/api/v1/owner/attendance/qr"),
    retry: false,
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
      <PageHeader>
        <div>
          <span className="eyebrow">Attendance</span>
          <h1>Gym attendance QR</h1>
          <p>
            Display this code at reception. Members scan it from their own
            phone.
          </p>
        </div>
      </PageHeader>
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
                marginSize={4}
                bgColor="#ffffff"
                fgColor="#000000"
                level="M"
              />
            </div>
            <p>Permanent gym QR. Keep this code displayed at reception; it stays the same when your gym details or subscription change.</p>
            <p>
              {qr.data.data.locationRequired
                ? "Members must enable location and be near this gym."
                : "Membership and daily duplicate checks are required for every scan."}
            </p>
            <div className="heading-actions">
              <button className="btn btn-primary" onClick={download}>
                Download QR
              </button>
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
    </div>
  );
}
