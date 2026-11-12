import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { sendMicrosoftGraphOtpEmail } from "../integrations/notifications/microsoftGraphOtpProvider.js";
import { AuthOtpDelivery, OtpChallenge } from "../models/Auth.js";
import { AppError } from "../utils/AppError.js";
import { hashOtpContext } from "../utils/crypto.js";
import { sendWhatsAppAuthenticationOtp } from "./whatsappAuthOtpService.js";
import type { OtpPurpose } from "./otpService.js";

type DeliveryChannel = "MOBILE" | "EMAIL";
type DeliveryPayload = {
  challengeId: string;
  version: number;
  purpose: OtpPurpose;
  destination: string;
  code: string;
  expiresAt: string;
};

const accepted = new Set(["SUBMITTED", "SENT", "DELIVERED", "READ"]);
const terminal = new Set([
  "FAILED",
  "UNKNOWN",
  "CANCELLED",
  "SUBMITTED",
  "SENT",
  "DELIVERED",
  "READ",
]);

function deliveryKey() {
  if (!env.AUTH_OTP_DELIVERY_ENCRYPTION_KEY)
    throw new AppError(
      503,
      "AUTH_OTP_DELIVERY_KEY_MISSING",
      "OTP dual delivery is unavailable because its encryption key is not configured.",
    );
  return crypto
    .createHmac("sha256", env.AUTH_OTP_DELIVERY_ENCRYPTION_KEY)
    .update("getfit4u.auth-otp-delivery.v1")
    .digest();
}

export function encryptAuthOtpDelivery(payload: DeliveryPayload) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", deliveryKey(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  return [iv, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString("base64url"))
    .join(".");
}

export function decryptAuthOtpDelivery(value: string): DeliveryPayload {
  const parts = value.split(".");
  if (parts.length !== 3)
    throw new AppError(500, "AUTH_OTP_ENVELOPE_INVALID", "The OTP delivery envelope is invalid.");
  const [iv, tag, ciphertext] = parts.map((part) =>
    Buffer.from(part, "base64url"),
  );
  const decipher = crypto.createDecipheriv("aes-256-gcm", deliveryKey(), iv);
  decipher.setAuthTag(tag);
  return JSON.parse(
    Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"),
  ) as DeliveryPayload;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
      character
    ]!,
  );
}

export function authOtpEmailContent(
  purpose: "SIGNUP" | "LOGIN" | "ACCOUNT_RECOVERY",
  code: string,
  expiresAt: Date,
  now = new Date(),
) {
  const action =
    purpose === "SIGNUP"
      ? "signup"
      : purpose === "ACCOUNT_RECOVERY"
        ? "password recovery"
        : "login";
  const minutes = Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 60_000));
  const subject = `Your GETFIT4U ${action} verification code`;
  const safeCode = escapeHtml(code);
  const html = `<div style="font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:560px;margin:auto;padding:24px;color:#14221c;background:#ffffff"><div style="font-weight:800;color:#4d7c0f;letter-spacing:.04em">GETFIT4U</div><h1 style="font-size:24px;line-height:1.25">Enter verification code</h1><p>Use the following verification code to continue your GETFIT4U ${action}:</p><p style="font-size:32px;font-weight:800;letter-spacing:.18em;margin:24px 0">${safeCode}</p><p>This code expires in ${minutes} minute${minutes === 1 ? "" : "s"}. Enter it only in the GETFIT4U verification screen. Do not share it with anyone.</p><p>If you did not request this code, you can ignore this email.</p><hr style="border:0;border-top:1px solid #dbe4de;margin:24px 0"><p>GETFIT4U<br><a href="mailto:support@getfit4u.in">support@getfit4u.in</a></p></div>`;
  return { subject, html };
}

