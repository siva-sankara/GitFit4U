import type { Request, Response } from "express";
import { env } from "../config/env.js";
import { razorpayOAuthFlowVersion } from "../config/razorpayOAuth.js";
import { PaymentConnection } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { revokeRazorpayOAuthToken } from "../integrations/payments/razorpayOAuthProvider.js";
import { decryptPaymentToken } from "../integrations/payments/paymentTokenCrypto.js";
import { membershipMerchantReadiness } from "../services/paymentMerchantService.js";
import { AppError } from "../utils/AppError.js";
export { beginGymRazorpayConnection, completeGymRazorpayConnection, gymRazorpayAttempt } from "../services/razorpayOAuthFlow.js";

function publicConnection(connection: any) {
  if (!connection) return null;
  const value = connection.toObject ? connection.toObject() : { ...connection };
  for (const key of [
    "accessTokenCiphertext", "refreshTokenCiphertext", "tokenFingerprint",
    "tokenRefreshLeaseId", "tokenRefreshLeaseUntil", "publicToken",
  ]) delete value[key];
  return value;
}

export async function gymRazorpayStatus(req: Request, res: Response) {
  res.setHeader("Cache-Control", "no-store");
  const gym = await Gym.findOne({ publicId: req.params.gymId, _id: req.auth!.gymId }).lean();
  if (!gym) throw new AppError(403, "GYM_CONTEXT_CHANGED", "Select the requested gym before viewing payment settings.");
  const readiness = await membershipMerchantReadiness(String(gym._id));
  res.json({ success: true, data: {
    oauthFlowVersion: razorpayOAuthFlowVersion,
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
