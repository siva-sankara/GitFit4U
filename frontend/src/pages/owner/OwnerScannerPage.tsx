import { deviceLocation } from "../../services/location";
import { useMutation } from "@tanstack/react-query";
import {
  Camera,
  Check,
  CheckCircle2,
  Keyboard,
  MapPin,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  apiRequest,
  type ApiEnvelope,
} from "../../services/apiClient";

type ScanResult = {
  duplicate: boolean;
  member?: { displayName?: string; memberCode?: string };
  event: { occurredAt: string };
  subscription?: { endsAt: string };
};
type BarcodeDetectorLike = {
  detect(source: ImageBitmapSource): Promise<Array<{ rawValue: string }>>;
};
declare global {
  interface Window {
    BarcodeDetector?: new (options: {
      formats: string[];
    }) => BarcodeDetectorLike;
  }
}

async function currentLocation() {
  const point = await deviceLocation();
  return {
    coordinates: [point.longitude, point.latitude] as [number, number],
    accuracyMeters: point.accuracyMeters,
    capturedAt: point.capturedAt,
  };
}

export function OwnerScannerPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const [mode, setMode] = useState<"QR" | "MANUAL">("QR");
  const [value, setValue] = useState("");
  const [cameraError, setCameraError] = useState("");
  const scan = useMutation({
    mutationFn: async (input: { value: string; mode: "QR" | "MANUAL" }) => {
      let location;
      try {
        location = await currentLocation();
      } catch {
        /* The backend decides whether location is mandatory. */
      }
      return apiRequest<ApiEnvelope<ScanResult>>(
        "/api/v1/owner/scanner/check-in",
        {
          method: "POST",
          idempotencyKey: crypto.randomUUID(),
          body: JSON.stringify(
            input.mode === "QR"
              ? {
                  qrToken: input.value,
                  source: "QR",
                  scannerId: "web-front-desk",
                  location,
                }
              : {
                  memberIdentifier: input.value,
                  source: "MANUAL",
                  scannerId: "web-front-desk",
                  location,
                },
          ),
        },
      );
    },
  });
  const stopCamera = () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  };
  const submit = (token = value) => {
    const cleaned = token.trim();
    if (cleaned) {
      stopCamera();
      scan.mutate({ value: cleaned, mode });
    }
  };
  const startCamera = async () => {
    setCameraError("");
    scan.reset();
    if (!window.BarcodeDetector) {
      setCameraError(
        "This browser does not support camera QR detection. Paste the secure QR value or use member ID.",
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const detector = new window.BarcodeDetector({ formats: ["qr_code"] });
      const detect = async () => {
        try {
          const codes = await detector.detect(video);
          if (codes[0]?.rawValue) {
            setValue(codes[0].rawValue);
            submit(codes[0].rawValue);
            return;
          }
        } catch {
          /* Retry on the next animation frame. */
        }
        frameRef.current = requestAnimationFrame(detect);
      };
      detect();
    } catch {
      setCameraError(
        "Camera permission is unavailable. Allow camera access or use manual check-in.",
      );
    }
  };
  useEffect(() => () => stopCamera(), []);
  const error =
    scan.error instanceof ApiError
      ? scan.error.message
      : "Unable to validate this attendance request.";
  return (
    <div className="scanner-page">
      <header className="page-heading scanner-heading">
        <div>
          <span className="eyebrow">Secure front desk</span>
          <h1>Scan member QR</h1>
          <p>
            Every submission is validated by the API against gym, membership,
            duplicate and location rules.
          </p>
        </div>
      </header>
      <div className="scanner-layout">
        <section className="scanner-frame panel">
          {scan.isSuccess ? (
            <div className="scan-result success">
              <span>
                <CheckCircle2 size={44} />
              </span>
              <h2>
                {scan.data.data.duplicate
                  ? "Already checked in"
                  : "Check-in successful"}
              </h2>
              <p>
                {scan.data.data.member?.displayName || "Member"} ·{" "}
                {new Date(scan.data.data.event.occurredAt).toLocaleTimeString()}
              </p>
              <button
                className="btn btn-primary"
                onClick={() => {
                  scan.reset();
                  setValue("");
                }}
              >
                <RefreshCw size={17} />
                Scan next member
              </button>
            </div>
          ) : scan.isError ? (
            <div className="scan-result error">
              <span>
                <ShieldAlert size={44} />
              </span>
              <h2>Check-in blocked</h2>
              <p>{error}</p>
              <button
                className="btn btn-secondary"
                onClick={() => scan.reset()}
              >
                <RefreshCw size={17} />
                Try again
              </button>
            </div>
          ) : (
            <div className="scanner-ready">
              <span className="scanner-camera">
                <Camera size={34} />
              </span>
              <h2>
                {mode === "QR" ? "Camera QR scanner" : "Manual member check-in"}
              </h2>
              <p>
                {mode === "QR"
                  ? "Scan the member’s short-lived signed QR code."
                  : "Enter an exact member code or public ID."}
              </p>
              {mode === "QR" && (
                <>
                  <div className="qr-frame active">
                    <i />
                    <i />
                    <i />
                    <i />
                    <video
                      ref={videoRef}
                      muted
                      playsInline
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: 16,
                      }}
                    />
                  </div>
                  <button
                    className="btn btn-primary"
                    onClick={startCamera}
                    disabled={scan.isPending}
                  >
                    <ScanLine size={18} />
                    Start camera
                  </button>
                </>
              )}
              <label className="search-field" style={{ marginTop: 16 }}>
                <input
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={
                    mode === "QR"
                      ? "Paste secure QR value"
                      : "Member ID or code"
                  }
                />
              </label>
              <button
                className="btn btn-secondary"
                onClick={() => submit()}
                disabled={scan.isPending || value.trim().length < 3}
              >
                {scan.isPending ? "Validating…" : "Validate and check in"}
              </button>
              {cameraError && <p className="error-text">{cameraError}</p>}
            </div>
          )}
        </section>
        <aside className="scanner-side">
          <section className="panel">
            <header>
              <h2>Check-in method</h2>
            </header>
            <button
              className="btn btn-ghost modal-full-button"
              onClick={() => {
                stopCamera();
                setMode(mode === "QR" ? "MANUAL" : "QR");
                setValue("");
                scan.reset();
              }}
            >
              {mode === "QR" ? <Keyboard size={17} /> : <Camera size={17} />}
              Switch to {mode === "QR" ? "manual" : "QR"}
            </button>
          </section>
          <section className="panel scanner-rules">
            <h2>
              <ShieldCheck size={19} />
              Server validation
            </h2>
            <div>
              <Check size={15} />
              Signed, expiring QR
            </div>
            <div>
              <Check size={15} />
              Correct gym scope
            </div>
            <div>
              <Check size={15} />
              Active subscription
            </div>
            <div>
              <Check size={15} />
              Duplicate protection
            </div>
            <div>
              <MapPin size={15} />
              Optional geofence and accuracy
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
