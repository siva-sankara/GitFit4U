import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import type {
  NotificationProvider,
  PushMessage,
} from "./notificationProvider.js";

export const pushConfigured = () =>
  Boolean(
    env.FIREBASE_PROJECT_ID?.trim() &&
    env.FIREBASE_CLIENT_EMAIL?.trim() &&
    env.FIREBASE_PRIVATE_KEY?.trim(),
  );
export class PushDeliveryError extends Error {
  constructor(
    public code: string,
    public retryable: boolean,
  ) {
    super("Push notification delivery failed.");
  }
}
export function notificationLink(path?: string) {
  const origin = new URL(env.CLIENT_ORIGIN.split(",")[0].trim()).origin;
  try {
    const url = new URL(path || "/notifications", origin);
    if (url.origin === origin && ["http:", "https:"].includes(url.protocol))
      return url.href;
  } catch {
    /* Use the signed-in inbox for malformed routing data. */
  }
  return origin + "/notifications";
}
export class FirebaseProvider implements NotificationProvider {
  async send(message: PushMessage) {
    if (!pushConfigured())
      throw new AppError(
        503,
        "PUSH_NOT_CONFIGURED",
        "Push notifications are not configured.",
      );
    try {
      const app =
        getApps().find((value) => value.name === "getfit4u-notifications") ||
        initializeApp(
          {
            projectId: env.FIREBASE_PROJECT_ID,
            credential: cert({
              projectId: env.FIREBASE_PROJECT_ID,
              clientEmail: env.FIREBASE_CLIENT_EMAIL,
              privateKey: env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
            }),
          },
          "getfit4u-notifications",
        );
      const link = new URL(notificationLink(message.data?.navigationPath));
      const providerMessageId = await getMessaging(app).send({
        token: message.token,
        notification: {
          title: message.title.slice(0, 120),
          body: message.body.slice(0, 500),
        },
        data: {
          ...message.data,
          navigationPath: link.pathname + link.search + link.hash,
        },
        webpush: {
          headers: { TTL: "86400" },
          notification: {
            icon: "/brand/favicon.svg",
            tag: message.data?.notificationId,
            renotify: false,
            silent: message.data?.soundEnabled !== "true",
          },
          ...(link.protocol === "https:"
            ? { fcmOptions: { link: link.href } }
            : {}),
        },
        android: { collapseKey: message.data?.notificationId, ttl: 86400000 },
      });
      return { providerMessageId };
    } catch (error) {
      const code =
        typeof (error as any)?.code === "string"
          ? (error as any).code
          : "unknown";
      if (
        [
          "messaging/registration-token-not-registered",
          "messaging/invalid-registration-token",
        ].includes(code)
      )
        throw new PushDeliveryError("UNREGISTERED", false);
      const retryable = [
        "messaging/server-unavailable",
        "messaging/internal-error",
        "messaging/quota-exceeded",
        "messaging/message-rate-exceeded",
        "app/network-error",
        "app/network-timeout",
        "unknown",
      ].includes(code);
      throw new PushDeliveryError(code, retryable);
    }
  }
}
