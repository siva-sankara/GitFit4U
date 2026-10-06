import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { z } from "zod";
import { Payment, Subscription } from "../models/Commerce.js";
import { MemberProfile } from "../models/Member.js";
import { AppError } from "../utils/AppError.js";
import { ensurePaymentInvoice } from "../services/invoiceService.js";
import { emitDomainEvent } from "../services/domainEventService.js";
import { prepareMemberWhatsAppReminder } from "../services/memberReminderService.js";
import { writeAudit } from "../services/auditService.js";

const collectInput = z.object({
  method: z.enum(["CASH", "UPI", "CARD_POS", "BANK_TRANSFER", "OTHER"]),
  paidAt: z.coerce.date(),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(1000).optional(),
}).strict();

export async function collectPayment(req: Request, res: Response) {
  const body = collectInput.parse(req.body);
  const paymentId = String(req.params.id);
  if (body.paidAt > new Date())
    throw new AppError(422, "PAYMENT_DATE_INVALID", "Payment date cannot be in the future.");
  const result = await mongoose.connection.transaction(async (session) => {
    const previous: any = await Payment.findOne({
      publicId: paymentId,
      gymId: req.auth!.gymId,
      purpose: "MEMBERSHIP",
      status: { $in: ["CREATED", "PENDING", "AUTHORIZED", "FAILED", "CANCELLED"] },
    }).session(session);
    if (!previous)
      throw new AppError(409, "PAYMENT_NOT_COLLECTABLE", "This payment is not available for offline collection.");
    const subscription: any = await Subscription.findOne({
      _id: previous.subscriptionId,
      gymId: req.auth!.gymId,
      type: "GYM_MEMBERSHIP",
    }).session(session);
    if (!subscription)
      throw new AppError(409, "MEMBERSHIP_NOT_FOUND", "The linked membership is unavailable.");
    const existing = await Payment.findOne({
      gymId: req.auth!.gymId,
      subscriptionId: subscription._id,
      provider: "OFFLINE",
      status: "CAPTURED",
      "metadata.sourcePaymentId": previous.publicId,
    }).session(session);
    if (existing) return { payment: existing, subscription, duplicate: true };
    const [payment] = await Payment.create([{
      publicId: nanoid(24), purpose: "MEMBERSHIP", payerId: previous.payerId,
      gymId: previous.gymId, subscriptionId: subscription._id,
      amountMinor: previous.amountMinor, currency: previous.currency,
      provider: "OFFLINE", methodCategory: body.method, status: "CAPTURED",
      capturedAt: body.paidAt,
      metadata: { collectorId: req.auth!.userId, reference: body.reference, notes: body.notes, sourcePaymentId: previous.publicId },
    }], { session });
    if (["CREATED", "PENDING", "AUTHORIZED"].includes(previous.status)) {
      previous.status = "CANCELLED";
      previous.failureDescription = "Replaced by an authorized offline collection record.";
      await previous.save({ session });
    }
    subscription.latestPaymentId = payment._id;
    subscription.status = "ACTIVE";
    await subscription.save({ session });
    await ensurePaymentInvoice(payment, { session, subscription });
    await emitDomainEvent({ event: "payment.offline", userId: previous.payerId, gymId: previous.gymId, entityId: payment.publicId, actionUrl: "/app/profile?section=payments", session });
    await emitDomainEvent({ event: "membership.activated", userId: previous.payerId, gymId: previous.gymId, entityId: subscription.publicId, occurrenceId: payment.publicId, actionUrl: "/app/subscriptions", session });
    return { payment, subscription, duplicate: false };
  });
  await writeAudit(req, { action: "payment.offline.collected", entityType: "Payment", entityId: result.payment.publicId, after: { sourcePaymentId: paymentId, duplicate: result.duplicate } });
  res.status(result.duplicate ? 200 : 201).json({ success: true, data: result });
}

export async function remindPayment(req: Request, res: Response) {
  const paymentId = String(req.params.id);
  const payment: any = await Payment.findOne({
    publicId: paymentId,
    gymId: req.auth!.gymId,
    purpose: "MEMBERSHIP",
    status: { $in: ["CREATED", "PENDING", "AUTHORIZED", "FAILED", "CANCELLED"] },
  }).select("subscriptionId").lean();
  if (!payment) throw new AppError(404, "PAYMENT_NOT_FOUND", "Payment not found.");
  const member: any = await MemberProfile.findOne({
    gymId: req.auth!.gymId,
    currentSubscriptionId: payment.subscriptionId,
    status: { $ne: "ARCHIVED" },
  }).select("publicId").lean();
  if (!member) throw new AppError(409, "MEMBER_NOT_FOUND", "The linked member is unavailable.");
  const data = await prepareMemberWhatsAppReminder({
    gymId: req.auth!.gymId!, actorId: req.auth!.userId,
    memberPublicId: member.publicId, idempotencyKey: req.idempotencyKey!,
    requestedReason: "payment_reminder",
  });
  if (!data.duplicate) {
    const io = req.app.get("io");
    io?.to(`conversation:${data.conversationPublicId}`).emit("message.created", data.inAppMessage);
    if (data.notificationId) io?.to(`user:${data.recipientUserId}`).emit("notification.created", { id: data.notificationId });
  }
  await writeAudit(req, { action: "payment.reminder.sent", entityType: "Payment", entityId: paymentId, after: { mode: data.mode, status: data.status, duplicate: data.duplicate } });
  res.status(data.mode === "integrated" ? 202 : 200).json({ success: true, data: { mode: data.mode, status: data.status, waUrl: data.waUrl, message: data.message, duplicate: data.duplicate } });
}
