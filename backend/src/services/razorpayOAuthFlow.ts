import crypto from "node:crypto";
import mongoose from "mongoose";
import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { oauthHttpUrl, oauthOriginsMixLocalAndPublic, razorpayAttemptTtlMs, razorpayCallbackPath, razorpayResultPath, razorpayOAuthFlowVersion } from "../config/razorpayOAuth.js";
import { PaymentConnection, PaymentOAuthState } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { User } from "../models/User.js";
import { RoleAssignment, Session } from "../models/Auth.js";
import { buildRazorpayAuthorizeUrl, exchangeRazorpayAuthorizationCode, oauthConfigurationBlockers, revokeRazorpayOAuthToken } from "../integrations/payments/razorpayOAuthProvider.js";
import { encryptPaymentToken } from "../integrations/payments/paymentTokenCrypto.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import { sessionExpiry } from "./sessionPolicy.js";

const randomValue = /^[A-Za-z0-9_-]{43}$/;
const cookieName = (stateHash: string) => `gfu_rzp_oauth_${stateHash.slice(0, 24)}`;

function logResult(req: Request, reason: string, attempt?: any) {
  // Never include the request/query, provider error body, state or credentials.
  logger.info({ event: "razorpay_oauth", reason, requestId: req.requestId,
    attemptId: attempt?.publicId, initiationRequestId: attempt?.initiationRequestId }, "Razorpay OAuth result");
}

function result(req: Request, res: Response, status: string, reason: string, attempt?: any) {
  logResult(req, reason, attempt);
  const target = new URL(razorpayResultPath, env.FRONTEND_URL!);
  target.searchParams.set("status", status);
  if (attempt) target.searchParams.set("reference", attempt.publicId);
  if (req.requestId) target.searchParams.set("requestId", req.requestId);
  return res.redirect(303, target.toString());
}

function browserContext(req: Request) {
  const frontend = new URL(env.FRONTEND_URL!);
  const callback = new URL(env.RAZORPAY_OAUTH_REDIRECT_URI!);
  // Origin survives a same-origin reverse proxy; its upstream Host may not.
  if (req.get("origin") !== frontend.origin)
    throw new AppError(409, "RAZORPAY_OAUTH_ORIGIN_MISMATCH", "Open the website configured in FRONTEND_URL before connecting Razorpay.");
  if (oauthOriginsMixLocalAndPublic(frontend, callback))
    throw new AppError(409, "RAZORPAY_OAUTH_ENVIRONMENT_MISMATCH", "Local and deployed Razorpay settings are mixed. Use a local callback for localhost, or start from the deployed website with its backend configuration.",
      { configurationVariables: ["FRONTEND_URL", "RAZORPAY_OAUTH_REDIRECT_URI"] });
  const value = req.body?.browserApiOrigin || frontend.origin;
  const api = typeof value === "string" ? oauthHttpUrl(value, env.NODE_ENV === "production") : undefined;
  const allowed = new Set([frontend.origin, callback.origin]);
  if (env.BACKEND_PUBLIC_URL) allowed.add(new URL(env.BACKEND_PUBLIC_URL).origin);
  if (!api || api.pathname !== "/" || !allowed.has(api.origin))
    throw new AppError(409, "RAZORPAY_OAUTH_ORIGIN_MISMATCH", "The browser API origin does not match the configured website or payment callback. Check the API proxy settings.");
  return { frontendOrigin: frontend.origin, browserApiOrigin: api.origin };
}

