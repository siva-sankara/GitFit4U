import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { PaymentConnection, Refund, RouteTransfer } from "../models/Business.js";
import { Gym } from "../models/Gym.js";
import { writeAudit } from "../services/auditService.js";
import { routeConfigurationBlockers, membershipCollectionReadiness } from "../services/paymentConnectionService.js";
import { AppError } from "../utils/AppError.js";
import { paymentProvider } from "../integrations/payments/index.js";
import { reconcileRouteTransfer } from "./checkoutController.js";
import { reconcileReservedRefund } from "../services/refundService.js";

function publicConnection(connection: any) {
  if (!connection) return null;
  const value = connection.toObject ? connection.toObject() : connection;
  delete value.credentialReference;
  return value;
}

function providerSettlementSummary(product: Record<string, any>) {
  const configuration = product.active_configuration || {};
  const first = Array.isArray(configuration.settlement_accounts)
    ? configuration.settlement_accounts.find((entry: any) => entry?.active !== false)
    : configuration.settlements;
  const raw = String(
    first?.bank_account?.account_number ||
      first?.upi?.vpa ||
      first?.account_number ||
      "",
  ).trim();
  return {
    id: first?.id ? String(first.id) : undefined,
    masked: raw ? `••••${raw.slice(-4)}` : undefined,
  };
}

export async function ownerPaymentConnection(req: Request, res: Response) {
  const readiness = await membershipCollectionReadiness(req.auth!.gymId!);
  res.json({
    success: true,
    data: {
      connection: publicConnection(readiness.connection),
      onlineMembershipPaymentsAvailable: readiness.available,
      blockers: readiness.blockers,
      routeEnabled: env.RAZORPAY_ROUTE_ENABLED,
      feeBearerPolicy: env.RAZORPAY_GYM_FEE_BEARER,
      provider: "RAZORPAY",
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
    provider: "RAZORPAY",
    environment: env.RAZORPAY_MODE.toUpperCase(),
  });
  if (existing?.onboardingStatus === "APPROVED")
    throw new AppError(409, "PAYMENT_CONNECTION_ALREADY_APPROVED", "This gym payment connection is already approved.");
  const connection = existing || new PaymentConnection({
    publicId: nanoid(20),
    gymId,
    authorizedOwnerId: req.auth!.userId,
    provider: "RAZORPAY",
    environment: env.RAZORPAY_MODE.toUpperCase(),
  });
  if (
    existing &&
    String(existing.authorizedOwnerId) !== String(req.auth!.userId)
  ) {
    connection.mappingVersion += 1;
    connection.linkedAccountId = undefined;
    connection.productConfigurationId = undefined;
    connection.settlementAccountId = undefined;
    connection.providerEvidenceReference = undefined;
    connection.maskedSettlementAccount = undefined;
    connection.verifiedAt = undefined;
  }
  connection.businessLegalName = req.body.businessLegalName;
  connection.businessType = req.body.businessType;
  connection.businessContactEmail = req.body.businessContactEmail;
  connection.businessContactPhone = req.body.businessContactPhone;
  connection.authorizedOwnerId = req.auth!.userId;
  connection.onboardingStatus = "PENDING";
  connection.collectionEnabled = false;
  connection.allocationCapability = "PENDING";
  connection.settlementCapability = "PENDING";
  connection.termsAcceptedAt = new Date();
  connection.termsAcceptedBy = req.auth!.userId;
  connection.termsVersion = req.body.termsVersion;
  connection.feeBearerPolicy = env.RAZORPAY_GYM_FEE_BEARER?.toUpperCase();
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
    message: "Onboarding request recorded. Online collection stays disabled until Razorpay Route confirms the linked account and settlement capability.",
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
      routeEnabled: env.RAZORPAY_ROUTE_ENABLED,
      feeBearerPolicy: env.RAZORPAY_GYM_FEE_BEARER,
      configurationBlockers: routeConfigurationBlockers(),
    },
  });
}

