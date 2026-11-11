import crypto from "node:crypto";
import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { env, isProduction } from "../config/env.js";
import { PaymentConnection, PaymentOAuthState } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { Session } from "../models/Auth.js";
import {
  buildRazorpayAuthorizeUrl,
  exchangeRazorpayAuthorizationCode,
  oauthConfigurationBlockers,
  revokeRazorpayOAuthToken,
} from "../integrations/payments/razorpayOAuthProvider.js";
import { decryptPaymentToken, encryptPaymentToken } from "../integrations/payments/paymentTokenCrypto.js";
import { membershipMerchantReadiness } from "../services/paymentMerchantService.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import { sessionExpiry } from "../services/sessionPolicy.js";

const oauthCookie = "gfu_rzp_oauth";
const callbackPath = "/api/v1/payments/razorpay/oauth/callback";

function returnLocation(path?: unknown) {
  const base = new URL(env.FRONTEND_URL || env.CLIENT_ORIGIN.split(",")[0]);
  const requested = typeof path === "string" ? path : "/owner/settings";
  if (!requested.startsWith("/owner/") && requested !== "/owner")
    throw new AppError(422, "RETURN_LOCATION_INVALID", "The payment return location is not allowed.");
  return new URL(requested, base).toString();
}

function publicConnection(connection: any) {
  if (!connection) return null;
  const value = connection.toObject ? connection.toObject() : { ...connection };
  for (const key of [
    "accessTokenCiphertext", "refreshTokenCiphertext", "tokenFingerprint",
    "tokenRefreshLeaseId", "tokenRefreshLeaseUntil", "publicToken",
  ]) delete value[key];
  return value;
}

export async function beginGymRazorpayConnection(req: Request, res: Response) {
  const blocker = oauthConfigurationBlockers()[0];
  if (blocker) throw new AppError(503, "RAZORPAY_OAUTH_NOT_CONFIGURED", blocker);
  const gym = await Gym.findOne({
    publicId: req.params.gymId,
    _id: req.auth!.gymId,
    ownerId: req.auth!.userId,
    deletedAt: null,
  }).lean();
  if (!gym) throw new AppError(403, "GYM_OWNERSHIP_REQUIRED", "Only this gym's owner can connect its merchant account.");

  const state = crypto.randomBytes(32).toString("base64url");
  const browserNonce = crypto.randomBytes(32).toString("base64url");
  const returnTo = returnLocation(req.body?.returnTo);
  await PaymentOAuthState.create({
    publicId: nanoid(24),
    stateHash: sha256(state),
    browserNonceHash: sha256(browserNonce),
    ownerId: req.auth!.userId,
    gymId: gym._id,
    sessionId: req.auth!.sessionId,
    environment: env.RAZORPAY_MODE.toUpperCase(),
    returnTo,
    expiresAt: new Date(Date.now() + 10 * 60_000),
  });
  res.cookie(oauthCookie, browserNonce, {
    httpOnly: true,
    secure: isProduction,
    sameSite: "lax",
    domain: env.COOKIE_DOMAIN,
    path: callbackPath,
    maxAge: 10 * 60_000,
  });
  res.status(201).json({
    success: true,
    data: { authorizationUrl: buildRazorpayAuthorizeUrl(state), expiresInSeconds: 600 },
  });
}

function redirectResult(res: Response, returnTo: string, status: string, reference?: string) {
  const url = new URL(returnTo);
  url.searchParams.set("razorpay", status);
  if (reference) url.searchParams.set("reference", reference);
  return res.redirect(303, url.toString());
}