export async function queueAuthOtpDeliveries(input: {
  challenge: any;
  phone?: string;
  email?: string;
  sendMobile?: boolean;
  code: string;
  purpose: "SIGNUP" | "LOGIN" | "ACCOUNT_RECOVERY";
  expiresAt: Date;
}) {
  const destinations: Array<{ channel: DeliveryChannel; value: string }> = [
    ...(input.sendMobile !== false && input.phone
      ? [{ channel: "MOBILE" as const, value: input.phone }]
      : []),
    ...(input.email ? [{ channel: "EMAIL" as const, value: input.email }] : []),
  ];
  if (!destinations.length)
    throw new AppError(
      503,
      "OTP_DELIVERY_CHANNEL_UNAVAILABLE",
      "No verified authentication delivery channel is available.",
    );
  // Submitted rows drop their envelope immediately; an abandoned retry is
  // hard-deleted shortly after the challenge expires.
  const purgeAt = new Date(input.expiresAt.getTime() + 5 * 60_000);
  await AuthOtpDelivery.insertMany(
    destinations.map(({ channel, value }) => ({
      publicId: nanoid(24),
      challengeId: input.challenge._id,
      challengePublicId: input.challenge.publicId,
      channel,
      destinationHash: hashOtpContext(`otp-${channel.toLowerCase()}`, value),
      encryptedPayload: encryptAuthOtpDelivery({
        challengeId: input.challenge.publicId,
        version: Number(input.challenge.deliveryVersion || 1),
        purpose: input.purpose,
        destination: value,
        code: input.code,
        expiresAt: input.expiresAt.toISOString(),
      }),
      status: "QUEUED",
      nextAttemptAt: new Date(),
      expiresAt: input.expiresAt,
      purgeAt,
    })),
    { ordered: true },
  );
}

const permanentDeliveryErrors = new Set([
  "M365_OTP_NOT_CONFIGURED",
  "M365_CLIENT_CREDENTIAL_INVALID",
  "M365_ACCESS_TOKEN_REJECTED",
  "M365_MAIL_SEND_FORBIDDEN",
  "M365_MAILBOX_NOT_FOUND",
  "WHATSAPP_AUTH_NOT_LIVE",
  "WHATSAPP_AUTH_NOT_CONFIGURED",
  "WHATSAPP_AUTH_CREDENTIALS_INVALID",
  "WHATSAPP_AUTH_SENDER_NOT_READY",
  "WHATSAPP_AUTH_TEMPLATE_UNAVAILABLE",
  "WHATSAPP_AUTH_TEMPLATE_INVALID",
  "WHATSAPP_AUTH_TEMPLATE_NOT_FOUND",
  "WHATSAPP_AUTH_TEMPLATE_CATEGORY_INVALID",
  "WHATSAPP_AUTH_TEMPLATE_NOT_APPROVED",
  "WHATSAPP_AUTH_TEMPLATE_EXPIRY_MISMATCH",
  "WHATSAPP_AUTH_TEMPLATE_BUTTON_INVALID",
  "WHATSAPP_AUTH_SENDER_NOT_FOUND",
]);

export function isRetryableAuthOtpDeliveryError(error: any) {
  const code = String(error?.code || "");
  if (permanentDeliveryErrors.has(code)) return false;
  return (
    error?.statusCode === 429 ||
    error?.statusCode >= 500 ||
    ["NETWORK_ERROR", "M365_RATE_LIMITED"].includes(code)
  );
}

function uncertain(error: any) {
  return ["M365_SUBMISSION_UNKNOWN", "WHATSAPP_OTP_SUBMISSION_UNKNOWN"].includes(
    String(error?.code || ""),
  );
}

