import { initializeApp } from "firebase/app";
import { getMessaging, onBackgroundMessage } from "firebase/messaging/sw";
import { firebaseConfig } from "./services/firebaseConfig";
const worker = self as unknown as {
  location: Location;
  registration: ServiceWorkerRegistration;
  addEventListener: (type: string, listener: (event: any) => void) => void;
  clients: {
    matchAll: (options: any) => Promise<any[]>;
    openWindow: (url: string) => Promise<unknown>;
  };
};
// Install before getMessaging so all clicks use the application's safe local routing.
worker.addEventListener("notificationclick", (event) => {
  event.stopImmediatePropagation();
  event.notification.close();
  const data =
    event.notification.data?.FCM_MSG?.data || event.notification.data || {};
  let url = new URL("/notifications", worker.location.origin);
  try {
    const candidate = new URL(
      data.navigationPath || "/notifications",
      worker.location.origin,
    );
    if (candidate.origin === url.origin) url = candidate;
  } catch {
    /* Use inbox. */
  }
  event.waitUntil(
    (async () => {
      const clients = await worker.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const existing = clients.find(
        (client) => new URL(client.url).origin === url.origin,
      );
      if (existing) {
        await existing.navigate(url.href);
        await existing.focus();
      } else await worker.clients.openWindow(url.href);
    })(),
  );
});
if (
  firebaseConfig.apiKey &&
  firebaseConfig.projectId &&
  firebaseConfig.appId &&
  firebaseConfig.messagingSenderId
) {
  const messaging = getMessaging(initializeApp(firebaseConfig));
  onBackgroundMessage(messaging, (payload) => {
    // FCM displays notification payloads itself; do not show a second copy.
    if (payload.notification) return;
    return worker.registration.showNotification(
      payload.data?.title || "GETFIT4U",
      {
        body: payload.data?.body || "You have a new update.",
        icon: "/brand/favicon.svg",
        tag: payload.data?.notificationId,
        data: {
          navigationPath: payload.data?.navigationPath || "/notifications",
        },
      },
    );
  });
}
