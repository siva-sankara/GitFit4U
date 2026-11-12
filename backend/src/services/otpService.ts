import type { ClientSession, Types } from "mongoose";
import { nanoid } from "nanoid";
import { OtpChallenge } from "../models/Auth.js";
import {
  hashOtp,
  hashOtpContext,
  randomDigits,
  safeEqualHex,
} from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";
import { normalizeAccountPhone } from "../utils/accountIdentity.js";
import { sendWhatsAppAuthenticationOtp } from "./whatsappAuthOtpService.js";
import { env } from "../config/env.js";
import { normalizeEmail } from "../utils/accountIdentity.js";
import {
  deliverAuthOtpChallenge,
  queueAuthOtpDeliveries,
  recordAuthOtpMobileStatus,
} from "./authOtpDeliveryService.js";

export type OtpPurpose = "SIGNUP" | "LOGIN" | "STEP_UP" | "ACCOUNT_RECOVERY";

const otpExpiryMs = () => env.AUTH_OTP_TTL_SECONDS * 1000;
const otpResendCooldownMs = () => env.AUTH_OTP_RESEND_COOLDOWN_SECONDS * 1000;
const OTP_ABUSE_WINDOW_MS = 15 * 60_000;
const OTP_PHONE_LIMIT = 5;
const OTP_IP_LIMIT = 20;
const OTP_RETENTION_MS = 24 * 60 * 60_000;

export function normalizePhone(input: string): string {
  return normalizeAccountPhone(input);
}

