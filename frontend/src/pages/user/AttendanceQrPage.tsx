import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BrowserQRCodeReader, type IScannerControls } from "@zxing/browser";
import { Camera, CheckCircle2, ScanLine } from "lucide-react";
import { Link } from "react-router-dom";
import { apiRequest, type ApiEnvelope } from "../../services/apiClient";
import { deviceLocation } from "../../services/location";

export function AttendanceQrPage() {
  const video = useRef<HTMLVideoElement>(null),
    controls = useRef<IScannerControls | null>(null);
  const generation = useRef(0),
    captured = useRef(false);
  const [cameraActive, setCameraActive] = useState(false),
    [cameraError, setCameraError] = useState(""),
    [locationNotice, setLocationNotice] = useState("");
  const client = useQueryClient();
  function stop() {
    generation.current++;
    controls.current?.stop();
    controls.current = null;
    const stream = video.current?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((track) => track.stop());
    if (video.current) video.current.srcObject = null;
    setCameraActive(false);
  }
  const scan = useMutation({
    mutationFn: async (qrToken: string) => {
      let location;
      try {
        const point = await deviceLocation();
        location = {
          coordinates: [point.longitude, point.latitude],
          accuracyMeters: point.accuracyMeters,
          capturedAt: point.capturedAt,
        };
      } catch (error) {
        setLocationNotice(
          error instanceof Error
            ? error.message
            : "Location is unavailable. The gym may require it for attendance.",
        );
      }
      return apiRequest<
        ApiEnvelope<{ duplicate: boolean; event: { occurredAt: string } }>
      >("/api/v1/users/me/attendance/check-in", {
        method: "POST",
        idempotencyKey: crypto.randomUUID(),
        body: JSON.stringify({ qrToken, location }),
      });
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["api"] });
    },
  });
  async function start() {
    stop();
    scan.reset();
    captured.current = false;
    setCameraError("");
    setLocationNotice("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(
        "Camera access requires HTTPS or localhost and a supported browser.",
      );
      return;
    }
    const current = generation.current;
    setCameraActive(true);
    try {
      const reader = new BrowserQRCodeReader();
      const controller = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        video.current!,
        (result, _error, activeControls) => {
          if (!result || captured.current || generation.current !== current)
            return;
          captured.current = true;
          activeControls.stop();
          stop();
          scan.mutate(result.getText());
        },
      );
      if (generation.current !== current || captured.current) controller.stop();
      else controls.current = controller;
    } catch (error) {
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
  useEffect(
    () => () => {
      generation.current++;
      controls.current?.stop();
      (video.current?.srcObject as MediaStream | null)
        ?.getTracks()
        .forEach((track) => track.stop());
    },
    [],
  );
  return (
    <div className="page-stack scanner-page">
      <header className="page-heading">
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
      </header>
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
        {scan.isError && (
          <p className="form-alert" role="alert">
            {scan.error.message}
          </p>
        )}
        {locationNotice && <p>{locationNotice}</p>}
        <div className="heading-actions">
          {cameraActive ? (
            <button className="btn btn-secondary" onClick={stop}>
              Stop camera
            </button>
          ) : (
            <button
              className="btn btn-primary"
              disabled={scan.isPending}
              onClick={() => void start()}
            >
              <ScanLine size={18} />
              {scan.isSuccess || scan.isError ? "Scan again" : "Open camera"}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