export async function reviewPaymentConnection(req: Request, res: Response) {
  const connection = await PaymentConnection.findOne({ publicId: req.params.id });
  if (!connection) throw new AppError(404, "PAYMENT_CONNECTION_NOT_FOUND", "Payment connection not found.");
  if (
    connection.provider !== "RAZORPAY" ||
    connection.environment !== env.RAZORPAY_MODE.toUpperCase()
  )
    throw new AppError(
      409,
      "HISTORICAL_CONNECTION_READ_ONLY",
      "Historical or different-environment provider mappings are read-only.",
    );
  const before = publicConnection(connection);
  const approved = req.body.onboardingStatus === "APPROVED";
  if (
    approved &&
    (!/^acc_[A-Za-z0-9]+$/.test(String(req.body.linkedAccountId || "")) ||
      !/^acc_prd_[A-Za-z0-9]+$/.test(
        String(req.body.productConfigurationId || ""),
      ))
  )
    throw new AppError(
      422,
      "RAZORPAY_ROUTE_APPROVAL_EVIDENCE_REQUIRED",
      "A valid Razorpay linked account and Route product configuration are required.",
    );
  let providerAccount: Record<string, any> | undefined;
  let providerProduct: Record<string, any> | undefined;
  if (approved) {
    [providerAccount, providerProduct] = await Promise.all([
      paymentProvider.getLinkedAccount(req.body.linkedAccountId),
      paymentProvider.getProductConfiguration(
        req.body.linkedAccountId,
        req.body.productConfigurationId,
      ),
    ]);
    const unresolvedRequirements = (providerProduct.requirements || []).filter(
      (item: any) =>
        !["resolved", "fulfilled", "completed"].includes(
          String(item?.status || "").toLowerCase(),
        ),
    );
    if (
      providerAccount.id !== req.body.linkedAccountId ||
      providerAccount.type !== "route" ||
      providerAccount.status !== "created" ||
      providerProduct.id !== req.body.productConfigurationId ||
      providerProduct.account_id !== req.body.linkedAccountId ||
      providerProduct.product_name !== "route" ||
      providerProduct.activation_status !== "activated" ||
      providerProduct.tnc?.accepted !== true ||
      unresolvedRequirements.length > 0
    )
      throw new AppError(
        409,
        "RAZORPAY_ROUTE_NOT_READY",
        "Razorpay has not confirmed an active Route product, accepted terms, and complete requirements for this linked account.",
      );
    if (
      String(providerAccount.legal_business_name || "")
        .trim()
        .toLocaleLowerCase() !==
      String(connection.businessLegalName || "").trim().toLocaleLowerCase()
    )
      throw new AppError(
        409,
        "RAZORPAY_BENEFICIARY_MISMATCH",
        "The Razorpay linked account legal business name does not match this gym's recorded beneficiary.",
      );
  }
  const beneficiaryChanged = Boolean(
    (req.body.linkedAccountId &&
      req.body.linkedAccountId !== connection.linkedAccountId),
  );
  if (beneficiaryChanged) connection.mappingVersion += 1;
  connection.onboardingStatus = req.body.onboardingStatus;
  connection.linkedAccountId = req.body.linkedAccountId || connection.linkedAccountId;
  connection.productConfigurationId = req.body.productConfigurationId || connection.productConfigurationId;
  connection.providerEvidenceReference = approved
    ? `razorpay:${providerAccount!.id}:${providerProduct!.id}`
    : connection.providerEvidenceReference;
  if (approved) {
    const settlement = providerSettlementSummary(providerProduct!);
    connection.settlementAccountId = settlement.id;
    connection.maskedSettlementAccount = settlement.masked;
  }
  connection.settlementCapability = approved ? "ENABLED" : "DISABLED";
  connection.allocationCapability = approved ? "ENABLED" : "DISABLED";
  connection.collectionEnabled = Boolean(
    approved &&
      req.body.collectionEnabled === true &&
      env.RAZORPAY_ROUTE_ENABLED &&
      env.RAZORPAY_GYM_FEE_BEARER === "platform_absorbs",
  );
  connection.feeBearerPolicy = env.RAZORPAY_GYM_FEE_BEARER?.toUpperCase();
  connection.verifiedAt = approved ? new Date() : undefined;
  connection.lastProviderSyncAt = approved ? new Date() : connection.lastProviderSyncAt;
  connection.lastProviderStatus = approved
    ? String(providerProduct!.activation_status)
    : connection.lastProviderStatus;
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
      ? connection.collectionEnabled
        ? "Razorpay Route approval and this gym's linked-account mapping are enabled."
        : "Razorpay approval was recorded, but collection remains disabled until Route and the fee policy are enabled."
      : "Payment connection status updated.",
  });
}

