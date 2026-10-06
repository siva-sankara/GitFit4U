import { DeviceToken } from "../models/Collaboration.js";
import type { Request, Response } from "express";
import { emitDomainEvent } from "../services/domainEventService.js";
import mongoose from "mongoose";
import { OAuth2Client } from "google-auth-library";
import { withUserMedia } from "../services/userMediaService.js";
import bcrypt from "bcrypt";
import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import {
  AuthIdentity,
  OtpChallenge,
  PendingAuthOperation,
  PasswordResetGrant,
  RoleAssignment,
  Session,
} from "../models/Auth.js";
import { User } from "../models/User.js";
import {
  normalizePhone,
  invalidateOtpOperation,
  requestOtp,
  verifyOtp,
} from "../services/otpService.js";
import {
  clearRefreshCookie,
  createSession,
  rotateRefreshToken,
  setRefreshCookie,
  signAccessToken,
} from "../services/tokenService.js";
import { AppError } from "../utils/AppError.js";
import { ROLES, type Role } from "../constants/domain.js";
import { sha256 } from "../utils/crypto.js";
import { publicSignupInput } from "../routes/authSchemas.js";
import { duplicateAccountError, isDuplicateKey, normalizeEmail } from "../utils/accountIdentity.js";
import { getOwnerOnboarding } from "../services/ownerOnboardingService.js";

const googleClient = new OAuth2Client(env.GOOGLE_CLIENT_ID);

async function loginResponse(
  req: Request,
  res: Response,
  user: InstanceType<typeof User>,
) {
  let role = (user.activeRole || "USER") as Role;
  let hasAccess = ROLES.includes(role) && user.roles?.includes(role);
  let activeGymId: string | undefined;
  // Prefer an established active gym over an old incomplete draft when the
  // account has multiple owner assignments and no explicit tenant selection.
  const onboarding = await getOwnerOnboarding(user);
  if (hasAccess && ["GYM_OWNER", "GYM_STAFF", "TRAINER"].includes(role)) {
    const assignment = await RoleAssignment.findOne({
      userId: user._id,
      role,
      status: "ACTIVE",
      gymId: role === "GYM_OWNER" && onboarding?.state === "ACTIVE" && onboarding.gymId
        ? onboarding.gymId : { $ne: null },
    });
    activeGymId = assignment?.gymId ? String(assignment.gymId) : undefined;
    if (role === "GYM_OWNER" && onboarding?.state === "ACTIVE" && !activeGymId)
      throw new AppError(403, "ROLE_ACCESS_UNAVAILABLE", "Your gym access is unavailable. Contact support to restore access.");
    // A self-registered owner may hold an onboarding session without a gym.
    // Tenant permissions still require a current assignment in requireAuth.
    hasAccess = role === "GYM_OWNER" || Boolean(activeGymId);
  }
  if (!hasAccess) {
    // A removed role must never select another privileged role implicitly.
    if (!user.roles?.includes("USER")) {
      throw new AppError(
        403,
        "ROLE_ACCESS_UNAVAILABLE",
        "Your account has no active access for this role. Contact support to restore access.",
      );
    }
    role = "USER";
    activeGymId = undefined;
  }
  const tokens = await createSession({
    userId: String(user._id),
    activeRole: role,
    activeGymId,
    userAgent: req.header("user-agent"),
    ip: req.ip,
  });
  user.activeRole = role;
  user.lastLoginAt = new Date();
  await user.save();
  setRefreshCookie(res, tokens.refreshToken);
  res.json({
    success: true,
    data: {
      accessToken: tokens.accessToken,
      user: {
        id: user.publicId,
        name: user.name,
        phone: user.phone,
        email: user.email,
        avatarUrl: user.avatarUrl,
        roles: user.roles,
        activeRole: role,
        activeGymId,
        onboarding: role === "GYM_OWNER" ? await getOwnerOnboarding(user, activeGymId) : onboarding,
      },
    },
  });
}

