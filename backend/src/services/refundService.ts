import type { Request } from "express";
import mongoose, { type ClientSession } from "mongoose";
import { nanoid } from "nanoid";
import { Payment } from "../models/Commerce.js";
import { Refund, RouteTransfer } from "../models/Business.js";
import { AuditLog } from "../models/Operations.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import { paymentProvider } from "../integrations/payments/index.js";
import { emitDomainEvent } from "./domainEventService.js";

export const reservedRefundFilter = {
  $or: [
    { status: { $in: ["REQUESTED", "PROCESSING", "PROCESSED"] } },
    // Old code marked transport failures as FAILED even if the provider accepted
    // them. Keep those uncertain historical amounts reserved until reconciled.
    { status: "FAILED", failureReason: "Provider request failed" },
  ],
};

async function totals(paymentId: unknown, session: ClientSession) {
  const rows = await Refund.aggregate([
    { $match: { paymentId, ...reservedRefundFilter } },
    {
      $group: {
        _id: null,
        reserved: { $sum: "$amountMinor" },
        processed: {
          $sum: {
            $cond: [{ $eq: ["$status", "PROCESSED"] }, "$amountMinor", 0],
          },
        },
      },
    },
  ]).session(session);
  return {
    reserved: Number(rows[0]?.reserved || 0),
    processed: Number(rows[0]?.processed || 0),
  };
}

async function updatePaymentRefundStatus(payment: any, session: ClientSession) {
  const amounts = await totals(payment._id, session);
  const status =
    amounts.processed >= payment.amountMinor
      ? "REFUNDED"
      : amounts.reserved > amounts.processed
        ? "REFUND_PENDING"
        : amounts.processed > 0
          ? "PARTIALLY_REFUNDED"
          : "CAPTURED";
  await Payment.updateOne(
    { _id: payment._id },
    { $set: { status } },
    { session },
  );
}

