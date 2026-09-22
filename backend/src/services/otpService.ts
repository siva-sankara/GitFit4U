import { nanoid } from "nanoid";
import { isProduction } from "../config/env.js";
import { OtpChallenge } from "../models/Auth.js";
import { randomDigits, hashOtp, safeEqualHex } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";
import { sendOtpSms } from "./smsService.js";

export function normalizePhone(input: string): string {
  const cleaned = input.replace(/[\s()-]/g, "");
  const phone = cleaned.startsWith("+")
    ? cleaned
    : `+91${cleaned.replace(/^0+/, "")}`;
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new AppError(
      422,
      "INVALID_PHONE",
      "Enter a valid mobile number with country code.",
    );
  }
  return phone;
}

export async function requestOtp(phoneInput: string, purpose = "LOGIN") {
  const phone = normalizePhone(phoneInput);
  const recent = await OtpChallenge.countDocuments({
    phone,
    createdAt: { $gte: new Date(Date.now() - 15 * 60_000) },
  });
  if (recent >= 3) {
    throw new AppError(
      429,
      "OTP_RATE_LIMITED",
      "Too many OTP requests. Please try again later.",
    );
  }
  await OtpChallenge.updateMany(
    { phone, purpose, consumedAt: null },
    { consumedAt: new Date() },
  );
  const publicId = nanoid(24);
  const code = randomDigits(6);
  await OtpChallenge.create({
    publicId,
    phone,
    purpose,
    codeHash: hashOtp(publicId, code),
    expiresAt: new Date(Date.now() + 5 * 60_000),
  });

  let sent: boolean;
  try {
    sent = await sendOtpSms(phone, code);
  } catch (error) {
    await OtpChallenge.updateOne({ publicId }, { consumedAt: new Date() });
    throw error;
  }
  return {
    challengeId: publicId,
    expiresInSeconds: 300,
    devOtp: isProduction || sent ? undefined : code,
  };
}

export async function verifyOtp(challengeId: string, code: string) {
  const challenge = await OtpChallenge.findOne({
    publicId: challengeId,
  }).select("+codeHash");
  if (!challenge || challenge.consumedAt) {
    throw new AppError(
      400,
      "OTP_INVALID",
      "This verification code is no longer valid.",
    );
  }
  if (challenge.expiresAt <= new Date()) {
    throw new AppError(
      400,
      "OTP_EXPIRED",
      "This verification code has expired.",
    );
  }
  if (challenge.attempts >= challenge.maxAttempts) {
    throw new AppError(
      429,
      "OTP_ATTEMPTS_EXCEEDED",
      "Too many attempts. Request a new code.",
    );
  }
  const matches = safeEqualHex(
    challenge.codeHash,
    hashOtp(challenge.publicId, code),
  );
  const claimed = await OtpChallenge.findOneAndUpdate(
    {
      _id: challenge._id,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: challenge.maxAttempts },
    },
    {
      $inc: { attempts: 1 },
      ...(matches ? { $set: { consumedAt: new Date() } } : {}),
    },
    { returnDocument: "after" },
  );
  if (!claimed)
    throw new AppError(
      400,
      "OTP_INVALID",
      "This verification code is no longer valid.",
    );
  if (!matches) {
    throw new AppError(
      400,
      "OTP_INVALID",
      "The verification code is incorrect.",
    );
  }
  return { phone: challenge.phone, purpose: challenge.purpose };
}
