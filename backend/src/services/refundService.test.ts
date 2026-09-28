import type { Request } from "express";
import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const provider = vi.hoisted(() => ({ refundPayment: vi.fn() }));
vi.mock("../integrations/payments/index.js", () => ({
  paymentProvider: provider,
}));
vi.mock("./domainEventService.js", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));
import { Payment } from "../models/Commerce.js";
import { Refund } from "../models/Business.js";
import { AuditLog } from "../models/Operations.js";
import {
  reconcileRefundEvent,
  reserveRefund,
  submitRefund,
} from "./refundService.js";
const paymentId = new mongoose.Types.ObjectId(),
  actor = String(new mongoose.Types.ObjectId());
let ledger: any[], payment: any, session: any;
function request(
  key = "refund-request-one",
  amountMinor = 60,
  extra: Record<string, unknown> = {},
) {
  return {
    auth: { userId: actor, role: "ADMIN" },
    params: { id: "payment-one" },
    idempotencyKey: key,
    body: { amountMinor, reason: "Requested correction", ...extra },
    header: () => key,
  } as unknown as Request;
}
const matches = (row: any, filter: any): boolean =>
  Object.entries(filter).every(([key, value]) =>
    key === "$or"
      ? (value as any[]).some((part) => matches(row, part))
      : String(row[key]) === String(value),
  );
function query(value: any) {
  return {
    session: async () => value,
    then: (resolve: any, reject: any) =>
      Promise.resolve(value).then(resolve, reject),
  };
}
beforeEach(() => {
  provider.refundPayment.mockReset();
  ledger = [];
  session = { testSession: true };
  payment = {
    _id: paymentId,
    publicId: "payment-one",
    providerPaymentId: "pay_original",
    provider: "RAZORPAY",
    amountMinor: 100,
    currency: "INR",
    status: "CAPTURED",
  };
  let queue = Promise.resolve();
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(((
    work: (session: any) => Promise<any>,
  ) => {
    const job = queue.then(() => work(session));
    queue = job.then(
      () => undefined,
      () => undefined,
    );
    return job;
  }) as never);
  vi.spyOn(Payment, "findOneAndUpdate").mockImplementation((async (
    filter: any,
  ) => {
    if (
      filter.publicId &&
      (filter.publicId !== payment.publicId ||
        !filter.status.$in.includes(payment.status))
    )
      return null;
    if (
      filter.providerPaymentId &&
      filter.providerPaymentId !== payment.providerPaymentId
    )
      return null;
    return payment;
  }) as never);
  vi.spyOn(Payment, "updateOne").mockImplementation((async (
    _filter: any,
    update: any,
  ) => {
    Object.assign(payment, update.$set);
    return {};
  }) as never);
  vi.spyOn(Refund, "findOne").mockImplementation(((filter: any) =>
    query(ledger.find((row) => matches(row, filter)) || null)) as never);
  vi.spyOn(Refund, "findById").mockImplementation((async (id: any) =>
    ledger.find((row) => String(row._id) === String(id))) as never);
  vi.spyOn(Refund, "create").mockImplementation((async (rows: any[]) =>
    rows.map((row) => {
      const record = {
        ...row,
        _id: new mongoose.Types.ObjectId(),
        save: vi.fn().mockResolvedValue(undefined),
      };
      ledger.push(record);
      return record;
    })) as never);
  vi.spyOn(Refund, "aggregate").mockImplementation((() => ({
    session: async () => [
      {
        reserved: ledger
          .filter((row) =>
            ["REQUESTED", "PROCESSING", "PROCESSED"].includes(row.status),
          )
          .reduce((total, row) => total + row.amountMinor, 0),
        processed: ledger
          .filter((row) => row.status === "PROCESSED")
          .reduce((total, row) => total + row.amountMinor, 0),
      },
    ],
  })) as never);
  vi.spyOn(Refund, "findOneAndUpdate").mockImplementation((async (
    filter: any,
    update: any,
  ) => {
    const row = ledger.find((item) => matches(item, filter));
    if (row) Object.assign(row, update.$set);
    return row || null;
  }) as never);
  vi.spyOn(Refund, "updateOne").mockImplementation((async (
    filter: any,
    update: any,
  ) => {
    const row = ledger.find((item) => matches(item, filter));
    if (row) Object.assign(row, update.$set);
    return {};
  }) as never);
  vi.spyOn(AuditLog, "create").mockResolvedValue([] as never);
});
afterEach(() => vi.restoreAllMocks());

