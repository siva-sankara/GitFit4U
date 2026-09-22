import { useEffect, useState } from "react";
import { apiRequest } from "../services/apiClient";
import { useQuery } from "@tanstack/react-query";
import { Bell, BellRing, Volume2, VolumeX } from "lucide-react";
import {
  notificationSoundEnabled,
  setNotificationSoundEnabled,
  playNotificationSound,
} from "../services/notificationAlerts";
import "../styles/notifications.css";
import {
  disablePush,
  enablePush,
  firebaseConfigured,
  pushOptedIn,
  pushSupported,
} from "../services/firebasePush";
export function PushNotificationSettings() {
  const [supported, setSupported] = useState<boolean | null>(null),
    [enabled, setEnabled] = useState(pushOptedIn),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [soundEnabled, setSoundEnabled] = useState(notificationSoundEnabled);
  const [soundMessage, setSoundMessage] = useState("");
  const server = useQuery({
    queryKey: ["push-config"],
    queryFn: () =>
      apiRequest<{ data: { configured: boolean } }>("/api/v1/devices/status"),
    retry: false,
  });
  useEffect(() => {
    const update = () => {
      setEnabled(pushOptedIn());
      setSoundEnabled(notificationSoundEnabled());
    };
    window.addEventListener("gfu-push-change", update);
    window.addEventListener("gfu-notification-sound", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("gfu-push-change", update);
      window.removeEventListener("gfu-notification-sound", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void pushSupported()
      .then((value) => {
        if (alive) setSupported(value);
      })
      .catch(() => {
        if (alive) setSupported(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  async function change(reconnect = false) {
    setBusy(true);
    setMessage("");
    try {
      if (enabled && !reconnect) await disablePush();
      else await enablePush();
      setEnabled(pushOptedIn());
      setMessage(
        pushOptedIn()
          ? "Browser notifications enabled on this device."
          : "Browser notifications disabled on this device.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update notifications. Please retry.",
      );
    } finally {
      setEnabled(pushOptedIn());
      setBusy(false);
    }
  }
  return (
    <section
      className="panel notification-preferences"
      aria-label="Notification preferences"
      aria-busy={busy}
    >
      <div className="notification-preference-row">
        <span className="notification-setting-icon" aria-hidden="true">
          {enabled ? <BellRing size={22} /> : <Bell size={22} />}
        </span>
        <div className="notification-setting-copy">
          <h2>Browser notifications</h2>
          <p>Receive updates even when you're away from this tab.</p>
          {!firebaseConfigured() || server.data?.data.configured === false ? (
            <p className="notification-setting-hint">
              Browser alerts are not available yet. Your inbox will continue to
              receive updates.
            </p>
          ) : supported === false ? (
            <p className="notification-setting-hint">
              Browser alerts are unavailable on this device. You can still read
              all updates here.
            </p>
          ) : null}
        </div>
        <div className="notification-setting-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => change()}
            disabled={
              busy ||
              (!enabled &&
                (!supported ||
                  !firebaseConfigured() ||
                  !server.data?.data.configured))
            }
          >
            {busy
              ? "Updating…"
              : enabled
                ? "Disable browser notifications"
                : "Enable browser notifications"}
          </button>
          {enabled && (
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || !server.data?.data.configured}
              onClick={() => change(true)}
            >
              Reconnect notifications
            </button>
          )}
        </div>
      </div>
      {server.isError && (
        <p role="alert">
          Unable to check notification availability.{" "}
          <button
            className="btn btn-secondary"
            onClick={() => server.refetch()}
          >
            Retry
          </button>
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="notification-preference-row notification-sound-row">
        <span className="notification-setting-icon" aria-hidden="true">
          {soundEnabled ? <Volume2 size={22} /> : <VolumeX size={22} />}
        </span>
        <div className="notification-setting-copy">
          <h2>Alert sound</h2>
          <p>Play a short sound for new updates while you're using the app.</p>
        </div>
        <div className="notification-setting-actions">
          <button
            type="button"
            className="btn btn-secondary"
            role="switch"
            aria-checked={soundEnabled}
            aria-label="Alert sound"
            onClick={() => {
              setNotificationSoundEnabled(!soundEnabled);
              setSoundEnabled(!soundEnabled);
            }}
          >
            {soundEnabled ? "Sound on" : "Sound off"}
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={async () => {
              const played = await playNotificationSound(true);
              setSoundMessage(
                played
                  ? "Test sound played."
                  : "Sound could not play. Allow audio in your browser's site settings and try again.",
              );
            }}
          >
            Test sound
          </button>
        </div>
      </div>
      {soundMessage && <p role="status">{soundMessage}</p>}
    </section>
  );
}