async function updateChallengeDelivery(challengePublicId: string) {
  const rows: any[] = await AuthOtpDelivery.find({ challengePublicId })
    .select("channel status providerReference lastErrorCode acceptedAt")
    .lean();
  const channelDelivery: Record<string, unknown> = {};
  for (const row of rows)
    channelDelivery[row.channel === "MOBILE" ? "mobile" : "email"] = {
      status: row.status,
      ...(row.providerReference ? { providerReference: row.providerReference } : {}),
      ...(row.lastErrorCode ? { lastErrorCode: row.lastErrorCode } : {}),
      ...(row.acceptedAt ? { acceptedAt: row.acceptedAt } : {}),
    };
  const hasAccepted = rows.some((row) => accepted.has(row.status));
  const hasUnknown = rows.some((row) => row.status === "UNKNOWN");
  const allTerminal = rows.length > 0 && rows.every((row) => terminal.has(row.status));
  const allFailed = allTerminal && !hasAccepted && !hasUnknown;
  const acceptedStatus = ["READ", "DELIVERED", "SENT", "SUBMITTED"].find(
    (status) => rows.some((row) => row.status === status),
  );
  const deliveryStatus = hasAccepted
    ? acceptedStatus || "SUBMITTED"
    : hasUnknown
      ? "UNKNOWN"
      : allFailed
        ? "FAILED"
        : "PENDING";
  await OtpChallenge.updateOne(
    { publicId: challengePublicId },
    {
      $set: {
        channelDelivery,
        deliveryStatus,
        ...(hasAccepted ? { submittedAt: new Date() } : {}),
        ...(allFailed ? { failedAt: new Date(), consumedAt: new Date() } : {}),
      },
    },
  );
  if (hasAccepted) {
    const current: any = await OtpChallenge.findOne({ publicId: challengePublicId })
      .select("+subjectHash phone purpose pendingOperationId createdAt")
      .lean();
    if (current)
      await OtpChallenge.updateMany(
        {
          publicId: { $ne: challengePublicId },
          ...(current.subjectHash
            ? { subjectHash: current.subjectHash }
            : { phone: current.phone }),
          purpose: current.purpose,
          ...(current.pendingOperationId
            ? { pendingOperationId: current.pendingOperationId }
            : { pendingOperationId: { $exists: false } }),
          createdAt: { $lte: current.createdAt },
          consumedAt: null,
        },
        { $set: { consumedAt: new Date() } },
      );
  }
  return { rows, deliveryStatus, hasAccepted, allFailed };
}

async function processDelivery(filter: Record<string, unknown>, now: Date) {
  const leaseToken = crypto.randomUUID();
  const row: any = await AuthOtpDelivery.findOneAndUpdate(
    {
      ...filter,
      expiresAt: { $gt: now },
      $or: [
        { status: "QUEUED", nextAttemptAt: { $lte: now } },
        { status: "SENDING", leaseUntil: { $lte: now } },
      ],
    },
    {
      $set: {
        status: "SENDING",
        leaseToken,
        leaseUntil: new Date(now.getTime() + 30_000),
      },
      $inc: { attempts: 1 },
    },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  ).select("+encryptedPayload");
  if (!row) return false;
  const claim = { _id: row._id, leaseToken };
  const challenge: any = await OtpChallenge.findOne({
    _id: row.challengeId,
    publicId: row.challengePublicId,
    consumedAt: null,
    expiresAt: { $gt: now },
  }).lean();
  if (!challenge) {
    await AuthOtpDelivery.updateOne(claim, {
      $set: { status: "CANCELLED", lastErrorCode: "OTP_CHALLENGE_INACTIVE" },
      $unset: { encryptedPayload: 1, leaseToken: 1, leaseUntil: 1 },
    });
    return row.challengePublicId as string;
  }
  let payload: DeliveryPayload;
  try {
    payload = decryptAuthOtpDelivery(row.encryptedPayload);
    if (
      payload.challengeId !== challenge.publicId ||
      payload.version !== Number(challenge.deliveryVersion || 1) ||
      payload.purpose !== challenge.purpose ||
      new Date(payload.expiresAt) <= now
    )
      throw new AppError(409, "OTP_DELIVERY_STALE", "The OTP delivery is no longer current.");
    let providerReference: string;
    if (row.channel === "MOBILE") {
      const sent = await sendWhatsAppAuthenticationOtp(
        payload.destination,
        payload.code,
      );
      providerReference = sent.providerMessageId;
    } else {
      const sent = await sendMicrosoftGraphOtpEmail({
        to: payload.destination,
        ...authOtpEmailContent(
          payload.purpose as "SIGNUP" | "LOGIN" | "ACCOUNT_RECOVERY",
          payload.code,
          new Date(payload.expiresAt),
          now,
        ),
      });
      providerReference = sent.submissionReference;
    }
    await AuthOtpDelivery.updateOne(claim, {
      $set: { status: "SUBMITTED", acceptedAt: now, providerReference },
      $unset: { encryptedPayload: 1, lastErrorCode: 1, leaseToken: 1, leaseUntil: 1 },
    });
  } catch (error: any) {
    const code = String(error?.code || "OTP_DELIVERY_FAILED").slice(0, 100);
    const unknown = uncertain(error);
    const delay = Math.max(
      1_000,
      Math.min(
        60_000,
        Number(error?.details?.retryAfterMs || 5_000 * 2 ** Math.min(4, row.attempts)),
      ),
    );
    const nextAttemptAt = new Date(now.getTime() + delay);
    const retry =
      isRetryableAuthOtpDeliveryError(error) &&
      !unknown &&
      row.attempts < 5 &&
      nextAttemptAt < row.expiresAt;
    await AuthOtpDelivery.updateOne(claim, {
      $set: {
        status: unknown ? "UNKNOWN" : retry ? "QUEUED" : "FAILED",
        lastErrorCode: code,
        ...(retry ? { nextAttemptAt } : {}),
      },
      $unset: { leaseToken: 1, leaseUntil: 1, ...(retry ? {} : { encryptedPayload: 1 }) },
    });
    logger.warn(
      { event: "auth.otp.delivery.deferred", channel: row.channel, code, challengeId: row.challengePublicId },
      "Authentication OTP delivery was not accepted",
    );
  }
  return row.challengePublicId as string;
}

