import { GoogleAuth } from "google-auth-library";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import type {
  NotificationProvider,
  PushMessage,
} from "./notificationProvider.js";
export const pushConfigured = () =>
  Boolean(
    env.FIREBASE_PROJECT_ID &&
    env.FIREBASE_CLIENT_EMAIL &&
    env.FIREBASE_PRIVATE_KEY,
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
    /* Fall back to the signed-in user's notification inbox. */
  }
  return origin + "/notifications";
}
export class FirebaseProvider implements NotificationProvider {
  private auth?: GoogleAuth;
  async send(message: PushMessage) {
    if (!pushConfigured())
      throw new AppError(
        503,
        "PUSH_NOT_CONFIGURED",
        "Push notifications are not configured.",
      );
    this.auth ||= new GoogleAuth({
      credentials: {
        client_email: env.FIREBASE_CLIENT_EMAIL,
        private_key: env.FIREBASE_PRIVATE_KEY!.replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/firebase.messaging"],
      clientOptions: { transporterOptions: { timeout: 10000 } },
    });
    try {
      const token = await this.auth.getAccessToken();
      const link = notificationLink(message.data?.navigationPath);
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
        {
          method: "POST",
          signal: AbortSignal.timeout(15000),
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            message: {
              token: message.token,
              notification: {
                title: message.title.slice(0, 120),
                body: message.body.slice(0, 500),
              },
              data: {
                ...message.data,
                navigationPath:
                  new URL(link).pathname +
                  new URL(link).search +
                  new URL(link).hash,
              },
              webpush: {
                headers: { TTL: "86400" },
                notification: {
                  icon: "/brand/favicon.svg",
                  tag: message.data?.notificationId,
                },
                ...(link.startsWith("https:") ? { fcm_options: { link } } : {}),
              },
            },
          }),
        },
      );
      const result = (await response.json()) as any;
      if (!response.ok) {
        const code =
          result.error?.details?.find(
            (d: any) =>
              d["@type"] ===
              "type.googleapis.com/google.firebase.fcm.v1.FcmError",
          )?.errorCode ||
          result.error?.status ||
          "UNKNOWN";
        throw new PushDeliveryError(
          code,
          response.status === 429 || response.status >= 500,
        );
      }
      return { providerMessageId: result.name as string };
    } catch (error) {
      if (error instanceof PushDeliveryError) throw error;
      throw new PushDeliveryError("PROVIDER_UNAVAILABLE", true);
    }
  }
}