export async function ownerRouteTransfers(req: Request, res: Response) {
  const items = await RouteTransfer.find({ gymId: req.auth!.gymId })
    .populate("paymentId", "publicId status amountMinor currency capturedAt")
    .sort({ createdAt: -1 })
    .limit(200)
    .lean();
  res.json({ success: true, data: items });
}

export async function adminRouteTransfers(req: Request, res: Response) {
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = String(req.query.status).toUpperCase();
  if (req.query.settlementStatus)
    filter.settlementStatus = String(req.query.settlementStatus).toUpperCase();
  const items = await RouteTransfer.find(filter)
    .populate("gymId", "publicId name slug")
    .populate("paymentId", "publicId status amountMinor currency capturedAt")
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  res.json({ success: true, data: items });
}

export async function reconcileAdminRouteTransfer(req: Request, res: Response) {
  const transfer = await RouteTransfer.findOne({
    publicId: req.params.id,
    provider: "RAZORPAY",
    environment: env.RAZORPAY_MODE.toUpperCase(),
  });
  if (!transfer)
    throw new AppError(
      404,
      "ROUTE_TRANSFER_NOT_FOUND",
      "Route transfer not found in the active Razorpay environment.",
    );
  const providerTransfer = await paymentProvider.getTransfer(
    transfer.providerTransferId,
  );
  const reconciled = await reconcileRouteTransfer(providerTransfer as any);
  await writeAudit(req, {
    action: "payment.route_transfer.reconciled",
    entityType: "RouteTransfer",
    entityId: transfer.publicId,
    reason: "Authorized read-only reconciliation with Razorpay",
    before: {
      status: transfer.status,
      settlementStatus: transfer.settlementStatus,
    },
    after: {
      status: reconciled.status,
      settlementStatus: reconciled.settlementStatus,
    },
  });
  res.json({ success: true, data: reconciled });
}

export async function adminRefundExceptions(_req: Request, res: Response) {
  const items = await Refund.find({
    $or: [
      { reconciliationRequired: true },
      { status: { $in: ["PROCESSING", "FAILED"] } },
      {
        transferReversalStatus: {
          $in: ["PENDING", "FAILED", "RECONCILIATION_REQUIRED"],
        },
      },
    ],
  })
    .populate({
      path: "paymentId",
      select: "publicId gymId providerPaymentId amountMinor currency status",
      populate: { path: "gymId", select: "publicId name slug" },
    })
    .sort({ createdAt: -1 })
    .limit(500)
    .lean();
  res.json({ success: true, data: items });
}

export async function reconcileAdminRefund(req: Request, res: Response) {
  const publicId = String(req.params.id);
  const before = await Refund.findOne({ publicId }).lean();
  if (!before)
    throw new AppError(404, "REFUND_NOT_FOUND", "Refund record not found.");
  const reconciled = await reconcileReservedRefund(publicId);
  await writeAudit(req, {
    action: "payment.refund.reconciled",
    entityType: "Refund",
    entityId: publicId,
    reason: "Authorized read-only reconciliation with Razorpay",
    before: {
      status: before.status,
      transferReversalStatus: before.transferReversalStatus,
    },
    after: {
      status: reconciled.status,
      transferReversalStatus: reconciled.transferReversalStatus,
    },
  });
  res.json({ success: true, data: reconciled });
}
