import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../../components/PageHeader";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { Camera, CheckCircle2, ScanLine } from "lucide-react";
import { Link } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { deviceLocation } from "../../services/location";

export function AttendanceQrPage() {
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<IScannerControls | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const acquiring = useRef<Promise<MediaStream> | null>(null);
  const mounted = useRef(false);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0),
    captured = useRef(false);
  const [cameraActive, setCameraActive] = useState(false),
    [cameraPending, setCameraPending] = useState(false),
    [paused, setPaused] = useState(false),
    [cameraError, setCameraError] = useState(""),
    [locationNotice, setLocationNotice] = useState("");
  const client = useQueryClient();
  function stop() {
    generation.current++;
    controls.current?.stop();
    controls.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setCameraActive(false);
    setCameraPending(false);
  }
  const scan = useMutation({
    mutationFn: async ({ qrToken, controller }: { qrToken: string; controller: AbortController }) => {
      let location;
      try {
        const point = await deviceLocation();
        location = {
          coordinates: [point.longitude, point.latitude],
          accuracyMeters: point.accuracyMeters,
          capturedAt: point.capturedAt,
        };
      } catch (error) {
        if (mounted.current && !controller.signal.aborted) setLocationNotice(
          error instanceof Error
            ? error.message
            : "Location is unavailable. The gym may require it for attendance.",
        );
      }
      if (controller.signal.aborted || !mounted.current || document.visibilityState === "hidden")
        throw new Error("Scan paused. Check attendance history before retrying if a request was already sent.");
      return apiRequest<
        ApiEnvelope<{ duplicate: boolean; event: { occurredAt: string } }>
      >("/api/v1/users/me/attendance/check-in", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        signal: controller.signal,
        body: JSON.stringify({ qrToken, location }),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["api"] });
    },
    onSettled: () => { request.current = null; },
  });
  async function start() {
    if (!mounted.current || document.visibilityState === "hidden" || request.current) return;
    stop();
    scan.reset();
    captured.current = false;
    setCameraError("");
    setLocationNotice("");
    setPaused(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera access requires HTTPS or localhost and a supported browser.",
      );
      return;
    }
    const current = generation.current;
    const currentPage = () => mounted.current && current === generation.current && document.visibilityState !== "hidden";
    setCameraPending(true);
    try {
      // A pending browser permission prompt cannot be cancelled. Serialize
      // acquisition so resume/retry cannot leave two cameras running.
      if (acquiring.current) await acquiring.current.catch(() => undefined);
      if (!currentPage()) return;
      const obtain = async () => {
        try {
          return await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        } catch (error) {
          if (!currentPage()) throw error;
          if (error instanceof Error && ["OverconstrainedError", "ConstraintNotSatisfiedError"].includes(error.name))
            return navigator.mediaDevices.getUserMedia({ video: true, audio: false });
          throw error;
        }
      };
      const pending = obtain();
      acquiring.current = pending;
      let acquired: MediaStream;
      try { acquired = await pending; }
      finally { if (acquiring.current === pending) acquiring.current = null; }
      if (!currentPage()) { acquired.getTracks().forEach(track => track.stop()); return; }
      stream.current = acquired;
      setCameraActive(true);
      setCameraPending(false);
      const reader = new BrowserQRCodeReader();
      const controller = await reader.decodeFromStream(
        acquired,
        video.current!,
        (result, _error, activeControls) => {
          if (!result || captured.current || !currentPage())
            return;
          captured.current = true;
          activeControls.stop();
          stop();
          const controller = new AbortController();
          request.current = controller;
          scan.mutate({ qrToken: result.getText(), controller });
        },
      );
      if (generation.current !== current || captured.current) controller.stop();
      else controls.current = controller;
    } catch (error) {
      if (!currentPage()) return;
      stop();
      const name = error instanceof Error ? error.name : "";
      setCameraError(
        name === "NotAllowedError"
          ? "Camera permission was denied. Allow camera access in your browser and try again."
          : name === "NotFoundError"
            ? "No camera was found on this device."
            : name === "NotReadableError"
              ? "Your camera is busy or unavailable. Close other camera apps and retry."
              : "Unable to start the camera. Check browser permissions and retry.",
      );
    }
  }
  const startLatest = useRef(start);
  startLatest.current = start;
  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    // Deferral prevents duplicate prompts during Strict Mode's effect replay.
    void Promise.resolve().then(() => { if (!disposed) void startLatest.current(); });
    void client.invalidateQueries({ queryKey: ["api"], predicate: query => String(query.queryKey[1]).startsWith("/api/v1/users/me/attendance") });
    const pause = () => { stop(); request.current?.abort(); setPaused(true); };
    const visibility = () => {
      if (document.visibilityState === "hidden") pause();
      else if (!captured.current) void startLatest.current();
    };
    const auth = (event: Event) => { if (!(event as CustomEvent).detail?.token) { mounted.current = false; pause(); } };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pause);
    window.addEventListener("gfu-auth", auth);
    return () => {
      disposed = true;
      mounted.current = false;
      stop();
      request.current?.abort();
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("gfu-auth", auth);
    };
  }, [client]);
  return (
    <div className="page-stack scanner-page">
      <PageHeader>
        <div>
          <span className="eyebrow">Attendance</span>
          <h1>Scan gym QR</h1>
          <p>
            Point your camera at the QR displayed at your gym. One check-in is
            recorded per gym day.
          </p>
        </div>
        <Link className="btn btn-secondary" to="/app/attendance">
          Attendance history
        </Link>
      </PageHeader>
      <section
        className="panel state-card"
        style={{ maxWidth: 680, marginInline: "auto", width: "100%" }}
      >
        <video
          ref={video}
          muted
          playsInline
          aria-label="Gym QR camera preview"
          style={{
            width: "100%",
            maxHeight: 420,
            aspectRatio: "4 / 3",
            objectFit: "cover",
            borderRadius: 16,
            display: cameraActive ? "block" : "none",
          }}
        />
        {scan.isSuccess ? (
          <div role="status">
            <CheckCircle2 size={40} />
            <h2>
              {scan.data.data.duplicate
                ? "Already checked in today"
                : "Check-in successful"}
            </h2>
            <p>{new Date(scan.data.data.event.occurredAt).toLocaleString()}</p>
          </div>
        ) : (
          !cameraActive && <Camera size={48} aria-hidden="true" />
        )}
        {scan.isPending && (
          <p role="status">
            Checking your gym membership and recording attendance...
          </p>
        )}
        {cameraError && (
          <p className="form-alert" role="alert">
            {cameraError}
          </p>
        )}
        {cameraPending && <p role="status">Waiting for camera access. Allow camera permission in your browser to start scanning.</p>}
        {paused && <p role="status">Camera paused. If a check-in was interrupted, check attendance history before retrying. Another scan will not create a second daily check-in.</p>}
        {scan.isError && (
          <p className="form-alert" role="alert">
            {scan.error.message} Check attendance history if the connection was interrupted, then scan again if needed.
          </p>
        )}
        {locationNotice && <p>{locationNotice}</p>}
        <div className="heading-actions">
          {cameraActive || cameraPending ? (
            <button className="btn btn-secondary" onClick={() => { stop(); setPaused(true); }}>
              Stop camera
            </button>
          ) : (cameraError || scan.isSuccess || scan.isError || paused) && (
            <button
              className="btn btn-primary"
              disabled={scan.isPending}
              onClick={() => void start()}
            >
              <ScanLine size={18} />
              {scan.isSuccess || scan.isError ? "Scan again" : "Retry camera"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