export async function register(req: Request, res: Response) {
  const body = publicSignupInput.parse(req.body);
  const { email, phone, role } = body;
  const exists = await User.exists({
    $or: [{ email }, ...(phone ? [{ phone }] : [])],
  });
  if (exists) throw duplicateAccountError();
  const passwordHash = await bcrypt.hash(body.password, 12);
  const now = new Date();
  await PendingAuthOperation.updateMany(
    {
      type: "SIGNUP",
      status: "PENDING",
      $or: [{ email }, { phone }],
    },
    { $set: { status: "CANCELLED" } },
  );
  const operation = await PendingAuthOperation.create({
    publicId: nanoid(24),
    type: "SIGNUP",
    name: body.name,
    email,
    phone,
    role,
    passwordHash,
    expiresAt: new Date(now.getTime() + 30 * 60_000),
    purgeAt: new Date(now.getTime() + 24 * 60 * 60_000),
  });
  try {
    const challenge = await requestOtp(phone, "SIGNUP", {
      ipAddress: req.ip,
      pendingOperationId: operation._id,
    });
    res.status(202).json({
      success: true,
      message: "The verification code was submitted to Meta for WhatsApp delivery.",
      data: { ...challenge, operationId: operation.publicId, purpose: "SIGNUP" },
    });
  } catch (error) {
    await PendingAuthOperation.updateOne(
      { _id: operation._id, status: "PENDING" },
      { $set: { status: "CANCELLED" } },
    );
    throw error;
  }
}

function invalidSignupOperation() {
  return new AppError(
    400,
    "SIGNUP_OPERATION_INVALID",
    "This signup verification has expired or is no longer valid. Start again.",
  );
}

export async function resendSignupOtp(req: Request, res: Response) {
  const operation = await PendingAuthOperation.findOne({
    publicId: req.body.operationId,
    type: "SIGNUP",
    status: "PENDING",
    expiresAt: { $gt: new Date() },
  });
  if (!operation) throw invalidSignupOperation();
  const challenge = await requestOtp(operation.phone, "SIGNUP", {
    ipAddress: req.ip,
    pendingOperationId: operation._id,
  });
  res.status(202).json({
    success: true,
    message: "A new verification code was submitted to Meta for WhatsApp delivery.",
    data: { ...challenge, operationId: operation.publicId, purpose: "SIGNUP" },
  });
}

export async function cancelSignup(req: Request, res: Response) {
  const operation = await PendingAuthOperation.findOneAndUpdate(
    {
      publicId: req.body.operationId,
      type: "SIGNUP",
      status: "PENDING",
    },
    { $set: { status: "CANCELLED" } },
    { returnDocument: "after" },
  );
  if (operation) await invalidateOtpOperation(operation._id);
  res.status(204).send();
}

export async function verifySignupOtp(req: Request, res: Response) {
  const pending = await PendingAuthOperation.findOne({
    publicId: req.body.operationId,
    type: "SIGNUP",
    status: "PENDING",
    expiresAt: { $gt: new Date() },
  });
  if (!pending) throw invalidSignupOperation();
  const verified = await verifyOtp(req.body.challengeId, req.body.code, {
    expectedPurpose: "SIGNUP",
    pendingOperationId: pending._id,
  });
  if (verified.phone !== pending.phone) throw invalidSignupOperation();
  const user = await mongoose.connection
    .transaction(async (session) => {
      const operation = await PendingAuthOperation.findOne({
        publicId: req.body.operationId,
        type: "SIGNUP",
        status: "PENDING",
        expiresAt: { $gt: new Date() },
      })
        .select("+passwordHash")
        .session(session);
      if (!operation) throw invalidSignupOperation();
      const exists = await User.exists({
        $or: [{ email: operation.email }, { phone: operation.phone }],
      }).session(session);
      if (exists) throw duplicateAccountError();
      const claimed = await PendingAuthOperation.findOneAndUpdate(
        { _id: operation._id, status: "PENDING" },
        { $set: { status: "COMPLETED", completedAt: new Date() } },
        { session, returnDocument: "after" },
      );
      if (!claimed) throw invalidSignupOperation();
      const [created] = await User.create(
        [
          {
            publicId: nanoid(18),
            name: operation.name,
            email: operation.email,
            phone: operation.phone,
            roles: [operation.role],
            activeRole: operation.role,
            status: "ACTIVE",
          },
        ],
        { session },
      );
      await AuthIdentity.create(
        [
          {
            userId: created._id,
            provider: "PASSWORD",
            providerSubject: operation.email,
            verifiedAt: new Date(),
            passwordHash: operation.passwordHash,
          },
          {
            userId: created._id,
            provider: "PHONE",
            providerSubject: operation.phone,
            verifiedAt: new Date(),
          },
        ],
        { session },
      );
      await emitDomainEvent({
        event: "account.registered",
        userId: created._id,
        entityId: created.publicId,
        session,
      });
      return created;
    })
    .catch((error: unknown) => {
      if (isDuplicateKey(error)) throw duplicateAccountError();
      throw error;
    });
  user.$session(null);
  await loginResponse(req, res, user);
}