export async function beginGymRazorpayConnection(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  const blocker = oauthConfigurationBlockers()[0];
  if (blocker) throw new AppError(503, "RAZORPAY_OAUTH_NOT_CONFIGURED", blocker);
  if (!req.auth || req.auth.role !== "GYM_OWNER" || !req.auth.permissions.includes("gym:update"))
    throw new AppError(403, "GYM_OWNERSHIP_REQUIRED", "Only this gym's owner can connect its merchant account.");
  if (!req.idempotencyKey) throw new AppError(400, "IDEMPOTENCY_KEY_REQUIRED", "A connection request key is required.");
  const context = browserContext(req);
  const gym = await Gym.findOne({ publicId: req.params.gymId, _id: req.auth.gymId,
    ownerId: req.auth.userId, deletedAt: null }).lean();
  if (!gym) throw new AppError(403, "GYM_OWNERSHIP_REQUIRED", "Only this gym's owner can connect its merchant account.");
  const previous = await PaymentConnection.findOne({ gymId: gym._id, provider: "RAZORPAY", environment: env.RAZORPAY_MODE.toUpperCase() }).lean();
  const state = crypto.randomBytes(32).toString("base64url");
  const nonce = crypto.randomBytes(32).toString("base64url");
  const stateHash = sha256(state);
  const key = sha256(JSON.stringify([req.auth.sessionId, req.auth.userId, String(gym._id), req.idempotencyKey]));
  let attempt: any;
  try {
    attempt = await PaymentOAuthState.create({ publicId: nanoid(24), stateHash,
      browserNonceHash: sha256(nonce), clientIdHash: sha256(env.RAZORPAY_OAUTH_CLIENT_ID!),
      initiationKeyHash: key, redirectUri: env.RAZORPAY_OAUTH_REDIRECT_URI,
      ...context, ownerId: req.auth.userId, gymId: gym._id, sessionId: req.auth.sessionId,
      environment: env.RAZORPAY_MODE.toUpperCase(), returnTo: new URL("/owner/settings", env.FRONTEND_URL!).toString(),
      previousConnectionId: previous?._id, previousConnectionRevision: previous?.connectionRevision,
      previousConnectionVersion: previous ? Number(previous.documentVersion || 0) : undefined,
      initiationRequestId: req.requestId, expiresAt: new Date(Date.now() + razorpayAttemptTtlMs) });
  } catch (error: any) {
    if (error?.code === 11000) {
      logResult(req, "duplicate_initiation");
      throw new AppError(409, "RAZORPAY_OAUTH_ATTEMPT_EXISTS", "This connection request was already started. Return to payment settings and connect again.");
    }
    throw error;
  }
  // Host-only and per-attempt: unrelated refresh-cookie domains and other tabs
  // must not overwrite or redirect the browser binding.
  res.cookie(cookieName(stateHash), nonce, { httpOnly: true,
    secure: new URL(context.browserApiOrigin).protocol === "https:", sameSite: "lax",
    path: razorpayCallbackPath, maxAge: razorpayAttemptTtlMs });
  logResult(req, "initiated", attempt);
  res.status(201).json({ success: true, data: { authorizationUrl: buildRazorpayAuthorizeUrl(state), expiresInSeconds: 600, oauthFlowVersion: razorpayOAuthFlowVersion } });
}

async function ownerContext(attempt: any) {
  const [session, gym, owner, assignment] = await Promise.all([
    Session.findOne({ publicId: attempt.sessionId, userId: attempt.ownerId, revokedAt: null }),
    Gym.findOne({ _id: attempt.gymId, ownerId: attempt.ownerId, deletedAt: null }).lean(),
    User.findById(attempt.ownerId).lean(),
    RoleAssignment.findOne({ userId: attempt.ownerId, gymId: attempt.gymId, role: "GYM_OWNER", status: "ACTIVE" }).lean(),
  ]);
  if (!session || sessionExpiry(session) <= new Date() || session.activeRole !== "GYM_OWNER" ||
      String(session.activeGymId) !== String(attempt.gymId) || !gym || ["SUSPENDED", "ARCHIVED"].includes(gym.status) || !owner || owner.status !== "ACTIVE" ||
      owner.firstAccessPending || !owner.roles.includes("GYM_OWNER") || !assignment?.permissions?.includes("gym:update"))
    throw new AppError(403, "OAUTH_OWNER_CONTEXT_CHANGED", "The owner session or gym access changed. Sign in and connect again.");
  return { gym, owner };
}

async function failAttempt(attempt: any, req: Request, reason: string) {
  await PaymentOAuthState.updateOne({ _id: attempt._id, status: { $in: ["PENDING", "PROCESSING"] } },
    { $set: { status: "FAILED", failureCode: reason, callbackRequestId: req.requestId, consumedAt: new Date() } });
}

