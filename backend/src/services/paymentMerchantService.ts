import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { PaymentConnection } from "../models/Business.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import {
  GymOAuthPaymentClient,
  oauthConfigurationBlockers,
  refreshRazorpayOAuthToken,
} from "../integrations/payments/razorpayOAuthProvider.js";
import { decryptPaymentToken, encryptPaymentToken } from "../integrations/payments/paymentTokenCrypto.js";

export async function membershipMerchantReadiness(gymId: string) {
  const connection = await PaymentConnection.findOne({
    gymId,
    provider: "RAZORPAY",
    environment: env.RAZORPAY_MODE.toUpperCase(),
    connectionType: "OAUTH_MERCHANT",
  }).lean();
  const blockers = oauthConfigurationBlockers();
  if (!connection) blockers.push("Connect this gym's Razorpay merchant account.");
  else {
    if (connection.authorizationStatus !== "CONNECTED")
      blockers.push("This gym's Razorpay authorization requires reconnection.");
    if (!connection.publicToken)
      blockers.push("Razorpay did not return a public Checkout token for this merchant.");
    if (!/^acc_[A-Za-z0-9]+$/.test(String(connection.merchantAccountId || "")))
      blockers.push("The connected Razorpay merchant identity is invalid.");
    if (!connection.collectionEnabled)
      blockers.push("Online membership collection is disabled for this gym.");
    if (connection.paymentEligibilityStatus !== "ELIGIBLE")
      blockers.push(connection.paymentEligibilityStatus === "INELIGIBLE"
        ? "Razorpay reports this merchant as ineligible for payments."
        : "Merchant payment eligibility has not yet been verified.");
    if (connection.settlementReadinessStatus !== "READY")
      blockers.push("Merchant settlement readiness has not yet been verified.");
    if (!connection.accessTokenExpiresAt || !connection.refreshTokenExpiresAt)
      blockers.push("Merchant credential expiry metadata is incomplete.");
    else if (connection.refreshTokenExpiresAt <= new Date())
      blockers.push("The merchant authorization expired. Reconnect Razorpay.");
  }
  return {
    available: blockers.length === 0,
    provider: "RAZORPAY",
    environment: env.RAZORPAY_MODE.toUpperCase(),
    blockers: [...new Set(blockers)],
    connection,
  };
}

export async function requireMembershipMerchantConnection(gymId: string) {
  const readiness = await membershipMerchantReadiness(gymId);
  if (!readiness.available || !readiness.connection)
    throw new AppError(409, "GYM_ONLINE_PAYMENT_UNAVAILABLE",
      readiness.blockers[0] || "Online membership payment is unavailable for this gym.",
      { blockers: readiness.blockers });
  return readiness.connection;
}

export async function gymOAuthClientForConnection(
  connectionId: string,
  expectedMerchantAccountId?: string,
) {
  let connection: any = await PaymentConnection.findById(connectionId)
    .select("+accessTokenCiphertext +refreshTokenCiphertext +tokenFingerprint +tokenRefreshLeaseId +tokenRefreshLeaseUntil");
  if (!connection || connection.connectionType !== "OAUTH_MERCHANT" ||
      connection.authorizationStatus !== "CONNECTED" || !connection.merchantAccountId ||
      !connection.accessTokenCiphertext)
    throw new AppError(409, "RAZORPAY_RECONNECT_REQUIRED", "This gym must reconnect Razorpay.");
  if (expectedMerchantAccountId && connection.merchantAccountId !== expectedMerchantAccountId)
    throw new AppError(
      409,
      "ORIGINAL_MERCHANT_AUTHORIZATION_REQUIRED",
      "This payment belongs to a previous Razorpay merchant connection. Reconnect that original merchant before reconciling or refunding it.",
    );

  if (connection.accessTokenExpiresAt > new Date(Date.now() + 5 * 60_000))
    return new GymOAuthPaymentClient(
      decryptPaymentToken(connection.accessTokenCiphertext, String(connection._id), "access"),
      connection.merchantAccountId,
    );

  if (!connection.refreshTokenCiphertext || connection.refreshTokenExpiresAt <= new Date()) {
    await PaymentConnection.updateOne({ _id: connection._id },
      { $set: { authorizationStatus: "ACTION_REQUIRED", collectionEnabled: false } });
    throw new AppError(409, "RAZORPAY_RECONNECT_REQUIRED", "The gym's Razorpay authorization expired.");
  }

  const leaseId = nanoid(20);
  const now = new Date();
  const claimed: any = await PaymentConnection.findOneAndUpdate({
    _id: connection._id,
    authorizationStatus: "CONNECTED",
    $or: [
      { tokenRefreshLeaseUntil: { $exists: false } },
      { tokenRefreshLeaseUntil: null },
      { tokenRefreshLeaseUntil: { $lte: now } },
    ],
  }, { $set: { tokenRefreshLeaseId: leaseId, tokenRefreshLeaseUntil: new Date(now.getTime() + 60_000) } },
  { returnDocument: "after" }).select("+accessTokenCiphertext +refreshTokenCiphertext +tokenRefreshLeaseId +tokenRefreshLeaseUntil");
  if (!claimed)
    throw new AppError(409, "RAZORPAY_TOKEN_REFRESH_IN_PROGRESS", "Razorpay credentials are being refreshed. Retry shortly.");
  connection = claimed;

  try {
    const refreshToken = decryptPaymentToken(connection.refreshTokenCiphertext, String(connection._id), "refresh");
    const tokens = await refreshRazorpayOAuthToken(refreshToken);
    if (!tokens.access_token || !tokens.refresh_token || !tokens.public_token)
      throw new AppError(502, "RAZORPAY_TOKEN_RESPONSE_INVALID", "Razorpay returned incomplete credentials.");
    const expiresIn = Number(tokens.expires_in);
    if (!Number.isFinite(expiresIn) || expiresIn <= 0)
      throw new AppError(502, "RAZORPAY_TOKEN_RESPONSE_INVALID", "Razorpay returned invalid credential expiry metadata.");
    const updated: any = await PaymentConnection.findOneAndUpdate(
      { _id: connection._id, tokenRefreshLeaseId: leaseId },
      {
        $set: {
          accessTokenCiphertext: encryptPaymentToken(tokens.access_token, String(connection._id), "access"),
          refreshTokenCiphertext: encryptPaymentToken(tokens.refresh_token, String(connection._id), "refresh"),
          tokenFingerprint: sha256(tokens.access_token),
          publicToken: tokens.public_token,
          accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
          refreshTokenExpiresAt: new Date(Date.now() + 180 * 86_400_000),
          lastProviderSyncAt: new Date(),
        },
        $unset: { tokenRefreshLeaseId: 1, tokenRefreshLeaseUntil: 1 },
      },
      { returnDocument: "after" },
    ).select("+accessTokenCiphertext");
    if (!updated) throw new AppError(409, "RAZORPAY_TOKEN_REFRESH_CONFLICT", "Credential refresh ownership changed.");
    return new GymOAuthPaymentClient(tokens.access_token, updated.merchantAccountId);
  } catch (error) {
    await PaymentConnection.updateOne(
      { _id: connection._id, tokenRefreshLeaseId: leaseId },
      { $set: { authorizationStatus: "ACTION_REQUIRED", collectionEnabled: false },
        $unset: { tokenRefreshLeaseId: 1, tokenRefreshLeaseUntil: 1 } },
    );
    throw error;
  }
}