export async function passwordLogin(req: Request, res: Response) {
  const identifier = normalizeEmail(req.body.identifier);
  // Password identities use email as their subject. Resolve phone aliases through the user.
  let identity;
  if (identifier.includes("@")) {
    identity = await AuthIdentity.findOne({
      provider: "PASSWORD",
      providerSubject: identifier,
    }).select("+passwordHash");
  } else {
    const phone = normalizePhone(identifier);
    const account = await User.findOne({ phone: { $in: [phone, identifier] } });
    identity = account
      ? await AuthIdentity.findOne({
          provider: "PASSWORD",
          userId: account._id,
        }).select("+passwordHash")
      : null;
  }
  const valid = identity?.passwordHash
    ? await bcrypt.compare(req.body.password, identity.passwordHash)
    : false;
  if (!identity || !valid)
    throw new AppError(
      401,
      "INVALID_CREDENTIALS",
      "Email/phone or password is incorrect.",
    );
  const user = await User.findById(identity.userId);
  if (!user || user.status !== "ACTIVE")
    throw new AppError(403, "ACCOUNT_DISABLED", "This account is not active.");
  await loginResponse(req, res, user);
}

export async function forgotPassword(req: Request, res: Response) {
  const result = await requestOtp(req.body.phone, "ACCOUNT_RECOVERY", {
    ipAddress: req.ip,
  });
  res.status(202).json({
    success: true,
    message: "If the account exists, a verification code was sent.",
    data: result,
  });
}