export async function reserveRefund(req: Request) {
  if (!req.auth || !["ADMIN", "GYM_OWNER"].includes(req.auth.role))
    throw new AppError(
      403,
      "REFUND_FORBIDDEN",
      "Only administrators or the authorized gym owner can issue or record an eligible refund.",
    );
  const key = req.idempotencyKey || req.header("idempotency-key");
  if (!key || key.length < 8 || key.length > 128)
    throw new AppError(
      400,
      "IDEMPOTENCY_KEY_REQUIRED",
      "A refund submission identifier is required.",
    );
  if (
    !Number.isSafeInteger(req.body.amountMinor) ||
    req.body.amountMinor <= 0 ||
    typeof req.body.reason !== "string" ||
    req.body.reason.trim().length < 5
  )
    throw new AppError(
      422,
      "INVALID_REFUND",
      "Enter a valid refund amount and reason.",
    );
  const idempotencyKey = sha256(
    `refund:${req.auth.userId}:${req.params.id}:${key}`,
  );
  const requestHash = sha256(
    JSON.stringify({
      amount: req.body.amountMinor,
      reason: req.body.reason.trim(),
      offlineReference: req.body.offlineReference || "",
      offlineConfirmed: req.body.offlineConfirmed === true,
    }),
  );
  const replay = (refund: any) => {
    if (refund.requestHash !== requestHash)
      throw new AppError(
        409,
        "REFUND_KEY_REUSED",
        "This submission identifier was used for a different refund.",
      );
    return { refund, payment: null as any, created: false };
  };
  try {
    return await mongoose.connection.transaction(async (session) => {
      const existing = await Refund.findOne({ idempotencyKey }).session(
        session,
      );
      if (existing) return replay(existing);
      // Every reservation/finalization writes this same payment in its transaction.
      // Concurrent operations conflict and retry before reading refund totals.
      const payment = await Payment.findOneAndUpdate(
        {
          publicId: req.params.id,
          ...(req.auth!.role === "GYM_OWNER"
            ? { gymId: req.auth!.gymId, purpose: "MEMBERSHIP" }
            : {}),
          status: { $in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUND_PENDING"] },
        },
        { $inc: { __v: 1 } },
        { returnDocument: "after", session },
      );
      if (!payment)
        throw new AppError(
          404,
          "REFUNDABLE_PAYMENT_NOT_FOUND",
          "A captured payment with a remaining balance is required.",
        );
      const offline = payment.provider === "OFFLINE";
      if (!offline && payment.provider !== "RAZORPAY")
        throw new AppError(
          409,
          "LEGACY_REFUND_EXTERNAL_ACTION_REQUIRED",
          "This historical payment must be refunded through its original provider's authorized process and then reconciled in GETFIT4U.",
        );
      if (offline && req.body.offlineConfirmed !== true)
        throw new AppError(
          422,
          "OFFLINE_REFUND_CONFIRMATION_REQUIRED",
          "Confirm that funds have already been returned outside GETFIT4U before recording the offline reversal.",
        );
      if (!offline && !payment.providerPaymentId)
        throw new AppError(
          409,
          "PROVIDER_PAYMENT_MISSING",
          "The original provider payment reference must be reconciled first.",
        );
      const prior = await totals(payment._id, session);
      if (prior.reserved + req.body.amountMinor > payment.amountMinor)
        throw new AppError(
          409,
          "REFUND_AMOUNT_EXCEEDED",
          "This amount exceeds the remaining balance after completed and pending refunds.",
        );
      const [refund] = await Refund.create(
        [
          {
            publicId: nanoid(20),
            paymentId: payment._id,
            requestedBy: req.auth!.userId,
            amountMinor: req.body.amountMinor,
            currency: payment.currency,
            reason: req.body.reason.trim(),
            idempotencyKey,
            requestHash,
            provider: payment.provider,
            source: req.auth!.role === "ADMIN" ? "ADMIN" : "OWNER",
            status: offline ? "PROCESSED" : "PROCESSING",
            transferReversalStatus:
              !offline && payment.purpose === "MEMBERSHIP"
                ? "PENDING"
                : "NOT_APPLICABLE",
            ...(offline
              ? {
                  processedAt: new Date(),
                  offlineReference: req.body.offlineReference,
                }
              : {
                  providerRequestStartedAt: new Date(),
                  reconciliationRequired: true,
                }),
          },
        ],
        { session },
      );
      await AuditLog.create(
        [
          {
            actorId: req.auth!.userId,
            actorRole: req.auth!.role,
            gymId: payment.gymId,
            action: offline ? "OFFLINE_REFUND_RECORDED" : "REFUND_RESERVED",
            entityType: "Refund",
            entityId: refund.publicId,
            outcome: "SUCCESS",
            requestId: req.requestId,
            after: {
              paymentId: payment.publicId,
              amountMinor: refund.amountMinor,
              provider: payment.provider,
              externalTransferInitiated: false,
              providerSubmissionReserved: !offline,
            },
          },
        ],
        { session },
      );
      await updatePaymentRefundStatus(payment, session);
      if (offline)
        await emitDomainEvent({
          event: "payment.refunded",
          userId: payment.payerId,
          gymId: payment.gymId,
          entityId: refund.publicId,
          actionUrl: "/notifications",
          session,
        });
      return { refund, payment, created: true };
    });
  } catch (error: any) {
    if (error?.code !== 11000) throw error;
    const existing = await Refund.findOne({ idempotencyKey });
    if (!existing) throw error;
    return replay(existing);
  }
}

export async function reconcileRefundEvent(event: string, entity: any) {
  if (
    !entity ||
    typeof entity.id !== "string" ||
    typeof entity.payment_id !== "string" ||
    !Number.isSafeInteger(entity.amount) ||
    entity.amount <= 0 ||
    typeof entity.currency !== "string"
  )
    throw new AppError(
      422,
      "REFUND_EVENT_INVALID",
      "The refund event is missing required financial details.",
    );
  return mongoose.connection.transaction(async (session) => {
    const payment = await Payment.findOneAndUpdate(
      {
        providerPaymentId: entity.payment_id,
        provider: "RAZORPAY",
        status: {
          $in: ["CAPTURED", "PARTIALLY_REFUNDED", "REFUND_PENDING", "REFUNDED"],
        },
      },
      { $inc: { __v: 1 } },
      { returnDocument: "after", session },
    );
    if (!payment)
      throw new AppError(
        409,
        "REFUND_PAYMENT_UNKNOWN",
        "The original payment must be reconciled before its refund.",
      );
    const receipt = entity.receipt || entity.notes?.receipt;
    let refund = await Refund.findOne({
      paymentId: payment._id,
      $or: [
        { providerRefundId: entity.id },
        ...(typeof receipt === "string" ? [{ publicId: receipt }] : []),
      ],
    }).session(session);
    if (
      payment.currency !== entity.currency ||
      entity.amount > payment.amountMinor ||
      (refund &&
        (refund.amountMinor !== entity.amount ||
          refund.currency !== entity.currency))
    )
      throw new AppError(
        409,
        "REFUND_EVENT_MISMATCH",
        "The provider refund does not match the recorded amount or currency.",
      );
    const status =
      entity.status === "processed"
        ? "PROCESSED"
        : entity.status === "failed"
          ? "FAILED"
          : "PROCESSING";
    if (
      (event === "refund.processed" && status !== "PROCESSED") ||
      (event === "refund.failed" && status !== "FAILED")
    )
      throw new AppError(
        422,
        "REFUND_EVENT_INVALID",
        "Refund event and status disagree.",
      );
    if (!refund) {
      [refund] = await Refund.create(
        [
          {
            publicId: nanoid(20),
            paymentId: payment._id,
            amountMinor: entity.amount,
            currency: entity.currency,
            reason: "Refund reported by the payment provider",
            source: "PROVIDER",
            provider: "RAZORPAY",
            providerRefundId: entity.id,
            idempotencyKey: `provider:${entity.id}`,
            status: "PROCESSING",
          },
        ],
        { session },
      );
    }
    // Out-of-order created/failed deliveries cannot undo a confirmed refund.
    if (
      refund.status !== "PROCESSED" &&
      !(refund.status === "FAILED" && status === "PROCESSING")
    ) {
      refund.providerRefundId = entity.id;
      refund.status = status;
      refund.reconciliationRequired = false;
      refund.failureReason =
        status === "FAILED" ? "Provider confirmed refund failure" : undefined;
      if (status === "PROCESSED") refund.processedAt = new Date();
      await refund.save({ session });
    }
    const amounts = await totals(payment._id, session);
    if (amounts.processed > payment.amountMinor)
      throw new AppError(
        409,
        "REFUND_LEDGER_CONFLICT",
        "Provider refund totals exceed the original payment; manual reconciliation is required.",
      );
    await updatePaymentRefundStatus(payment, session);
    if (refund.status === "PROCESSED")
      await emitDomainEvent({
        event: "payment.refunded",
        userId: payment.payerId,
        gymId: payment.gymId,
        entityId: refund.publicId,
        actionUrl: "/notifications",
        session,
      });
    await AuditLog.create(
      [
        {
          actorRole: "SYSTEM",
          gymId: payment.gymId,
          action: "REFUND_PROVIDER_RECONCILED",
          entityType: "Refund",
          entityId: refund.publicId,
          outcome: "SUCCESS",
          after: { status: refund.status, providerRefundId: entity.id },
        },
      ],
      { session },
    );
    return refund;
  });
}

export async function submitRefund(req: Request) {
  const result = await reserveRefund(req);
  if (!result.created || result.payment.provider === "OFFLINE")
    return result.refund;
  let reversalSubmitted = false;
  try {
    let reverseAll = false;
    if (result.payment.purpose === "MEMBERSHIP") {
      const transfer = await RouteTransfer.findOne({
        paymentId: result.payment._id,
        provider: "RAZORPAY",
      });
      if (!transfer)
        throw new AppError(
          409,
          "ROUTE_TRANSFER_NOT_RECONCILED",
          "The original gym transfer must be reconciled before issuing a refund.",
        );
      const reversibleMinor =
        transfer.amountMinor - transfer.amountReversedMinor;
      if (result.refund.amountMinor > reversibleMinor)
        throw new AppError(
          409,
          "TRANSFER_REVERSAL_AMOUNT_EXCEEDED",
          "The refund exceeds the amount still reversible from the gym beneficiary.",
        );
      reverseAll =
        result.refund.amountMinor === result.payment.amountMinor &&
        transfer.amountReversedMinor === 0;
      if (!reverseAll) {
        const reversal: any = await paymentProvider.reverseTransfer(
          transfer.providerTransferId,
          result.refund.amountMinor,
          result.refund.publicId,
        );
        if (!reversal?.id)
          throw new AppError(
            502,
            "TRANSFER_REVERSAL_UNCERTAIN",
            "Razorpay did not return a reversal reference. Reconcile before retrying.",
          );
        reversalSubmitted = true;
        await Refund.updateOne(
          { _id: result.refund._id },
          {
            $set: {
              providerReversalId: reversal.id,
              // API acceptance is submission evidence, not confirmation that
              // the beneficiary funds were reversed. The Route transfer
              // webhook/reconciliation promotes this to PROCESSED.
              transferReversalStatus: "PENDING",
            },
          },
        );
      }
    }
    const provider: any = await paymentProvider.refundPayment(
      result.payment.providerPaymentId,
      result.refund.amountMinor,
      result.refund.publicId,
      { reverseAll },
    );
    const reconciled = await reconcileRefundEvent("refund.created", {
      ...provider,
      receipt: result.refund.publicId,
    });
    if (reverseAll)
      await Refund.updateOne(
        { _id: result.refund._id },
        { $set: { transferReversalStatus: "PENDING" } },
      );
    return reconciled;
  } catch (error: any) {
    // A timeout or database error after the HTTP request is an unknown outcome.
    // Never release the reservation or start another transfer for this key.
    if (
      error instanceof AppError &&
      error.code === "PAYMENT_PROVIDER_NOT_CONFIGURED"
    ) {
      await mongoose.connection.transaction(async (session) => {
        const payment = await Payment.findOneAndUpdate(
          { _id: result.payment._id },
          { $inc: { __v: 1 } },
          { returnDocument: "after", session },
        );
        await Refund.updateOne(
          { _id: result.refund._id, status: "PROCESSING" },
          {
            $set: {
              status: "FAILED",
              reconciliationRequired: false,
              failureReason: "Provider not configured; no refund was submitted",
            },
          },
          { session },
        );
        await updatePaymentRefundStatus(payment, session);
      });
      throw error;
    }
    if (
      error instanceof AppError &&
      [
        "PAYMENT_PROVIDER_ERROR",
        "ROUTE_TRANSFER_NOT_RECONCILED",
        "TRANSFER_REVERSAL_AMOUNT_EXCEEDED",
      ].includes(error.code) &&
      !reversalSubmitted
    ) {
      await mongoose.connection.transaction(async (session) => {
        const payment = await Payment.findOneAndUpdate(
          { _id: result.payment._id },
          { $inc: { __v: 1 } },
          { returnDocument: "after", session },
        );
        await Refund.updateOne(
          { _id: result.refund._id, status: "PROCESSING" },
          {
            $set: {
              status: "FAILED",
              reconciliationRequired: false,
              transferReversalStatus: "FAILED",
              failureReason: "No refund was submitted because the Route reversal could not be confirmed.",
            },
          },
          { session },
        );
        await updatePaymentRefundStatus(payment, session);
      });
      throw error;
    }
    const refund = await Refund.findOneAndUpdate(
      { _id: result.refund._id, status: "PROCESSING" },
      {
        $set: {
          reconciliationRequired: true,
          transferReversalStatus: result.payment.purpose === "MEMBERSHIP"
            ? "RECONCILIATION_REQUIRED"
            : "NOT_APPLICABLE",
          failureReason:
            "Provider outcome pending. Await its webhook or reconcile the provider refund before retrying.",
        },
      },
      { returnDocument: "after" },
    );
    return refund || (await Refund.findById(result.refund._id));
  }
}

export async function reconcileReservedRefund(publicId: string) {
  const refund = await Refund.findOne({ publicId });
  if (!refund)
    throw new AppError(404, "REFUND_NOT_FOUND", "Refund record not found.");
  const payment = await Payment.findById(refund.paymentId);
  if (!payment || payment.provider !== "RAZORPAY" || !payment.providerPaymentId)
    throw new AppError(
      409,
      "REFUND_RECONCILIATION_UNAVAILABLE",
      "Only a Razorpay refund with an original provider payment can be reconciled here.",
    );
  const providerRefunds = await paymentProvider.getPaymentRefunds(
    payment.providerPaymentId,
  );
  const entity = providerRefunds.find(
    (candidate) =>
      candidate.id === refund.providerRefundId ||
      candidate.receipt === refund.publicId ||
      candidate.notes?.receipt === refund.publicId,
  );
  if (!entity) {
    refund.reconciliationRequired = true;
    refund.failureReason =
      "Razorpay has not returned a matching refund. Do not resubmit while the original provider outcome remains uncertain.";
    await refund.save();
    return refund;
  }
  const event =
    entity.status === "processed"
      ? "refund.processed"
      : entity.status === "failed"
        ? "refund.failed"
        : "refund.created";
  return reconcileRefundEvent(event, entity);
}
