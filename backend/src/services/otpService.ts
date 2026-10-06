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

export type OtpPurpose = "SIGNUP" | "LOGIN" | "STEP_UP" | "ACCOUNT_RECOVERY";

const OTP_EXPIRY_MS = 5 * 60_000;
const OTP_RESEND_COOLDOWN_MS = 60_000;
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

type RequestOtpOptions = {
  ipAddress?: string;
  pendingOperationId?: string | Types.ObjectId;
};

function operationFilter(pendingOperationId?: string | Types.ObjectId) {
  return pendingOperationId
    ? { pendingOperationId }
    : { pendingOperationId: { $exists: false } };
}

export async function requestOtp(
  phoneInput: string,
  purpose: OtpPurpose = "LOGIN",
  options: RequestOtpOptions = {},
) {
  const phone = normalizePhone(phoneInput);
  const now = new Date();
  const windowStart = new Date(now.getTime() - OTP_ABUSE_WINDOW_MS);
  const requestIpHash = hashOtpContext("otp-ip", options.ipAddress || "unknown");
  const latest: any = await OtpChallenge.findOne({
    phone,
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
  const [phoneRequests, ipRequests] = await Promise.all([
    OtpChallenge.countDocuments({ phone, createdAt: { $gte: windowStart } }),
    OtpChallenge.countDocuments({
      requestIpHash,
      createdAt: { $gte: windowStart },
    }),
  ]);
  if (phoneRequests >= OTP_PHONE_LIMIT || ipRequests >= OTP_IP_LIMIT)
    throw new AppError(
      429,
      "OTP_RATE_LIMITED",
      "Too many verification requests. Please try again later.",
    );

  await OtpChallenge.updateMany(
    {
      phone,
      purpose,
      ...operationFilter(options.pendingOperationId),
      consumedAt: null,
    },
    { $set: { consumedAt: now } },
  );

  const publicId = nanoid(24);
  const code = randomDigits(6);
  const expiresAt = new Date(now.getTime() + OTP_EXPIRY_MS);
  const resendAvailableAt = new Date(now.getTime() + OTP_RESEND_COOLDOWN_MS);
  await OtpChallenge.create({
    publicId,
    phone,
    purpose,
    pendingOperationId: options.pendingOperationId,
    codeHash: hashOtp(publicId, code),
    requestIpHash,
    expiresAt,
    resendAvailableAt,
    purgeAt: new Date(now.getTime() + OTP_RETENTION_MS),
    deliveryStatus: "PENDING",
  });

  try {
    const sent = await sendWhatsAppAuthenticationOtp(phone, code);
    await OtpChallenge.updateOne(
      { publicId, consumedAt: null },
      {
        $set: {
          providerMessageId: sent.providerMessageId,
          deliveryStatus: "SUBMITTED",
          submittedAt: new Date(),
        },
      },
    );
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
    throw error;
  }

  return {
    challengeId: publicId,
    maskedPhone: maskPhone(phone),
    expiresInSeconds: OTP_EXPIRY_MS / 1000,
    resendInSeconds: OTP_RESEND_COOLDOWN_MS / 1000,
    deliveryStatus: "SUBMITTED" as const,
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
    "+codeHash",
  );
  if (options.session) query.session(options.session);
  const challenge: any = await query;
  if (!challenge || challenge.consumedAt)
    throw new AppError(
      400,
      "OTP_INVALID",
      "This verification code is no longer valid.",
    );
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
  if (
    challenge.deliveryStatus === "FAILED" ||
    challenge.deliveryStatus === "UNKNOWN"
  )
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