export async function verifyRecoveryOtp(req: Request, res: Response) {
  const verified = await verifyOtp(req.body.challengeId, req.body.code, {
    expectedPurpose: "ACCOUNT_RECOVERY",
  });
  const secret = crypto.randomBytes(48).toString("base64url");
  const publicId = nanoid(20);
  const token = `${publicId}.${secret}`;
  await mongoose.connection.transaction(async (session) => {
    // Recheck the verified phone while taking the same account write lock as
    // contact edits. An old phone cannot mint a grant after it was replaced.
    const user = await User.findOneAndUpdate(
      { phone: verified.phone, status: "ACTIVE" },
      { $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    if (!user)
      throw new AppError(
        400,
        "RECOVERY_FAILED",
        "Account recovery could not be completed.",
      );
    await PasswordResetGrant.create(
      [
        {
          publicId,
          userId: user._id,
          tokenHash: sha256(token),
          expiresAt: new Date(Date.now() + 10 * 60_000),
        },
      ],
      { session },
    );
  });
  res.json({
    success: true,
    data: { resetToken: token, expiresInSeconds: 600 },
  });
}

export async function resetPassword(req: Request, res: Response) {
  const [publicId] = req.body.resetToken.split(".");
  const tokenHash = sha256(req.body.resetToken);
  const invalidGrant = () =>
    new AppError(
      400,
      "RESET_TOKEN_INVALID",
      "This password reset link is invalid or expired.",
    );
  if (
    !(await PasswordResetGrant.exists({
      publicId,
      tokenHash,
      consumedAt: null,
      expiresAt: { $gt: new Date() },
    }))
  )
    throw invalidGrant();
  // Do the expensive hash once, outside the retryable database transaction.
  const passwordHash = await bcrypt.hash(req.body.password, 12);
  await mongoose.connection.transaction(async (session) => {
    const grant = await PasswordResetGrant.findOneAndUpdate(
      { publicId, tokenHash, consumedAt: null, expiresAt: { $gt: new Date() } },
      { $set: { consumedAt: new Date() } },
      { session, returnDocument: "after" },
    );
    if (!grant) throw invalidGrant();
    // The common User write serializes resets with administrative identity,
    // account-status and role changes, including resets already in flight.
    const user = await User.findOneAndUpdate(
      { _id: grant.userId, status: "ACTIVE" },
      { $inc: { version: 1 } },
      { session, returnDocument: "after" },
    );
    if (!user || !(user.email || user.phone)) throw invalidGrant();
    await AuthIdentity.findOneAndUpdate(
      { userId: user._id, provider: "PASSWORD" },
      {
        $set: {
          providerSubject: user.email || user.phone,
          passwordHash,
          verifiedAt: new Date(),
        },
      },
      { session, upsert: true, returnDocument: "after", runValidators: true },
    );
    await PasswordResetGrant.updateMany(
      { userId: user._id, consumedAt: null },
      { $set: { consumedAt: new Date() } },
      { session },
    );
    await Session.updateMany(
      { userId: user._id, revokedAt: null },
      { $set: { revokedAt: new Date(), revokeReason: "PASSWORD_RESET" } },
      { session },
    );
  });
  clearRefreshCookie(res);
  res.json({
    success: true,
    message: "Password reset successful.",
    data: null,
  });
}

export async function otpRequest(req: Request, res: Response) {
  const result = await requestOtp(req.body.phone, "LOGIN", {
    ipAddress: req.ip,
  });
  res.status(202).json({
    success: true,
    message: "If eligible, the verification code was submitted to Meta for WhatsApp delivery.",
    data: { ...result, purpose: "LOGIN" },
  });
}

export async function otpStatus(req: Request, res: Response) {
  const challenge = await OtpChallenge.findOne({
    publicId: req.params.challengeId,
  })
    .select("deliveryStatus expiresAt")
    .lean();
  const expired = !challenge || challenge.expiresAt <= new Date();
  res.json({
    success: true,
    data: {
      deliveryStatus: expired
        ? "EXPIRED"
        : challenge.deliveryStatus || "SUBMITTED",
      expired,
    },
  });
}

export async function otpVerify(req: Request, res: Response) {
  const verified = await verifyOtp(req.body.challengeId, req.body.code, {
    expectedPurpose: "LOGIN",
  });
  const accountCount = await User.countDocuments({ phone: verified.phone });
  if (accountCount > 1)
    throw new AppError(
      409,
      "PHONE_ACCOUNT_CONFLICT",
      "This verified phone number is linked to multiple legacy accounts. Contact support; accounts are never merged automatically.",
    );
  const user = await User.findOne({ phone: verified.phone });
  if (!user) {
    throw new AppError(409, "SIGNUP_REQUIRED", "Complete sign up with your account type, email and mobile number before signing in.");
  }
  if (user.status !== "ACTIVE")
    throw new AppError(403, "ACCOUNT_DISABLED", "This account is not active.");
  if (user.roles?.includes("ADMIN"))
    throw new AppError(
      403,
      "ADMIN_OTP_LOGIN_FORBIDDEN",
      "Administrator accounts must use the existing privileged sign-in and MFA flow.",
    );
  const existingPhoneIdentity = await AuthIdentity.findOne({
    provider: "PHONE",
    providerSubject: verified.phone,
  });
  if (
    existingPhoneIdentity &&
    String(existingPhoneIdentity.userId) !== String(user._id)
  )
    throw new AppError(
      409,
      "PHONE_ACCOUNT_CONFLICT",
      "This verified phone identity is linked to another account. Contact support; accounts are never merged automatically.",
    );
  await AuthIdentity.findOneAndUpdate(
    { userId: user._id, provider: "PHONE" },
    {
      $set: {
        providerSubject: verified.phone,
        verifiedAt: new Date(),
      },
    },
    { upsert: true, returnDocument: "after", runValidators: true },
  );
  if (!existingPhoneIdentity)
    await emitDomainEvent({
      event: "account.verified",
      userId: user._id,
      entityId: user.publicId,
    });
  await loginResponse(req, res, user);
}

export async function googleLogin(req: Request, res: Response) {
  if (!env.GOOGLE_CLIENT_ID)
    throw new AppError(
      503,
      "GOOGLE_AUTH_NOT_CONFIGURED",
      "Google sign-in is unavailable.",
    );
  const ticket = await googleClient.verifyIdToken({
    idToken: req.body.idToken,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email || !payload.email_verified) {
    throw new AppError(
      401,
      "GOOGLE_IDENTITY_INVALID",
      "Google could not verify this account.",
    );
  }
  let identity = await AuthIdentity.findOne({
    provider: "GOOGLE",
    providerSubject: payload.sub,
  });
  let user = identity ? await User.findById(identity.userId) : null;
  if (!user) {
    const emailOwner = await User.findOne({
      email: normalizeEmail(payload.email),
    });
    if (emailOwner) {
      throw new AppError(
        409,
        "ACCOUNT_LINK_REQUIRED",
        "Verify your existing account before linking Google.",
      );
    }
    throw new AppError(409, "SIGNUP_REQUIRED", "Complete sign up with your account type, email and mobile number before signing in.");
  }
  if (user.status !== "ACTIVE")
    throw new AppError(403, "ACCOUNT_DISABLED", "This account is not active.");
  await emitDomainEvent({
    event: "account.verified",
    userId: user._id,
    entityId: user.publicId,
  });
  await loginResponse(req, res, user);
}

export async function refresh(req: Request, res: Response) {
  const token = req.cookies?.gfu_refresh;
  if (!token)
    throw new AppError(401, "REFRESH_REQUIRED", "Please sign in again.");
  const rotated = await rotateRefreshToken(token);
  setRefreshCookie(res, rotated.refreshToken);
  res.json({ success: true, data: { accessToken: rotated.accessToken } });
}

export async function logout(req: Request, res: Response) {
  const token = req.cookies?.gfu_refresh;
  const sessionId = typeof token === "string" ? token.split(".")[0] : undefined;
  // A public session identifier alone is not proof that the caller owns it.
  const session = sessionId
    ? await Session.findOneAndUpdate(
        { publicId: sessionId, revokedAt: null, $or: [
          { refreshTokenHash: sha256(token) },
          { previousRefreshTokenHash: sha256(token), refreshGraceUntil: { $gt: new Date() } },
        ] },
        { $set: { revokedAt: new Date(), revokeReason: "LOGOUT" } },
        { returnDocument: "after" },
      ).select("publicId userId").lean()
    : null;
  if (session)
    await DeviceToken.updateMany(
      { sessionId: session.publicId, userId: session.userId, revokedAt: null },
      { $set: { revokedAt: new Date() } },
    );
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function logoutAll(req: Request, res: Response) {
  await DeviceToken.updateMany(
    { userId: req.auth!.userId, revokedAt: null },
    { $set: { revokedAt: new Date() } },
  );
  await Session.updateMany(
    { userId: req.auth!.userId, revokedAt: null },
    { revokedAt: new Date(), revokeReason: "LOGOUT_ALL" },
  );
  clearRefreshCookie(res);
  res.status(204).send();
}

export async function me(req: Request, res: Response) {
  const [user, assignments] = await Promise.all([
    User.findById(req.auth!.userId).lean(),
    RoleAssignment.find({ userId: req.auth!.userId, status: "ACTIVE" })
      .populate("gymId", "publicId name status")
      .lean(),
  ]);
  res.json({ success: true, data: { user: user ? { ...(await withUserMedia([user]))[0], onboarding: await getOwnerOnboarding(user, req.auth?.gymId) } : null, assignments, context: req.auth } });
}

export async function switchRole(req: Request, res: Response) {
  const role = req.body.role as Role;
  let gymId = req.body.gymId as string | undefined;
  const user = await User.findById(req.auth!.userId);
  if (!user || !user.roles.includes(role))
    throw new AppError(
      403,
      "ROLE_FORBIDDEN",
      "This role is not assigned to you.",
    );
  if (role === "GYM_OWNER" && !gymId) {
    const onboarding = await getOwnerOnboarding(user);
    if (onboarding?.state === "ACTIVE") gymId = onboarding.gymId;
  }
  if (["GYM_STAFF", "TRAINER"].includes(role) || (role === "GYM_OWNER" && gymId)) {
    const assignment = await RoleAssignment.findOne({
      userId: user._id,
      role,
      gymId,
      status: "ACTIVE",
    });
    if (!assignment)
      throw new AppError(
        403,
        "GYM_ACCESS_DENIED",
        "You do not have access to this gym.",
      );
  }
  const session = await Session.findOne({
    publicId: req.auth!.sessionId,
    userId: user._id,
  });
  if (!session)
    throw new AppError(401, "SESSION_EXPIRED", "Please sign in again.");
  session.activeRole = role;
  session.activeGymId = ["GYM_OWNER", "GYM_STAFF", "TRAINER"].includes(role)
    ? gymId
    : undefined;
  await session.save();
  user.activeRole = role;
  await user.save();
  res.json({
    success: true,
    data: {
      accessToken: signAccessToken(String(user._id), session.publicId),
      activeRole: role,
      activeGymId: session.activeGymId ? String(session.activeGymId) : undefined,
      onboarding: await getOwnerOnboarding(user, gymId),
    },
  });
}

export async function sessions(req: Request, res: Response) {
  const data = await Session.find({ userId: req.auth!.userId, revokedAt: null })
    .select(
      "publicId activeRole activeGymId device lastUsedAt createdAt expiresAt",
    )
    .sort({ lastUsedAt: -1 })
    .lean();
  res.json({ success: true, data });
}

export async function revokeSession(req: Request, res: Response) {
  await Session.updateOne(
    { publicId: req.params.sessionId, userId: req.auth!.userId },
    { revokedAt: new Date(), revokeReason: "USER_REVOKED" },
  );
  res.status(204).send();
}