export async function completeGymRazorpayConnection(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Getfit4u-OAuth-Flow", String(razorpayOAuthFlowVersion));
  let attempt: any;
  let issuedToken: string | undefined;
  let persistenceStarted = false;
  let claimed = false;
  let exchanging = false;
  try {
    const state = req.query.state;
    if (state === undefined) return result(req, res, "failed", "missing_state");
    if (typeof state !== "string" || !randomValue.test(state)) return result(req, res, "failed", "malformed_state");
    const stateHash = sha256(state);
    attempt = await PaymentOAuthState.findOne({ stateHash }).select("+stateHash +browserNonceHash +clientIdHash");
    if (!attempt) return result(req, res, "failed", "attempt_not_found");
    if (attempt.expiresAt <= new Date()) return result(req, res, "failed", "expired_state", attempt);
    if (attempt.status !== "PENDING") return result(req, res, attempt.status === "PROCESSING" ? "processing" : "failed", "attempt_already_processed", attempt);
    if (attempt.clientIdHash !== sha256(env.RAZORPAY_OAUTH_CLIENT_ID || "") || attempt.environment !== env.RAZORPAY_MODE.toUpperCase() ||
        attempt.redirectUri !== env.RAZORPAY_OAUTH_REDIRECT_URI || attempt.frontendOrigin !== new URL(env.FRONTEND_URL!).origin ||
        !env.RAZORPAY_GYM_OAUTH_ENABLED || !attempt.browserApiOrigin)
      return result(req, res, "failed", "configuration_binding_failed", attempt);
    const nonce = req.cookies?.[cookieName(stateHash)];
    if (!nonce && req.query.gfu_return !== "1" && new URL(attempt.redirectUri).origin !== attempt.browserApiOrigin) {
      // A callback to the standalone backend cannot receive a cookie set by the
      // website's /api proxy. Relay once to the saved, validated browser API origin.
      // No cookie is created here; the original nonce is still mandatory there.
      const target = new URL(razorpayCallbackPath, attempt.browserApiOrigin);
      target.searchParams.set("state", state);
      for (const name of ["code", "error"] as const) {
        if (req.query[name] !== undefined) {
          if (typeof req.query[name] !== "string" || req.query[name].length > 16384)
            return result(req, res, "failed", "malformed_callback", attempt);
          target.searchParams.set(name, req.query[name]);
        }
      }
      target.searchParams.set("gfu_return", "1");
      logResult(req, "browser_binding_relay", attempt);
      return res.redirect(303, target.toString());
    }
    if (typeof nonce !== "string" || !randomValue.test(nonce) || sha256(nonce) !== attempt.browserNonceHash)
      return result(req, res, "failed", "browser_binding_failed", attempt);
    await ownerContext(attempt);
    const taken = await PaymentOAuthState.findOneAndUpdate({ _id: attempt._id, status: "PENDING",
      expiresAt: { $gt: new Date() }, consumedAt: { $exists: false } },
    { $set: { status: "PROCESSING", consumedAt: new Date(), callbackRequestId: req.requestId } }, { returnDocument: "after" });
    if (!taken) return result(req, res, "processing", "attempt_already_processed", attempt);
    claimed = true;
    res.clearCookie(cookieName(stateHash), { path: razorpayCallbackPath, httpOnly: true, sameSite: "lax",
      secure: new URL(attempt.browserApiOrigin).protocol === "https:" });
    if (typeof req.query.error === "string" && req.query.error) {
      await PaymentOAuthState.updateOne({ _id: attempt._id, status: "PROCESSING" }, { $set: { status: "DENIED", failureCode: "provider_denied" } });
      return result(req, res, "denied", "provider_denied", attempt);
    }
    if (typeof req.query.code !== "string" || !req.query.code || req.query.code.length > 16384 || req.query.error !== undefined)
      throw new AppError(400, "OAUTH_CODE_MISSING", "Razorpay did not return a valid authorization code.");
    // Express already decoded the code. The token request uses the exact same
    // configured redirect URI, even when the browser cookie required a relay.
    exchanging = true;
    const tokens = await exchangeRazorpayAuthorizationCode(req.query.code);
    exchanging = false;
    issuedToken = tokens.access_token;
    const account = String(tokens.razorpay_account_id || "");
    const expiresIn = Number(tokens.expires_in);
    if (!/^acc_[A-Za-z0-9]+$/.test(account) || !String(tokens.public_token || "").startsWith(`rzp_${env.RAZORPAY_MODE}_oauth_`) ||
        !tokens.access_token || !tokens.refresh_token || !Number.isFinite(expiresIn) || expiresIn <= 0)
      throw new AppError(502, "OAUTH_RESPONSE_INVALID", "Razorpay returned incomplete authorization data.");
    if (env.RAZORPAY_PLATFORM_ACCOUNT_ID && account === env.RAZORPAY_PLATFORM_ACCOUNT_ID)
      throw new AppError(409, "PLATFORM_MERCHANT_NOT_ALLOWED", "The platform merchant cannot be connected as a gym seller.");
    const { gym, owner } = await ownerContext(attempt);
    const contactEmail = gym.contact?.email || owner.email;
    if (!contactEmail) throw new AppError(409, "GYM_PAYMENT_CONTACT_REQUIRED", "Add a gym or owner email before connecting Razorpay.");
    const collision = await PaymentConnection.findOne({ merchantAccountId: account, provider: "RAZORPAY",
      environment: attempt.environment, gymId: { $ne: attempt.gymId } }).lean();
    if (collision) throw new AppError(409, "RAZORPAY_MERCHANT_ALREADY_BOUND", "This merchant is already connected to another gym.");
    persistenceStarted = true;
    await mongoose.connection.transaction(async session => {
      let connection: any = await PaymentConnection.findOne({ gymId: attempt.gymId, provider: "RAZORPAY", environment: attempt.environment }).session(session);
      if (String(connection?._id || "") !== String(attempt.previousConnectionId || "") ||
          (connection && (connection.connectionRevision !== attempt.previousConnectionRevision ||
            Number(connection.documentVersion || 0) !== attempt.previousConnectionVersion)))
        throw new AppError(409, "OAUTH_CONNECTION_CHANGED", "This gym's connection changed while authorizing. Review it before reconnecting.");
      if (!connection) connection = new PaymentConnection({ publicId: nanoid(20), gymId: attempt.gymId,
        provider: "RAZORPAY", environment: attempt.environment, businessLegalName: gym.name,
        businessContactEmail: contactEmail, businessContactPhone: gym.contact?.phone || owner.phone });
      else connection.connectionRevision = Number(connection.connectionRevision || 0) + 1;
      Object.assign(connection, { connectionType: "OAUTH_MERCHANT", authorizedOwnerId: attempt.ownerId,
        merchantAccountId: account, publicToken: tokens.public_token, authorizationStatus: "CONNECTED",
        onboardingStatus: "PENDING", paymentEligibilityStatus: "UNKNOWN", settlementReadinessStatus: "UNKNOWN",
        qrCapability: "UNKNOWN", collectionEnabled: false, connectedAt: new Date(), revokedAt: undefined, disconnectedAt: undefined,
        tokenEncryptionKeyVersion: env.PAYMENT_TOKEN_ENCRYPTION_KEY_VERSION,
        accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000), refreshTokenExpiresAt: new Date(Date.now() + 180 * 86_400_000),
        accessTokenCiphertext: encryptPaymentToken(tokens.access_token, String(connection._id), "access"),
        refreshTokenCiphertext: encryptPaymentToken(tokens.refresh_token, String(connection._id), "refresh"), tokenFingerprint: sha256(tokens.access_token) });
      await connection.save({ session });
      const completed = await PaymentOAuthState.updateOne({ _id: attempt._id, status: "PROCESSING" },
        { $set: { status: "COMPLETED", connectionId: connection._id, connectionRevision: connection.connectionRevision } }, { session });
      if (completed.matchedCount !== 1) throw new AppError(409, "OAUTH_ATTEMPT_CHANGED", "The connection attempt is no longer available.");
    });
    return result(req, res, "connected", "connected", attempt);
  } catch (error) {
    // An uncertain database commit must not revoke a token that may already be
    // stored. Keep PROCESSING for verification instead of claiming failure/success.
    const uncertain = persistenceStarted && !(error instanceof AppError);
    if (issuedToken && !uncertain) await revokeRazorpayOAuthToken(issuedToken).catch(() => undefined);
    const reason = uncertain ? "persistence_uncertain" : error instanceof AppError && error.code === "OAUTH_OWNER_CONTEXT_CHANGED"
      ? "owner_context_changed" : exchanging ? "token_exchange_failed" : claimed ? "connection_failed" : "callback_failed";
    if (attempt && !uncertain && (claimed || reason === "owner_context_changed")) await failAttempt(attempt, req, reason).catch(() => undefined);
    return result(req, res, uncertain ? "processing" : "failed", reason, attempt);
  }
}

