import { env } from "../config/env.js";
import { PaymentConnection } from "../models/Business.js";
import { AppError } from "../utils/AppError.js";

export function marketplaceContractBlocker() {
  if (!env.PHONEPE_MARKETPLACE_ENABLED)
    return "PhonePe Marketplace/Split Settlements is not enabled for GETFIT4U.";
  return "The account-specific PhonePe Marketplace allocation API contract has not been supplied. Member online collection remains disabled to prevent settlement to GETFIT4U instead of the gym.";
}

export async function membershipCollectionReadiness(gymId: string) {
  const connection = await PaymentConnection.findOne({
    gymId,
    provider: "PHONEPE",
    environment: env.PHONEPE_ENV.toUpperCase(),
  }).lean();
  const blockers: string[] = [];
  const contractBlocker = marketplaceContractBlocker();
  if (contractBlocker) blockers.push(contractBlocker);
  if (!connection) blockers.push("This gym has not started PhonePe payment onboarding.");
  else {
    if (connection.onboardingStatus !== "APPROVED")
      blockers.push(`Gym payment onboarding is ${String(connection.onboardingStatus).toLowerCase().replaceAll("_", " ")}.`);
    if (!connection.collectionEnabled)
      blockers.push("Online membership collection is not enabled for this gym.");
    if (connection.allocationCapability !== "ENABLED")
      blockers.push("Gym beneficiary allocation has not been confirmed by PhonePe.");
    if (connection.settlementCapability !== "ENABLED")
      blockers.push("Gym settlement capability has not been confirmed by PhonePe.");
  }
  return {
    available: blockers.length === 0,
    provider: "PHONEPE",
    environment: env.PHONEPE_ENV.toUpperCase(),
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

