import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";

type CachedToken = { value: string; refreshAt: number };
let cachedToken: CachedToken | undefined;
let tokenPromise: Promise<string> | undefined;

function configured() {
  return Boolean(
    env.AUTH_OTP_DUAL_DELIVERY_ENABLED &&
      env.AUTH_OTP_EMAIL_PROVIDER === "microsoft_graph" &&
      env.M365_TENANT_ID &&
      env.M365_CLIENT_ID &&
      env.M365_CLIENT_SECRET &&
      env.M365_SENDER_MAILBOX,
  );
}

async function graphToken() {
  if (!configured())
    throw new AppError(
      503,
      "M365_OTP_NOT_CONFIGURED",
      "Microsoft 365 OTP email delivery is not configured.",
    );
  if (cachedToken && cachedToken.refreshAt > Date.now()) return cachedToken.value;
  if (!tokenPromise) {
    tokenPromise = (async () => {
      const response = await fetch(
        `https://login.microsoftonline.com/${encodeURIComponent(env.M365_TENANT_ID!)}/oauth2/v2.0/token`,
        {
          method: "POST",
          signal: AbortSignal.timeout(12_000),
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.M365_CLIENT_ID!,
            client_secret: env.M365_CLIENT_SECRET!,
            scope: "https://graph.microsoft.com/.default",
            grant_type: "client_credentials",
          }),
        },
      );
      if (!response.ok)
        throw new AppError(
          response.status === 400 || response.status === 401 ? 503 : 502,
          response.status === 400 || response.status === 401
            ? "M365_CLIENT_CREDENTIAL_INVALID"
            : `M365_TOKEN_${response.status}`,
          response.status === 400 || response.status === 401
            ? "Microsoft 365 rejected the OTP mailer credential. Check the tenant, client ID, secret value and secret expiry."
            : "Microsoft 365 token acquisition is temporarily unavailable.",
        );
      const result = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!result.access_token)
        throw new AppError(
          502,
          "M365_TOKEN_RESPONSE_INVALID",
          "Microsoft 365 returned an invalid access-token response.",
        );
      cachedToken = {
        value: result.access_token,
        refreshAt:
          Date.now() + Math.max(30, Number(result.expires_in || 3600) - 300) * 1000,
      };
      return cachedToken.value;
    })().finally(() => {
      tokenPromise = undefined;
    });
  }
  return tokenPromise;
}

function retryAfterMs(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function graphFailure(response: Response) {
  const details = retryAfterMs(response);
  if (response.status === 401)
    return new AppError(
      503,
      "M365_ACCESS_TOKEN_REJECTED",
      "Microsoft 365 rejected the OTP mailer access token.",
    );
  if (response.status === 403)
    return new AppError(
      503,
      "M365_MAIL_SEND_FORBIDDEN",
      "The GETFIT4U OTP Mailer is not authorized to send as the configured support mailbox.",
    );
  if (response.status === 404)
    return new AppError(
      503,
      "M365_MAILBOX_NOT_FOUND",
      "The configured Microsoft 365 sender mailbox was not found.",
    );
  if (response.status === 429)
    return new AppError(
      429,
      "M365_RATE_LIMITED",
      "Microsoft 365 temporarily rate-limited OTP email delivery.",
      details === undefined ? undefined : { retryAfterMs: details },
    );
  return new AppError(
    response.status >= 500 ? 502 : 422,
    `M365_SEND_${response.status}`,
    response.status >= 500
      ? "Microsoft 365 OTP email delivery is temporarily unavailable."
      : "Microsoft 365 rejected the OTP email request.",
  );
}

export type MicrosoftGraphOtpMessage = {
  to: string;
  subject: string;
  html: string;
};

export async function sendMicrosoftGraphOtpEmail(
  message: MicrosoftGraphOtpMessage,
) {
  const accessToken = await graphToken();
  const correlationId = crypto.randomUUID();
  let response: Response;
  try {
    response = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(env.M365_SENDER_MAILBOX)}/sendMail`,
      {
        method: "POST",
        signal: AbortSignal.timeout(15_000),
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          "client-request-id": correlationId,
          "return-client-request-id": "true",
        },
        body: JSON.stringify({
          message: {
            subject: message.subject,
            body: { contentType: "HTML", content: message.html },
            from: {
              emailAddress: {
                address: env.M365_FROM_EMAIL,
                name: env.M365_FROM_NAME,
              },
            },
            replyTo: [
              { emailAddress: { address: env.M365_REPLY_TO, name: env.M365_FROM_NAME } },
            ],
            toRecipients: [{ emailAddress: { address: message.to } }],
          },
          saveToSentItems: false,
        }),
      },
    );
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      502,
      "M365_SUBMISSION_UNKNOWN",
      "Microsoft 365 did not confirm whether the OTP email was accepted. Wait before requesting another code.",
    );
  }
  if (response.status !== 202) throw graphFailure(response);
  // Graph sendMail returns 202 with no message ID. Keep only our diagnostic
  // correlation reference; acceptance is not represented as delivery.
  return {
    submissionReference:
      response.headers.get("request-id") ||
      response.headers.get("client-request-id") ||
      correlationId,
  };
}

/** Test-only cache isolation; contains no credential value. */
export function resetMicrosoftGraphOtpTokenCache() {
  cachedToken = undefined;
  tokenPromise = undefined;
}