export async function gymRazorpayAttempt(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  const attempt = await PaymentOAuthState.findOne({ publicId: req.params.reference,
    ownerId: req.auth!.userId, gymId: req.auth!.gymId, sessionId: req.auth!.sessionId,
    environment: env.RAZORPAY_MODE.toUpperCase() }).lean();
  if (!attempt) throw new AppError(404, "OAUTH_ATTEMPT_NOT_FOUND", "This connection attempt is unavailable. Return to payment settings.");
  const gym = await Gym.findOne({ _id: attempt.gymId, ownerId: req.auth!.userId, deletedAt: null }).lean();
  if (!gym) throw new AppError(403, "GYM_OWNERSHIP_REQUIRED", "The gym owner context changed.");
  const connection = attempt.connectionId ? await PaymentConnection.findOne({ _id: attempt.connectionId,
    gymId: attempt.gymId, authorizedOwnerId: attempt.ownerId, authorizationStatus: "CONNECTED",
    provider: "RAZORPAY", environment: attempt.environment,
    connectionRevision: attempt.connectionRevision }).lean() : null;
  res.json({ success: true, data: { status: attempt.status, gymId: gym.publicId, gymName: gym.name,
    connected: attempt.status === "COMPLETED" && Boolean(connection),
    requestId: attempt.callbackRequestId || attempt.initiationRequestId } });
}
