import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, Volume2, VolumeX } from "lucide-react";
import { apiRequest } from "../services/apiClient";
import {
  notificationSoundEnabled,
  setNotificationSoundEnabled,
  playNotificationSound,
} from "../services/notificationAlerts";
import {
  disablePush,
  enablePush,
  firebaseConfigured,
  pushOptedIn,
  pushSupported,
} from "../services/firebasePush";
import "../styles/notifications.css";

export function PushNotificationSettings() {
  const client = useQueryClient();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [optedIn, setOptedIn] = useState(pushOptedIn);
  const [permission, setPermission] = useState(() =>
    "Notification" in window ? Notification.permission : "unsupported",
  );
  const [soundEnabled, setSoundEnabled] = useState(notificationSoundEnabled);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const server = useQuery({
    queryKey: ["push-config"],
    queryFn: () =>
      apiRequest<{
        data: {
          configured: boolean;
          registered: boolean;
          activeDevices: number;
        };
      }>("/api/v1/devices/status"),
    retry: false,
    refetchOnWindowFocus: true,
  });
  const enabled =
    optedIn && permission === "granted" && server.data?.data.registered;
  const available =
    supported && firebaseConfigured() && server.data?.data.configured;
  useEffect(() => {
    let alive = true;
    void pushSupported()
      .then((value) => {
        if (alive) setSupported(value);
      })
      .catch(() => {
        if (alive) setSupported(false);
      });
    const update = () => {
      setOptedIn(pushOptedIn());
      setSoundEnabled(notificationSoundEnabled());
      setPermission(
        "Notification" in window ? Notification.permission : "unsupported",
      );
    };
    for (const event of [
      "gfu-push-change",
      "gfu-notification-sound",
      "storage",
      "focus",
    ])
      window.addEventListener(event, update);
    return () => {
      alive = false;
      for (const event of [
        "gfu-push-change",
        "gfu-notification-sound",
        "storage",
        "focus",
      ])
        window.removeEventListener(event, update);
    };
  }, []);
  async function changePush() {
    setBusy(true);
    setMessage("");
    try {
      if (enabled) await disablePush();
      else await enablePush();
      await server.refetch();
      setOptedIn(pushOptedIn());
      setPermission(Notification.permission);
      setMessage(
        pushOptedIn()
          ? "Browser notifications connected on this device."
          : "Browser notifications disabled on this device. Other devices are unchanged.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update browser notifications.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function changeSound() {
    const next = !soundEnabled;
    // Invoke audio directly from the user gesture; permission never implies autoplay consent.
    const preview = next ? playNotificationSound(true) : Promise.resolve(true);
    setBusy(true);
    setMessage("");
    try {
      await apiRequest("/api/v1/users/me", {
        method: "PATCH",
        body: JSON.stringify({ notificationPreferences: { sound: next } }),
      });
      setNotificationSoundEnabled(next);
      setSoundEnabled(next);
      await client.invalidateQueries({ queryKey: ["me"] });
      const played = await preview;
      setMessage(
        next
          ? played
            ? "Notification sound enabled."
            : "Sound preference saved. This browser blocked playback; allow sound in its site settings."
          : "Notification sound disabled.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to save sound preference.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel notification-preferences" aria-busy={busy}>
      <summary>
        Notification settings{" "}
        <span>
          {enabled ? "Push connected" : "Inbox available"} · Sound{" "}
          {soundEnabled ? "on" : "off"}
        </span>
      </summary>
      <div className="notification-preference-row">
        <span className="notification-setting-icon" aria-hidden="true">
          {enabled ? <BellRing size={21} /> : <Bell size={21} />}
        </span>
        <div className="notification-setting-copy">
          <h2>Browser notifications</h2>
          <p>
            Permission: {permission}. Push:{" "}
            {enabled
              ? "connected"
              : server.isLoading
                ? "checking"
                : available
                  ? "not connected"
                  : "unavailable"}
            .
          </p>
          {permission === "denied" && (
            <p>
              Notifications are blocked. Change this site's notification
              permission in your browser settings, then return here.
            </p>
          )}
          {!available && !server.isLoading && (
            <p>Your in-app inbox still receives updates.</p>
          )}
        </div>
        <div className="notification-setting-actions">
          {permission !== "denied" && (
            <button
              className="btn btn-secondary"
              disabled={busy || (!enabled && !available)}
              onClick={() => void changePush()}
            >
              {enabled
                ? "Disable on this device"
                : optedIn && permission === "granted"
                  ? "Reconnect push"
                  : "Enable browser notifications"}
            </button>
          )}
        </div>
      </div>
      {server.isError && (
        <p role="alert">
          Unable to check push status.{" "}
          <button
            className="btn btn-ghost"
            onClick={() => void server.refetch()}
          >
            Retry
          </button>
        </p>
      )}
      <div className="notification-preference-row notification-sound-row">
        <span className="notification-setting-icon" aria-hidden="true">
          {soundEnabled ? <Volume2 size={21} /> : <VolumeX size={21} />}
        </span>
        <div className="notification-setting-copy">
          <h2>Notification sound</h2>
          <p>
            Opt in to a short sound for new unread updates while this app is
            focused.
          </p>
        </div>
        <div className="notification-setting-actions">
          <button
            className="btn btn-secondary"
            role="switch"
            aria-checked={soundEnabled}
            aria-label="Notification sound"
            disabled={busy}
            onClick={() => void changeSound()}
          >
            {soundEnabled ? "Sound on" : "Sound off"}
          </button>
          {soundEnabled && (
            <button
              className="btn btn-ghost"
              onClick={async () =>
                setMessage(
                  (await playNotificationSound(true))
                    ? "Test sound played."
                    : "Allow sound in this browser's site settings.",
                )
              }
            >
              Test sound
            </button>
          )}
        </div>
      </div>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
