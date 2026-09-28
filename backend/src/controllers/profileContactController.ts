import type { Request, Response } from "express";
import mongoose from "mongoose";
import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { contactPhone } from "../routes/authSchemas.js";
import { User } from "../models/User.js";
import { AuthIdentity, Session } from "../models/Auth.js";
import { DeviceToken } from "../models/Collaboration.js";
import { ProfileContactChange } from "../models/Social.js";
import {
  requestOtp,
  verifyOtp,
  normalizePhone,
} from "../services/otpService.js";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";
import { writeAudit } from "../services/auditService.js";
import { normalizeEmail } from "../utils/accountIdentity.js";

export async function requestPhoneChange(req: Request, res: Response) {
  const body = z
    .object({ phone: contactPhone })
    .strict()
    .parse(req.body);
  const phone = normalizePhone(body.phone);
  if (await User.exists({ phone, _id: { $ne: req.auth!.userId } }))
    throw new AppError(
      409,
      "CONTACT_UNAVAILABLE",
      "This contact detail is unavailable.",
    );
  const challenge = await requestOtp(phone, "STEP_UP");
  await ProfileContactChange.create({
    userId: req.auth!.userId,
    challengeId: challenge.challengeId,
    phone,
    expiresAt: new Date(Date.now() + 300000),
  });
  res.status(201).json({ success: true, data: challenge });
}
export async function confirmPhoneChange(req: Request, res: Response) {
  const body = z
    .object({
      challengeId: z.string().min(8).max(64),
      code: z.string().regex(/^\d{6}$/),
    })
    .strict()
    .parse(req.body);
  const change = await ProfileContactChange.findOne({
    challengeId: body.challengeId,
    userId: req.auth!.userId,
    consumedAt: null,
    expiresAt: { $gt: new Date() },
  });
  if (!change)
    throw new AppError(
      400,
      "CONTACT_CHALLENGE_INVALID",
      "Request a new verification code for this account.",
    );
  const verified = await verifyOtp(body.challengeId, body.code);
  if (verified.purpose !== "STEP_UP" || verified.phone !== change.phone)
    throw new AppError(
      400,
      "CONTACT_CHALLENGE_INVALID",
      "The verification challenge does not match this phone change.",
    );
  await mongoose.connection.transaction(async (session) => {
    // A competing signup may have claimed the number after the OTP request.
    if (await User.exists({ phone: change.phone, _id: { $ne: req.auth!.userId } }).session(session))
      throw new AppError(409, "CONTACT_UNAVAILABLE", "This contact detail is unavailable.");
    const claimed = await ProfileContactChange.findOneAndUpdate(
      { _id: change._id, userId: req.auth!.userId, consumedAt: null },
      { $set: { consumedAt: new Date() } },
      { session },
    );
    if (!claimed)
      throw new AppError(
        409,
        "CONTACT_CHALLENGE_USED",
        "This verification has already been used.",
      );
    await User.updateOne(
      { _id: req.auth!.userId },
      { $set: { phone: change.phone }, $inc: { version: 1 } },
      { session, runValidators: true },
    );
    await AuthIdentity.updateOne(
      { userId: req.auth!.userId, provider: "PHONE" },
      { $set: { providerSubject: change.phone, verifiedAt: new Date() } },
      { upsert: true, session },
    );
    await Session.updateMany(
      {
        userId: req.auth!.userId,
        publicId: { $ne: req.auth!.sessionId },
        revokedAt: null,
      },
      { $set: { revokedAt: new Date(), revokeReason: "PHONE_CHANGED" } },
      { session },
    );
    await DeviceToken.updateMany(
      {
        userId: req.auth!.userId,
        sessionId: { $ne: req.auth!.sessionId },
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
      { session },
    );
  });
  await writeAudit(req, {
    action: "profile.phone.changed",
    entityType: "User",
    entityId: req.auth!.userId,
  });
  res.json({ success: true, data: { verified: true } });
}
export async function changeEmail(req: Request, res: Response) {
  const body = z
    .object({ credential: z.string().min(30).max(10000) })
    .strict()
    .parse(req.body);
  if (!env.GOOGLE_CLIENT_ID)
    throw new AppError(
      503,
      "EMAIL_VERIFICATION_UNAVAILABLE",
      "Verified email changes require Google sign-in configuration. Contact support.",
    );
  let payload;
  try {
    payload = (
      await new OAuth2Client(env.GOOGLE_CLIENT_ID).verifyIdToken({
        idToken: body.credential,
        audience: env.GOOGLE_CLIENT_ID,
      })
    ).getPayload();
  } catch {
    throw new AppError(
      401,
      "EMAIL_VERIFICATION_FAILED",
      "Google could not verify this account. Try again.",
    );
  }
  if (!payload?.email_verified || !payload.email || !payload.sub)
    throw new AppError(
      401,
      "EMAIL_NOT_VERIFIED",
      "Use a verified Google email address.",
    );
  const email = normalizeEmail(payload.email),
    subject = payload.sub;
  await mongoose.connection.transaction(async (session) => {
    const conflict = await User.exists({
      email,
      _id: { $ne: req.auth!.userId },
    }).session(session);
    const identity = await AuthIdentity.findOne({
      provider: "GOOGLE",
      providerSubject: subject,
    }).session(session);
    if (conflict || (identity && String(identity.userId) !== req.auth!.userId))
      throw new AppError(
        409,
        "CONTACT_UNAVAILABLE",
        "This contact detail is unavailable.",
      );
    await User.updateOne(
      { _id: req.auth!.userId },
      { $set: { email }, $inc: { version: 1 } },
      { session, runValidators: true },
    );
    await AuthIdentity.updateOne(
      { userId: req.auth!.userId, provider: "PASSWORD" },
      { $set: { providerSubject: email } },
      { session },
    );
    if (!identity)
      await AuthIdentity.create(
        [
          {
            userId: req.auth!.userId,
            provider: "GOOGLE",
            providerSubject: subject,
            verifiedAt: new Date(),
          },
        ],
        { session },
      );
    // This flow replaces the account's Google sign-in identity; it is not a
    // silent secondary-account linking operation. Password sign-in is retained.
    await AuthIdentity.deleteMany(
      {
        userId: req.auth!.userId,
        provider: "GOOGLE",
        providerSubject: { $ne: subject },
      },
      { session },
    );
    await Session.updateMany(
      {
        userId: req.auth!.userId,
        publicId: { $ne: req.auth!.sessionId },
        revokedAt: null,
      },
      { $set: { revokedAt: new Date(), revokeReason: "EMAIL_CHANGED" } },
      { session },
    );
    await DeviceToken.updateMany(
      {
        userId: req.auth!.userId,
        sessionId: { $ne: req.auth!.sessionId },
        revokedAt: null,
      },
      { $set: { revokedAt: new Date() } },
      { session },
    );
  });
  await writeAudit(req, {
    action: "profile.email.changed",
    entityType: "User",
    entityId: req.auth!.userId,
  });
  res.json({ success: true, data: { verified: true } });
}