export function maskPhone(phone: string) {
  const visible = phone.slice(-4);
  return `${phone.slice(0, Math.min(3, phone.length - 4))}${"•".repeat(
    Math.max(4, phone.length - visible.length - 3),
  )}${visible}`;
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.max(3, Math.min(8, local.length - 1)))}@${domain}`;
}

type RequestOtpOptions = {
  ipAddress?: string;
  pendingOperationId?: string | Types.ObjectId;
  userId?: string | Types.ObjectId;
  email?: string;
  sendMobile?: boolean;
  suppressDelivery?: boolean;
};

function operationFilter(pendingOperationId?: string | Types.ObjectId) {
  return pendingOperationId
    ? { pendingOperationId }
    : { pendingOperationId: { $exists: false } };
}

export async function requestOtp(
  phoneInput: string | undefined,
  purpose: OtpPurpose = "LOGIN",
  options: RequestOtpOptions = {},
) {
  const preview = env.OTP_MODE === "development_preview" && env.OTP_DEV_PREVIEW_ENABLED;
  if (preview && purpose !== "SIGNUP" && purpose !== "LOGIN")
    throw new AppError(403, "PREVIEW_PURPOSE_FORBIDDEN", "Local test codes are available for signup and login only.");
  const phone = phoneInput ? normalizePhone(phoneInput) : undefined;
  const suppressDelivery = options.suppressDelivery === true;
  const requestedEmail = options.email ? normalizeEmail(options.email) : undefined;
  const sendMobile = options.sendMobile !== false && Boolean(phone);
  const managedDelivery =
    env.AUTH_OTP_DUAL_DELIVERY_ENABLED &&
    !preview &&
    !suppressDelivery &&
    ["SIGNUP", "LOGIN", "ACCOUNT_RECOVERY"].includes(purpose) &&
    (sendMobile || Boolean(requestedEmail));
  const email = managedDelivery ? requestedEmail : undefined;
  const dualDelivery = sendMobile && Boolean(email);
  if (!phone && !requestedEmail)
    throw new AppError(
      400,
      "OTP_DESTINATION_REQUIRED",
      "A verified email address or mobile number is required.",
    );
  if (!suppressDelivery && !managedDelivery && !phone)
    throw new AppError(
      503,
      "OTP_EMAIL_DELIVERY_NOT_CONFIGURED",
      "Email verification delivery is not configured.",
    );
  const now = new Date();
  const windowStart = new Date(now.getTime() - OTP_ABUSE_WINDOW_MS);
  const requestIpHash = hashOtpContext("otp-ip", options.ipAddress || "unknown");
  const subjectHash = hashOtpContext(
    "otp-subject",
    options.pendingOperationId
      ? `operation:${String(options.pendingOperationId)}`
      : options.userId
        ? `user:${String(options.userId)}`
        : phone
          ? `phone:${phone}`
          : `email:${requestedEmail}`,
  );
  const latest: any = await OtpChallenge.findOne({
    subjectHash,
    purpose,
    ...operationFilter(options.pendingOperationId),
  })
    .sort({ createdAt: -1 })
    .lean();
  if (latest?.resendAvailableAt && latest.resendAvailableAt > now) {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((latest.resendAvailableAt.getTime() - now.getTime()) / 1000),
    );
    throw new AppError(
      429,
      "OTP_RESEND_COOLDOWN",
      `Wait ${retryAfterSeconds} seconds before requesting another code.`,
      { retryAfterSeconds },
    );
  }
  const [subjectRequests, ipRequests] = await Promise.all([
    OtpChallenge.countDocuments({ subjectHash, createdAt: { $gte: windowStart } }),
    OtpChallenge.countDocuments({
      requestIpHash,
      createdAt: { $gte: windowStart },
    }),
  ]);
  if (subjectRequests >= OTP_PHONE_LIMIT || ipRequests >= OTP_IP_LIMIT)
    throw new AppError(
      429,
      "OTP_RATE_LIMITED",
      "Too many verification requests. Please try again later.",
    );

  const publicId = nanoid(24);
  const resendLeaseId = latest?._id && !latest.consumedAt ? nanoid(20) : undefined;
  if (latest?._id && !latest.consumedAt) {
    const claimed = await OtpChallenge.findOneAndUpdate(
      {
        _id: latest._id,
        consumedAt: null,
        resendAvailableAt: { $lte: now },
        $or: [
          { resendLeaseUntil: { $exists: false } },
          { resendLeaseUntil: null },
          { resendLeaseUntil: { $lte: now } },
        ],
      },
      {
        $set: {
          resendLeaseId,
          resendLeaseUntil: new Date(now.getTime() + 30_000),
        },
      },
      { returnDocument: "after" },
    );
    if (!claimed)
      throw new AppError(
        429,
        "OTP_RESEND_IN_PROGRESS",
        "A replacement code is already being requested. Wait a moment and try again.",
        { retryAfterSeconds: 2 },
      );
  }
  const releaseResendLease = async () => {
    if (!latest?._id || !resendLeaseId) return;
    await OtpChallenge.updateOne(
      { _id: latest._id, resendLeaseId, consumedAt: null },
      { $unset: { resendLeaseId: 1, resendLeaseUntil: 1 } },
    );
  };
  const code = randomDigits(6);
  const expiresAt = new Date(now.getTime() + otpExpiryMs());
  const resendAvailableAt = new Date(now.getTime() + otpResendCooldownMs());
  const challenge: any = await OtpChallenge.create({
    publicId,
    ...(phone ? { phone } : {}),
    subjectHash,
    purpose,
    pendingOperationId: options.pendingOperationId,
    userId: options.userId,
    ...(email ? { emailHash: hashOtpContext("otp-email", email) } : {}),
    dualDelivery,
    mobileDelivery: managedDelivery ? sendMobile : Boolean(phone),
    emailDelivery: Boolean(email),
    deliveryVersion: 1,
    codeHash: hashOtp(publicId, code),
    requestIpHash,
    maxAttempts: env.AUTH_OTP_MAX_ATTEMPTS,
    expiresAt,
    resendAvailableAt,
    purgeAt: new Date(now.getTime() + OTP_RETENTION_MS),
    deliveryStatus: "PENDING",
    ...(suppressDelivery ? { consumedAt: now } : {}),
  });

  let deliveryStatus: "PENDING" | "SUBMITTED" | "UNKNOWN" | "SIMULATED" = preview
    ? "SIMULATED"
    : "PENDING";
  let managedChannels:
    | Record<string, { status: string }>
    | undefined;
  if (suppressDelivery) {
    // Preserve a privacy-safe, rate-limited pre-authentication response without
    // turning an unknown/ineligible phone number into an open message relay.
    deliveryStatus = "PENDING";
  } else if (managedDelivery) {
    try {
      await queueAuthOtpDeliveries({
        challenge,
        phone,
        email,
        sendMobile,
        code,
        purpose: purpose as "SIGNUP" | "LOGIN" | "ACCOUNT_RECOVERY",
        expiresAt,
      });
      const delivery = await deliverAuthOtpChallenge(publicId, now);
      deliveryStatus = delivery.deliveryStatus as "PENDING" | "SUBMITTED" | "UNKNOWN";
      managedChannels = Object.fromEntries(
        delivery.rows.map((row: any) => [
          row.channel === "MOBILE" ? "mobile" : "email",
          { status: String(row.status) },
        ]),
      );
      if (delivery.allFailed)
        throw new AppError(
          502,
          "OTP_DELIVERY_FAILED",
          "Neither eligible verification channel accepted this code. Try again later.",
        );
    } catch (error) {
      await OtpChallenge.updateOne(
        { publicId, deliveryStatus: { $nin: ["SUBMITTED", "UNKNOWN"] } },
        { $set: { deliveryStatus: "FAILED", failedAt: new Date(), consumedAt: new Date() } },
      );
      await releaseResendLease();
      throw error;
    }
  } else try {
    const sent = preview
      ? undefined
      : await sendWhatsAppAuthenticationOtp(phone!, code);
    await OtpChallenge.updateOne(
      { publicId, consumedAt: null },
      {
        $set: {
          ...(sent ? { providerMessageId: sent.providerMessageId } : {}),
          deliveryStatus: preview ? "SIMULATED" : "SUBMITTED",
          submittedAt: new Date(),
        },
      },
    );
    deliveryStatus = preview ? "SIMULATED" : "SUBMITTED";
  } catch (error: any) {
    const unknown = error?.code === "WHATSAPP_OTP_SUBMISSION_UNKNOWN";
    await OtpChallenge.updateOne(
      { publicId },
      {
        $set: {
          deliveryStatus: unknown ? "UNKNOWN" : "FAILED",
          providerErrorCode: String(
            error?.details?.providerCode ||
              error?.code ||
              "WHATSAPP_OTP_PROVIDER_FAILED",
          ).slice(0, 100),
          failedAt: new Date(),
          consumedAt: new Date(),
        },
      },
    );
    await releaseResendLease();
    throw error;
  }

  // Managed delivery invalidates older versions inside updateChallengeDelivery
  // only after at least one authorized provider accepts the replacement. The
  // legacy single-channel path keeps the same acceptance ordering here.
  if (!managedDelivery && !suppressDelivery)
    await OtpChallenge.updateMany({ subjectHash, purpose, ...operationFilter(options.pendingOperationId),
      publicId: { $ne: publicId }, createdAt: { $lte: now }, consumedAt: null }, { $set: { consumedAt: new Date() } });
  return {
    challengeId: publicId,
    ...(phone ? { maskedPhone: maskPhone(phone) } : {}),
    ...(purpose === "SIGNUP" && email ? { maskedEmail: maskEmail(email) } : {}),
    expiresInSeconds: env.AUTH_OTP_TTL_SECONDS,
    resendInSeconds: env.AUTH_OTP_RESEND_COOLDOWN_SECONDS,
    deliveryStatus,
    ...(purpose === "SIGNUP" && dualDelivery
      ? { dualDelivery: true as const, channelDelivery: managedChannels }
      : {}),
    ...(preview ? { developmentPreview: { code, simulated: true as const } } : {}),
  };
}

type VerifyOtpOptions = {
  expectedPurpose?: OtpPurpose;
  pendingOperationId?: string | Types.ObjectId;
  session?: ClientSession;
};

export async function verifyOtp(
  challengeId: string,
  code: string,
  options: VerifyOtpOptions = {},
) {
  const query = OtpChallenge.findOne({ publicId: challengeId }).select(
    "+codeHash +emailHash +subjectHash",
  );
  if (options.session) query.session(options.session);
  const challenge: any = await query;
  if (!challenge || challenge.consumedAt)
    throw new AppError(
      400,
      "OTP_INVALID",
      "This verification code is no longer valid.",
    );
  if (challenge.deliveryStatus === "SIMULATED" &&
      (env.OTP_MODE !== "development_preview" || !env.OTP_DEV_PREVIEW_ENABLED ||
       !["SIGNUP", "LOGIN"].includes(challenge.purpose)))
    throw new AppError(400, "OTP_INVALID", "Development verification is disabled.");
  if (
    options.expectedPurpose &&
    challenge.purpose !== options.expectedPurpose
  )
    throw new AppError(
      400,
      "OTP_PURPOSE_INVALID",
      "Use a verification code issued for this operation.",
    );
  if (
    options.pendingOperationId &&
    String(challenge.pendingOperationId || "") !==
      String(options.pendingOperationId)
  )
    throw new AppError(
      400,
      "OTP_OPERATION_INVALID",
      "This verification code does not belong to the pending operation.",
    );
  if (challenge.deliveryStatus === "FAILED")
    throw new AppError(
      400,
      "OTP_DELIVERY_FAILED",
      "This verification message was not delivered. Request a new code.",
    );
  if (challenge.expiresAt <= new Date())
    throw new AppError(
      400,
      "OTP_EXPIRED",
      "This verification code has expired.",
    );
  if (challenge.attempts >= challenge.maxAttempts)
    throw new AppError(
      429,
      "OTP_ATTEMPTS_EXCEEDED",
      "Too many incorrect attempts. Request a new code.",
    );

  const matches = safeEqualHex(
    challenge.codeHash,
    hashOtp(challenge.publicId, code),
  );
  const finalIncorrectAttempt =
    !matches && challenge.attempts + 1 >= challenge.maxAttempts;
  const update: Record<string, unknown> = { $inc: { attempts: 1 } };
  if (matches || finalIncorrectAttempt)
    update.$set = { consumedAt: new Date() };
  const claimed = await OtpChallenge.findOneAndUpdate(
    {
      _id: challenge._id,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: challenge.maxAttempts },
      purpose: challenge.purpose,
      codeHash: challenge.codeHash,
    },
    update,
    {
      returnDocument: "after",
      ...(options.session ? { session: options.session } : {}),
    },
  );
  if (!claimed)
    throw new AppError(
      400,
      "OTP_INVALID",
      "This verification code is no longer valid.",
    );
  if (!matches)
    throw new AppError(
      finalIncorrectAttempt ? 429 : 400,
      finalIncorrectAttempt ? "OTP_ATTEMPTS_EXCEEDED" : "OTP_INVALID",
      finalIncorrectAttempt
        ? "Too many incorrect attempts. Request a new code."
        : "The verification code is incorrect.",
    );
  return {
    phone: challenge.phone,
    userId: challenge.userId ? String(challenge.userId) : undefined,
    dualDelivery: challenge.dualDelivery === true,
    mobileDelivery: challenge.mobileDelivery !== false && Boolean(challenge.phone),
    emailDelivery: challenge.emailDelivery === true,
    emailHash: challenge.emailHash ? String(challenge.emailHash) : undefined,
    simulated: challenge.deliveryStatus === "SIMULATED",
    purpose: challenge.purpose as OtpPurpose,
    pendingOperationId: challenge.pendingOperationId
      ? String(challenge.pendingOperationId)
      : undefined,
  };
}

export async function invalidateOtpOperation(
  pendingOperationId: string | Types.ObjectId,
  session?: ClientSession,
) {
  await OtpChallenge.updateMany(
    { pendingOperationId, consumedAt: null },
    { $set: { consumedAt: new Date() } },
    session ? { session } : undefined,
  );
}

export async function recordOtpDeliveryStatus(
  providerMessageId: string,
  status: string,
  providerErrorCode?: string,
) {
  if (await recordAuthOtpMobileStatus(providerMessageId, status, providerErrorCode))
    return true;
  const normalized = status.toUpperCase();
  if (!["SENT", "DELIVERED", "READ", "FAILED"].includes(normalized))
    return false;
  const allowedPrevious: Record<string, string[]> = {
    SENT: ["PENDING", "SUBMITTED"],
    DELIVERED: ["PENDING", "SUBMITTED", "SENT"],
    READ: ["PENDING", "SUBMITTED", "SENT", "DELIVERED"],
    FAILED: ["PENDING", "SUBMITTED", "SENT"],
  };
  const result = await OtpChallenge.updateOne(
    { providerMessageId, deliveryStatus: { $in: allowedPrevious[normalized] } },
    {
      $set: {
        deliveryStatus: normalized,
        ...(providerErrorCode ? { providerErrorCode } : {}),
        ...(normalized === "FAILED"
          ? { failedAt: new Date(), consumedAt: new Date() }
          : {}),
      },
    },
  );
  return result.matchedCount > 0;
}
