import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { PaymentConnection } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { writeAudit } from "../services/auditService.js";
import { marketplaceContractBlocker, membershipCollectionReadiness } from "../services/paymentConnectionService.js";
import { AppError } from "../utils/AppError.js";

function publicConnection(connection: any) {
  if (!connection) return null;
  const value = connection.toObject ? connection.toObject() : connection;
  delete value.credentialReference;
  return value;
}

export async function ownerPaymentConnection(req: Request, res: Response) {
  const readiness = await membershipCollectionReadiness(req.auth!.gymId!);
  res.json({
    success: true,
    data: {
      connection: publicConnection(readiness.connection),
      onlineMembershipPaymentsAvailable: readiness.available,
      blockers: readiness.blockers,
      marketplaceEnabled: env.PHONEPE_MARKETPLACE_ENABLED,
      provider: "PHONEPE",
      environment: readiness.environment,
    },
  });
}

export async function requestOwnerPaymentOnboarding(req: Request, res: Response) {
  const gymId = req.auth!.gymId!;
  const gym = await Gym.findOne({ _id: gymId, ownerId: req.auth!.userId, deletedAt: null }).lean();
  if (!gym) throw new AppError(403, "GYM_OWNERSHIP_REQUIRED", "Only the authorized gym owner can start payment onboarding.");
  const existing = await PaymentConnection.findOne({
    gymId,
    provider: "PHONEPE",
    environment: env.PHONEPE_ENV.toUpperCase(),
  });
  if (existing?.onboardingStatus === "APPROVED")
    throw new AppError(409, "PAYMENT_CONNECTION_ALREADY_APPROVED", "This gym payment connection is already approved.");
  const connection = existing || new PaymentConnection({
    publicId: nanoid(20),
    gymId,
    authorizedOwnerId: req.auth!.userId,
    provider: "PHONEPE",
    environment: env.PHONEPE_ENV.toUpperCase(),
  });
  if (
    existing &&
    String(existing.authorizedOwnerId) !== String(req.auth!.userId)
  ) {
    connection.mappingVersion += 1;
    connection.providerMerchantReference = undefined;
    connection.providerVendorReference = undefined;
    connection.providerEvidenceReference = undefined;
    connection.maskedSettlementAccount = undefined;
    connection.verifiedAt = undefined;
  }
  connection.businessLegalName = req.body.businessLegalName;
  connection.businessContactEmail = req.body.businessContactEmail;
  connection.authorizedOwnerId = req.auth!.userId;
  connection.onboardingStatus = "PENDING";
  connection.collectionEnabled = false;
  connection.allocationCapability = "CONTRACT_REQUIRED";
  connection.settlementCapability = "PENDING";
  connection.termsAcceptedAt = new Date();
  await connection.save();
  await writeAudit(req, {
    action: "payment.connection.onboarding_requested",
    entityType: "PaymentConnection",
    entityId: connection.publicId,
    after: { onboardingStatus: connection.onboardingStatus, provider: connection.provider },
  });
  res.status(existing ? 200 : 201).json({
    success: true,
    data: publicConnection(connection),
    message: "Onboarding request recorded. Online collection stays disabled until PhonePe confirms the vendor and split-settlement capability.",
  });
}

export async function listPaymentConnections(_req: Request, res: Response) {
  const rows = await PaymentConnection.find()
    .populate("gymId", "publicId name slug")
    .populate("authorizedOwnerId", "publicId name email")
    .sort({ updatedAt: -1 })
    .lean();
  res.json({
    success: true,
    data: {
      items: rows.map(publicConnection),
      marketplaceEnabled: env.PHONEPE_MARKETPLACE_ENABLED,
      contractBlocker: marketplaceContractBlocker(),
    },
  });
}

export async function reviewPaymentConnection(req: Request, res: Response) {
  const connection = await PaymentConnection.findOne({ publicId: req.params.id });
  if (!connection) throw new AppError(404, "PAYMENT_CONNECTION_NOT_FOUND", "Payment connection not found.");
  const before = publicConnection(connection);
  const approved = req.body.onboardingStatus === "APPROVED";
  if (approved && (!req.body.providerVendorReference || !req.body.providerEvidenceReference))
    throw new AppError(422, "PHONEPE_APPROVAL_EVIDENCE_REQUIRED", "A PhonePe vendor reference and provider evidence reference are required.");
  const beneficiaryChanged = Boolean(
    (req.body.providerVendorReference &&
      req.body.providerVendorReference !== connection.providerVendorReference) ||
      (req.body.maskedSettlementAccount &&
        req.body.maskedSettlementAccount !== connection.maskedSettlementAccount),
  );
  if (beneficiaryChanged) connection.mappingVersion += 1;
  connection.onboardingStatus = req.body.onboardingStatus;
  connection.providerVendorReference = req.body.providerVendorReference || connection.providerVendorReference;
  connection.providerMerchantReference = req.body.providerMerchantReference || connection.providerMerchantReference;
  connection.providerEvidenceReference = req.body.providerEvidenceReference || connection.providerEvidenceReference;
  connection.maskedSettlementAccount = req.body.maskedSettlementAccount || connection.maskedSettlementAccount;
  connection.settlementCapability = approved ? "ENABLED" : req.body.settlementCapability || "DISABLED";
  // Application support is intentionally not treated as proof of a real
  // allocation API contract. This prevents a toggle from misrouting funds.
  connection.allocationCapability = approved ? "CONTRACT_REQUIRED" : "DISABLED";
  connection.collectionEnabled = false;
  connection.verifiedAt = approved ? new Date() : undefined;
  connection.disabledAt = req.body.onboardingStatus === "DISABLED" ? new Date() : undefined;
  await connection.save();
  await writeAudit(req, {
    action: "payment.connection.reviewed",
    entityType: "PaymentConnection",
    entityId: connection.publicId,
    reason: req.body.reason,
    before,
    after: publicConnection(connection),
  });
  res.json({
    success: true,
    data: publicConnection(connection),
    message: approved
      ? "Provider approval was recorded. Collection remains disabled until the exact Marketplace allocation contract is implemented."
      : "Payment connection status updated.",
  });
}