export async function completeGymRazorpayConnection(req: Request, res: Response) {
  const state = String(req.query.state || "");
  const browserNonce = String(req.cookies?.[oauthCookie] || "");
  if (!state || !browserNonce)
    throw new AppError(403, "RAZORPAY_OAUTH_STATE_INVALID", "This Razorpay authorization cannot be verified. Start again.");
  const pending: any = await PaymentOAuthState.findOne({
    stateHash: sha256(state),
    status: "PENDING",
    expiresAt: { $gt: new Date() },
  }).select("+stateHash +browserNonceHash");
  if (!pending || pending.browserNonceHash !== sha256(browserNonce))
    throw new AppError(403, "RAZORPAY_OAUTH_STATE_INVALID", "This Razorpay authorization cannot be verified. Start again.");
  const initiatingSession = await Session.findOne({
    publicId: pending.sessionId,
    userId: pending.ownerId,
    revokedAt: null,
  });
  if (!initiatingSession || sessionExpiry(initiatingSession) <= new Date()) {
    await PaymentOAuthState.updateOne(
      { _id: pending._id, status: "PENDING" },
      { $set: { status: "FAILED", failureCode: "INITIATING_SESSION_EXPIRED", consumedAt: new Date() } },
    );
    throw new AppError(401, "RAZORPAY_OAUTH_SESSION_EXPIRED", "The session that started this connection expired. Sign in and start again.");
  }

  const claimed: any = await PaymentOAuthState.findOneAndUpdate(
    { _id: pending._id, status: "PENDING", consumedAt: { $exists: false } },
    { $set: { status: "PROCESSING", consumedAt: new Date() } },
    { returnDocument: "after" },
  );
  if (!claimed) throw new AppError(409, "RAZORPAY_OAUTH_STATE_REPLAYED", "This Razorpay authorization was already used.");
  res.clearCookie(oauthCookie, { domain: env.COOKIE_DOMAIN, path: callbackPath });

  if (req.query.error) {
    claimed.status = "DENIED";
    claimed.failureCode = String(req.query.error).slice(0, 100);
    await claimed.save();
    return redirectResult(res, claimed.returnTo, "denied", claimed.publicId);
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  if (!code) {
    claimed.status = "FAILED";
    claimed.failureCode = "AUTHORIZATION_CODE_MISSING";
    await claimed.save();
    return redirectResult(res, claimed.returnTo, "failed", claimed.publicId);
  }

  let issuedAccessToken: string | undefined;
  let savedConnectionId: string | undefined;
  try {
    // Express has already decoded the query string. Do not decode the code a second time.
    const tokens = await exchangeRazorpayAuthorizationCode(code);
    issuedAccessToken = tokens.access_token;
    const merchantAccountId = String(tokens.razorpay_account_id || "");
    const expectedPublicPrefix = env.RAZORPAY_MODE === "live" ? "rzp_live_oauth_" : "rzp_test_oauth_";
    if (!/^acc_[A-Za-z0-9]+$/.test(merchantAccountId) ||
        !String(tokens.public_token || "").startsWith(expectedPublicPrefix) ||
        !tokens.access_token || !tokens.refresh_token)
      throw new AppError(502, "RAZORPAY_OAUTH_RESPONSE_INVALID", "Razorpay returned incomplete merchant authorization data.");
    if (env.RAZORPAY_PLATFORM_ACCOUNT_ID && merchantAccountId === env.RAZORPAY_PLATFORM_ACCOUNT_ID)
      throw new AppError(409, "PLATFORM_MERCHANT_NOT_ALLOWED", "The GETFIT4U platform merchant cannot be connected as a gym seller.");
    const collision = await PaymentConnection.findOne({
      merchantAccountId,
      provider: "RAZORPAY",
      environment: claimed.environment,
      gymId: { $ne: claimed.gymId },
    }).lean();
    if (collision)
      throw new AppError(409, "RAZORPAY_MERCHANT_ALREADY_BOUND", "This Razorpay merchant is already bound to another verified gym scope.");

    const [gym, owner] = await Promise.all([
      Gym.findById(claimed.gymId).lean(),
      User.findById(claimed.ownerId).lean(),
    ]);
    if (!gym || !owner) throw new AppError(409, "OAUTH_OWNER_CONTEXT_MISSING", "The gym owner context is no longer active.");
    const businessContactEmail = gym.contact?.email || owner.email;
    if (!businessContactEmail)
      throw new AppError(409, "GYM_PAYMENT_CONTACT_REQUIRED", "Add a verified gym or owner email before connecting Razorpay.");
    let connection: any = await PaymentConnection.findOne({
      gymId: claimed.gymId,
      provider: "RAZORPAY",
      environment: claimed.environment,
    });
    if (!connection) connection = new PaymentConnection({
      publicId: nanoid(20),
      gymId: claimed.gymId,
      authorizedOwnerId: claimed.ownerId,
      provider: "RAZORPAY",
      environment: claimed.environment,
      businessLegalName: gym.name,
      businessContactEmail,
      businessContactPhone: gym.contact?.phone || owner.phone,
    });
    if (!connection.isNew) connection.connectionRevision = Number(connection.connectionRevision || 0) + 1;
    connection.connectionType = "OAUTH_MERCHANT";
    connection.authorizedOwnerId = claimed.ownerId;
    connection.merchantAccountId = merchantAccountId;
    connection.publicToken = tokens.public_token;
    connection.authorizationStatus = "CONNECTED";
    connection.onboardingStatus = "PENDING";
    connection.paymentEligibilityStatus = "UNKNOWN";
    connection.settlementReadinessStatus = "UNKNOWN";
    connection.qrCapability = "UNKNOWN";
    connection.collectionEnabled = false;
    connection.connectedAt = new Date();
    connection.revokedAt = undefined;
    connection.disconnectedAt = undefined;
    connection.tokenEncryptionKeyVersion = env.PAYMENT_TOKEN_ENCRYPTION_KEY_VERSION;
    const expiresIn = Number(tokens.expires_in);
    connection.accessTokenExpiresAt = new Date(Date.now() + expiresIn * 1000);
    connection.refreshTokenExpiresAt = new Date(Date.now() + 180 * 86_400_000);
    await connection.save();
    connection.accessTokenCiphertext = encryptPaymentToken(tokens.access_token, String(connection._id), "access");
    connection.refreshTokenCiphertext = encryptPaymentToken(tokens.refresh_token, String(connection._id), "refresh");
    connection.tokenFingerprint = sha256(tokens.access_token);
    await connection.save({ validateBeforeSave: false });
    savedConnectionId = String(connection._id);
    claimed.status = "COMPLETED";
    await claimed.save();
    return redirectResult(res, claimed.returnTo, "connected", claimed.publicId);
  } catch (error: any) {
    if (issuedAccessToken) await revokeRazorpayOAuthToken(issuedAccessToken).catch(() => undefined);
    if (savedConnectionId) await PaymentConnection.updateOne(
      { _id: savedConnectionId },
      { $set: { authorizationStatus: "ACTION_REQUIRED", collectionEnabled: false, onboardingStatus: "ACTION_REQUIRED" } },
    ).catch(() => undefined);
    claimed.status = "FAILED";
    claimed.failureCode = String(error?.code || "RAZORPAY_OAUTH_FAILED").slice(0, 100);
    await claimed.save();
    if (error instanceof AppError) throw error;
    throw new AppError(502, "RAZORPAY_OAUTH_FAILED", `Razorpay authorization failed. Reference ${claimed.publicId}.`);
  }
}

export async function gymRazorpayStatus(req: Request, res: Response) {
  const gym = await Gym.findOne({ publicId: req.params.gymId, _id: req.auth!.gymId }).lean();
  if (!gym) throw new AppError(403, "GYM_CONTEXT_CHANGED", "Select the requested gym before viewing payment settings.");
  const readiness = await membershipMerchantReadiness(String(gym._id));
  res.json({ success: true, data: {
    connection: publicConnection(readiness.connection),
    onlineMembershipPaymentsAvailable: readiness.available,
    blockers: readiness.blockers,
    provider: readiness.provider,
    environment: readiness.environment,
    qrEnabled: env.RAZORPAY_GYM_QR_ENABLED && readiness.connection?.qrCapability === "ENABLED",
  } });
}

export async function disconnectGymRazorpay(req: Request, res: Response) {
  const gym = await Gym.findOne({ publicId: req.params.gymId, _id: req.auth!.gymId, ownerId: req.auth!.userId }).lean();
  if (!gym) throw new AppError(403, "GYM_OWNERSHIP_REQUIRED", "Only this gym's owner can disconnect its merchant account.");
  const connection: any = await PaymentConnection.findOne({
    gymId: gym._id,
    provider: "RAZORPAY",
    environment: env.RAZORPAY_MODE.toUpperCase(),
    connectionType: "OAUTH_MERCHANT",
  }).select("+accessTokenCiphertext");
  if (!connection) throw new AppError(404, "PAYMENT_CONNECTION_NOT_FOUND", "Razorpay connection not found.");
  if (connection.accessTokenCiphertext) {
    const token = decryptPaymentToken(connection.accessTokenCiphertext, String(connection._id), "access");
    await revokeRazorpayOAuthToken(token);
  }
  connection.authorizationStatus = "DISCONNECTED";
  connection.onboardingStatus = "DISABLED";
  connection.collectionEnabled = false;
  connection.disconnectedAt = new Date();
  connection.disconnectedBy = req.auth!.userId;
  connection.accessTokenCiphertext = undefined;
  connection.refreshTokenCiphertext = undefined;
  connection.tokenFingerprint = undefined;
  await connection.save({ validateBeforeSave: false });
  res.json({ success: true, data: publicConnection(connection), message: "Razorpay disconnected. Historical payments remain available." });
}
