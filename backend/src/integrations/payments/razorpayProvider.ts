import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import type {
  CreatePaymentInput,
  PaymentProvider,
  ProviderPaymentOrder,
  ProviderRefund,
} from "./paymentProvider.js";

async function request<T>(path: string, init: RequestInit): Promise<T> {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)
    throw new AppError(
      503,
      "PAYMENT_PROVIDER_NOT_CONFIGURED",
      "Online payment is not configured.",
    );
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    signal: AbortSignal.timeout(15000),
    headers: {
      authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!response.ok)
    throw new AppError(
      502,
      "PAYMENT_PROVIDER_ERROR",
      "The payment provider could not complete the request.",
    );
  return (await response.json()) as T;
}

export class RazorpayProvider implements PaymentProvider {
  async createPayment(
    input: CreatePaymentInput,
  ): Promise<ProviderPaymentOrder> {
    if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
      throw new AppError(
        503,
        "PAYMENT_PROVIDER_NOT_CONFIGURED",
        "Online payment is not configured. Contact support.",
      );
    }
    return request("/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        payment_capture: 1,
        notes: input.notes,
      }),
    });
  }
  verifyCheckout(input: {
    orderId: string;
    paymentId: string;
    signature: string;
  }) {
    if (!env.RAZORPAY_KEY_SECRET) return false;
    const expected = crypto
      .createHmac("sha256", env.RAZORPAY_KEY_SECRET)
      .update(`${input.orderId}|${input.paymentId}`)
      .digest("hex");
    return (
      /^[a-f0-9]{64}$/i.test(input.signature) &&
      crypto.timingSafeEqual(
        Buffer.from(input.signature),
        Buffer.from(expected),
      )
    );
  }
  getPaymentStatus(paymentId: string) {
    return request<Record<string, unknown>>(
      `/payments/${encodeURIComponent(paymentId)}`,
      { method: "GET" },
    );
  }
  refundPayment(paymentId: string, amountMinor: number, receipt: string) {
    return request<ProviderRefund>(
      `/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method: "POST",
        headers: { "X-Refund-Idempotency": receipt },
        body: JSON.stringify({
          amount: amountMinor,
          receipt,
          notes: { receipt },
        }),
      },
    );
  }
  verifyWebhook(rawBody: Buffer, signature: string) {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
    const expected = crypto
      .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    return (
      /^[a-f0-9]{64}$/i.test(signature) &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
    );
  }
}