export async function deliverAuthOtpChallenge(
  challengePublicId: string,
  now = new Date(),
) {
  for (let index = 0; index < 2; index++) {
    const processed = await processDelivery({ challengePublicId }, now);
    if (!processed) break;
  }
  return updateChallengeDelivery(challengePublicId);
}

export async function deliverAuthOtpDeliveries(limit = 20, now = new Date()) {
  let processed = 0;
  for (; processed < limit; processed++) {
    const challengePublicId = await processDelivery({}, now);
    if (!challengePublicId) break;
    // A retry may be the first accepted transport for this replacement. Keep
    // the aggregate status and previous-challenge invalidation in sync even
    // when the send happens in the dedicated worker rather than the request.
    await updateChallengeDelivery(challengePublicId);
  }
  const expired: any[] = await AuthOtpDelivery.find({
    status: { $in: ["QUEUED", "SENDING"] },
    expiresAt: { $lte: now },
  })
    .select("challengePublicId")
    .limit(limit)
    .lean();
  if (expired.length) {
    await AuthOtpDelivery.updateMany(
      { _id: { $in: expired.map((row) => row._id) } },
      {
        $set: { status: "CANCELLED", lastErrorCode: "OTP_EXPIRED" },
        $unset: { encryptedPayload: 1, leaseToken: 1, leaseUntil: 1 },
      },
    );
    for (const challengeId of new Set(expired.map((row) => row.challengePublicId)))
      await updateChallengeDelivery(challengeId);
  }
  return { processed };
}

export async function recordAuthOtpMobileStatus(
  providerReference: string,
  status: string,
  providerErrorCode?: string,
) {
  const normalized = status.toUpperCase();
  const mapped = ["SENT", "DELIVERED", "READ", "FAILED"].includes(normalized)
    ? normalized
    : undefined;
  if (!mapped) return false;
  const allowedPrevious: Record<string, string[]> = {
    SENT: ["SUBMITTED"],
    DELIVERED: ["SUBMITTED", "SENT"],
    READ: ["SUBMITTED", "SENT", "DELIVERED"],
    FAILED: ["SUBMITTED", "SENT"],
  };
  const row: any = await AuthOtpDelivery.findOneAndUpdate(
    {
      channel: "MOBILE",
      providerReference,
      status: { $in: allowedPrevious[mapped] },
    },
    {
      $set: {
        status: mapped,
        ...(providerErrorCode ? { lastErrorCode: providerErrorCode.slice(0, 100) } : {}),
      },
    },
    { returnDocument: "after" },
  ).lean();
  if (!row) return false;
  await updateChallengeDelivery(row.challengePublicId);
  return true;
}