it("serializes refund reservations and includes pending refunds in the remaining balance", async () => {
  const results = await Promise.allSettled([
    reserveRefund(request("first-key")),
    reserveRefund(request("second-key")),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(results.find((result) => result.status === "rejected")).toMatchObject({
    reason: { code: "REFUND_AMOUNT_EXCEEDED" },
  });
  expect(ledger).toHaveLength(1);
  expect(payment.status).toBe("REFUND_PENDING");
  expect(Payment.findOneAndUpdate).toHaveBeenCalledWith(
    expect.anything(),
    { $inc: { __v: 1 } },
    { returnDocument: "after", session },
  );
  expect(Refund.aggregate).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({
        $match: expect.objectContaining({
          $or: expect.arrayContaining([
            { status: { $in: ["REQUESTED", "PROCESSING", "PROCESSED"] } },
          ]),
        }),
      }),
    ]),
  );
});
it("keeps an unknown provider result reserved and never submits again on replay", async () => {
  provider.refundPayment.mockRejectedValue(new Error("Network timeout"));
  const first = await submitRefund(request()),
    second = await submitRefund(request());
  expect(first.status).toBe("PROCESSING");
  expect(first.reconciliationRequired).toBe(true);
  expect(second.publicId).toBe(first.publicId);
  expect(provider.refundPayment).toHaveBeenCalledTimes(1);
  expect(ledger).toHaveLength(1);
  expect(payment.status).toBe("REFUND_PENDING");
});
it("rejects a different amount under the same idempotency key", async () => {
  await reserveRefund(request());
  await expect(
    reserveRefund(request("refund-request-one", 40)),
  ).rejects.toMatchObject({ code: "REFUND_KEY_REUSED" });
  expect(ledger).toHaveLength(1);
});
it("records a confirmed offline return transactionally without making a provider call", async () => {
  payment.provider = "OFFLINE";
  delete payment.providerPaymentId;
  const result = await submitRefund(
    request("offline-key", 100, {
      offlineConfirmed: true,
      offlineReference: "cash-receipt",
    }),
  );
  expect(result).toMatchObject({
    status: "PROCESSED",
    provider: "OFFLINE",
    offlineReference: "cash-receipt",
  });
  expect(payment.status).toBe("REFUNDED");
  expect(provider.refundPayment).not.toHaveBeenCalled();
  expect(AuditLog.create).toHaveBeenCalledWith(
    expect.arrayContaining([
      expect.objectContaining({ action: "OFFLINE_REFUND_RECORDED" }),
    ]),
    { session },
  );
});
it("requires explicit confirmation before recording an offline return", async () => {
  payment.provider = "OFFLINE";
  await expect(submitRefund(request())).rejects.toMatchObject({
    code: "OFFLINE_REFUND_CONFIRMATION_REQUIRED",
  });
  expect(ledger).toHaveLength(0);
  expect(provider.refundPayment).not.toHaveBeenCalled();
});
it("reconciles a processed webhook using the original receipt after an API timeout", async () => {
  provider.refundPayment.mockRejectedValue(new Error("Timeout"));
  const pending = await submitRefund(request());
  const entity = {
    id: "rfnd_provider",
    payment_id: "pay_original",
    currency: "INR",
    amount: 60,
    receipt: pending.publicId,
    status: "processed",
  };
  await reconcileRefundEvent("refund.processed", entity);
  await reconcileRefundEvent("refund.created", {
    ...entity,
    status: "pending",
  });
  expect(ledger).toHaveLength(1);
  expect(ledger[0]).toMatchObject({
    status: "PROCESSED",
    providerRefundId: "rfnd_provider",
    reconciliationRequired: false,
  });
  expect(payment.status).toBe("PARTIALLY_REFUNDED");
});
it("does not apply a provider event with a different amount to a reserved refund", async () => {
  const reservation = await reserveRefund(request());
  await expect(
    reconcileRefundEvent("refund.processed", {
      id: "rfnd_provider",
      payment_id: "pay_original",
      currency: "INR",
      amount: 90,
      receipt: reservation.refund.publicId,
      status: "processed",
    }),
  ).rejects.toMatchObject({ code: "REFUND_EVENT_MISMATCH" });
  expect(ledger[0].status).toBe("PROCESSING");
});
