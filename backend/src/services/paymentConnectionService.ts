import { env } from "../config/env.js";
import { PaymentConnection } from "../models/Business.js";
import { AppError } from "../utils/AppError.js";

export function routeConfigurationBlockers() {
  const blockers: string[] = [];
  if (!env.RAZORPAY_ROUTE_ENABLED)
    blockers.push("Razorpay Route is not enabled for GETFIT4U.");
  if (!env.RAZORPAY_GYM_FEE_BEARER)
    blockers.push("RAZORPAY_GYM_FEE_BEARER is not configured.");
  if (env.RAZORPAY_GYM_FEE_BEARER === "gym_deducts_actual")
    blockers.push(
      "Gym-funded provider charges require an approved, account-specific pricing calculation before live collection can be enabled.",
    );
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET || !env.RAZORPAY_WEBHOOK_SECRET)
    blockers.push("Razorpay API and webhook credentials are incomplete.");
  const expectedPrefix = env.RAZORPAY_MODE === "live" ? "rzp_live_" : "rzp_test_";
  if (env.RAZORPAY_KEY_ID && !env.RAZORPAY_KEY_ID.startsWith(expectedPrefix))
    blockers.push(`Razorpay credentials do not match ${env.RAZORPAY_MODE} mode.`);
  return blockers;
}

// Kept as a source-compatible alias for older callers while the active
// implementation is Razorpay Route only.
export function marketplaceContractBlocker() {
  return routeConfigurationBlockers()[0] || null;
}

export async function membershipCollectionReadiness(gymId: string) {
  const connection = await PaymentConnection.findOne({
    gymId,
    provider: "RAZORPAY",
    environment: env.RAZORPAY_MODE.toUpperCase(),
  }).lean();
  const blockers = routeConfigurationBlockers();
  if (!connection) blockers.push("This gym has not started Razorpay Route onboarding.");
  else {
    if (connection.onboardingStatus !== "APPROVED")
      blockers.push(`Gym payment onboarding is ${String(connection.onboardingStatus).toLowerCase().replaceAll("_", " ")}.`);
    if (!connection.collectionEnabled)
      blockers.push("Online membership collection is not enabled for this gym.");
    if (connection.allocationCapability !== "ENABLED")
      blockers.push("Gym beneficiary allocation has not been confirmed through Razorpay Route.");
    if (connection.settlementCapability !== "ENABLED")
      blockers.push("Gym settlement capability has not been confirmed through Razorpay Route.");
    if (!/^acc_[A-Za-z0-9]+$/.test(String(connection.linkedAccountId || "")))
      blockers.push("The gym does not have a valid Razorpay linked-account mapping.");
    if (!connection.providerEvidenceReference)
      blockers.push("Razorpay approval evidence has not been recorded for this mapping.");
    if (!connection.termsAcceptedAt || !connection.termsAcceptedBy)
      blockers.push("The authorized gym owner has not accepted the beneficiary terms.");
    const expectedPolicy = env.RAZORPAY_GYM_FEE_BEARER?.toUpperCase();
    if (expectedPolicy && connection.feeBearerPolicy !== expectedPolicy)
      blockers.push("The gym beneficiary mapping does not match the configured fee-bearer policy.");
  }
  return {
    available: blockers.length === 0,
    provider: "RAZORPAY",
    environment: env.RAZORPAY_MODE.toUpperCase(),
    blockers: [...new Set(blockers)],
    connection,
  };
}

export async function requireMembershipBeneficiary(gymId: string) {
  const readiness = await membershipCollectionReadiness(gymId);
  if (!readiness.available || !readiness.connection)
    throw new AppError(
      409,
      "GYM_ONLINE_PAYMENT_UNAVAILABLE",
      readiness.blockers[0] || "Online membership payment is unavailable for this gym.",
      { blockers: readiness.blockers },
    );
  return readiness.connection;
}
