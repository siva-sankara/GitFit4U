import { initializeApp, getApps } from "@firebase/app";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
} from "@firebase/messaging";
import workerUrl from "../firebase-messaging-sw.ts?worker&url";
import { firebaseConfig, firebaseConfigured } from "./firebaseConfig";
import { apiRequest, getAccessToken } from "./apiClient";
import type { NotificationAlert } from "./notificationAlerts";
const preference = "gfu_push_enabled",
  tokenKey = "gfu_push_token";
const deviceKey = "gfu_push_device";
export const pushOptedIn = () => localStorage.getItem(preference) === "true";
export { firebaseConfigured };
export async function pushSupported() {
  return (
    window.isSecureContext &&
    "Notification" in window &&
    "serviceWorker" in navigator &&
    (await isSupported())
  );
}
function messaging() {
  return getMessaging(
    getApps().find((app) => app.name === "getfit4u-push") ||
      initializeApp(firebaseConfig, "getfit4u-push"),
  );
}
let pending: Promise<unknown> = Promise.resolve();
function serial<T>(action: () => Promise<T>): Promise<T> {
  const next = pending.then(action, action);
  pending = next.catch(() => undefined);
  return next;
}
export function syncPushToken() {
  return serial(async () => {
    if (
      !pushOptedIn() ||
      !getAccessToken() ||
      !firebaseConfigured() ||
      !(await pushSupported()) ||
      Notification.permission !== "granted"
    )
      return;
    const session = getAccessToken();
    const registration = await navigator.serviceWorker.register(workerUrl, {
      type: "module",
      scope: "/assets/",
    });
    // This worker has its own scope, preserving the existing offline service worker.
    if (!registration.active)
      await new Promise<void>((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) {
          reject(
            new Error("Notification service could not start. Please retry."),
          );
          return;
        }
        const timer = window.setTimeout(() => {
          worker.removeEventListener("statechange", changed);
          reject(new Error("Notification setup timed out. Please retry."));
        }, 15000);
        function changed() {
          if (worker?.state === "activated") {
            clearTimeout(timer);
            worker.removeEventListener("statechange", changed);
            resolve();
          } else if (worker?.state === "redundant") {
            clearTimeout(timer);
            reject(new Error("Notification service could not start."));
          }
        }
        worker.addEventListener("statechange", changed);
        changed();
      });
    const token = await getToken(messaging(), {
      vapidKey: import.meta.env.VITE_FIREBASE_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token)
      throw new Error(
        "No browser notification token was returned. Please retry.",
      );
    if (session !== getAccessToken() || !pushOptedIn()) return;
    const previousToken = localStorage.getItem(tokenKey);
    const deviceId = localStorage.getItem(deviceKey) || crypto.randomUUID();
    localStorage.setItem(deviceKey, deviceId);
    await apiRequest("/api/v1/devices", {
      method: "POST",
      body: JSON.stringify({ token, platform: "WEB", deviceId }),
    });
    localStorage.setItem(tokenKey, token);
    if (previousToken && previousToken !== token)
      await apiRequest("/api/v1/devices", {
        method: "DELETE",
        body: JSON.stringify({ token: previousToken }),
      });
  });
}
export async function enablePush() {
  if (!firebaseConfigured())
    throw new Error("Browser notifications are not configured yet.");
  if (!(await pushSupported()))
    throw new Error(
      "This browser does not support push notifications. Use HTTPS or localhost in a supported browser.",
    );
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Allow them in this site's browser settings, then retry."
        : "Notification permission was not granted. You can try again whenever you are ready.",
    );
  const previouslyEnabled = pushOptedIn();
  localStorage.setItem(preference, "true");
  try {
    await syncPushToken();
  } catch (error) {
    if (!previouslyEnabled) localStorage.removeItem(preference);
    window.dispatchEvent(new Event("gfu-push-change"));
    throw error;
  }
  window.dispatchEvent(new Event("gfu-push-change"));
}
export function disablePush() {
  return serial(async () => {
    const token = localStorage.getItem(tokenKey);
    if (token && getAccessToken())
      await apiRequest("/api/v1/devices", {
        method: "DELETE",
        body: JSON.stringify({ token }),
      });
    localStorage.removeItem(preference);
    localStorage.removeItem(tokenKey);
    if (firebaseConfigured() && (await pushSupported()))
      await deleteToken(messaging());
    window.dispatchEvent(new Event("gfu-push-change"));
  });
}
export async function listenForPush(
  onPush: (alert: NotificationAlert) => void,
) {
  if (!firebaseConfigured() || !(await pushSupported())) return () => {};
  return onMessage(messaging(), (payload) => {
    if (!getAccessToken() || !pushOptedIn()) return;
    onPush({
      id: payload.data?.notificationId || payload.messageId,
      title:
        payload.notification?.title ||
        payload.data?.title ||
        "New notification",
      message: payload.notification?.body || payload.data?.body,
      actionUrl: payload.data?.navigationPath,
    });
  });
}
