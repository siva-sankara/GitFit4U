import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import type {
  CreatePaymentInput,
  PaymentProvider,
  ProviderPaymentOrder,
  ProviderRefund,
  ProviderLinkedAccount,
  ProviderProductConfiguration,
  ProviderTransfer,
} from "./paymentProvider.js";

function configurationBlocker() {
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET)
    return "Razorpay server credentials are not configured.";
  const expectedPrefix = env.RAZORPAY_MODE === "live" ? "rzp_live_" : "rzp_test_";
  if (!env.RAZORPAY_KEY_ID.startsWith(expectedPrefix))
    return `RAZORPAY_KEY_ID does not match RAZORPAY_MODE=${env.RAZORPAY_MODE}.`;
  return null;
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const blocker = configurationBlocker();
  if (blocker)
    throw new AppError(
      503,
      "PAYMENT_PROVIDER_NOT_CONFIGURED",
      blocker,
    );
  let response: Response;
  try {
    response = await fetch(`https://api.razorpay.com${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString("base64")}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
  } catch {
    throw new AppError(
      502,
      "PAYMENT_PROVIDER_UNCERTAIN",
      "Razorpay did not return a conclusive response. Reconcile this operation before retrying.",
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as any;
    throw new AppError(
      response.status >= 500 ? 502 : 409,
      "PAYMENT_PROVIDER_ERROR",
      "Razorpay could not complete the payment operation.",
      {
        providerCode: body?.error?.code || "RAZORPAY_REQUEST_FAILED",
        providerReason: body?.error?.reason,
        providerStep: body?.error?.step,
      },
    );
  }
  return (await response.json()) as T;
}

function safeHexEqual(candidate: string, expected: string) {
  if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
  return crypto.timingSafeEqual(
    Buffer.from(candidate.toLowerCase(), "hex"),
    Buffer.from(expected.toLowerCase(), "hex"),
  );
}

export class RazorpayProvider implements PaymentProvider {
  configurationBlocker() {
    return configurationBlocker();
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<ProviderPaymentOrder> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 100)
      throw new AppError(
        422,
        "PAYMENT_AMOUNT_INVALID",
        "Razorpay checkout requires at least INR 1 in paise.",
      );
    if (input.currency !== "INR")
      throw new AppError(
        422,
        "PAYMENT_CURRENCY_UNSUPPORTED",
        "GETFIT4U Razorpay checkout currently supports INR only.",
      );
    if (input.transfers?.length) {
      if (input.transfers.length !== 1)
        throw new AppError(
          422,
          "ROUTE_TRANSFER_INVALID",
          "A gym membership order must have exactly one approved beneficiary.",
        );
      const transfer = input.transfers[0];
      if (
        !/^acc_[A-Za-z0-9]+$/.test(transfer.account) ||
        transfer.currency !== "INR" ||
        !Number.isSafeInteger(transfer.amount) ||
        transfer.amount <= 0 ||
        transfer.amount > input.amountMinor
      )
        throw new AppError(
          422,
          "ROUTE_TRANSFER_INVALID",
          "The server-resolved Route transfer is invalid.",
        );
    }
    return request("/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        partial_payment: false,
        payment_capture: 1,
        notes: input.notes,
        ...(input.transfers?.length ? { transfers: input.transfers } : {}),
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
    return safeHexEqual(input.signature, expected);
  }
  getPaymentStatus(paymentId: string) {
    return request<Record<string, unknown>>(
      `/v1/payments/${encodeURIComponent(paymentId)}`,
      { method: "GET" },
    );
  }

  async getOrderTransfers(orderId: string) {
    const response = await request<{ items?: ProviderTransfer[] }>(
      `/v1/orders/${encodeURIComponent(orderId)}/transfers`,
      { method: "GET" },
    );
    return response.items || [];
  }

  async getTransfersForSettlement(settlementId: string) {
    const response = await request<{ items?: ProviderTransfer[] }>(
      `/v1/transfers?recipient_settlement_id=${encodeURIComponent(settlementId)}`,
      { method: "GET" },
    );
    return response.items || [];
  }

  getTransfer(transferId: string) {
    return request<ProviderTransfer>(
      `/v1/transfers/${encodeURIComponent(transferId)}`,
      { method: "GET" },
    );
  }

  getLinkedAccount(accountId: string) {
    return request<ProviderLinkedAccount>(
      `/v2/accounts/${encodeURIComponent(accountId)}`,
      { method: "GET" },
    );
  }

  getProductConfiguration(accountId: string, productId: string) {
    return request<ProviderProductConfiguration>(
      `/v2/accounts/${encodeURIComponent(accountId)}/products/${encodeURIComponent(productId)}`,
      { method: "GET" },
    );
  }

  reverseTransfer(transferId: string, amountMinor: number, receipt: string) {
    return request<Record<string, unknown>>(
      `/v1/transfers/${encodeURIComponent(transferId)}/reversals`,
      {
        method: "POST",
        body: JSON.stringify({
          amount: amountMinor,
          notes: { refund_reference: receipt },
        }),
      },
    );
  }

  refundPayment(
    paymentId: string,
    amountMinor: number,
    receipt: string,
    options?: { reverseAll?: boolean },
  ) {
    return request<ProviderRefund>(
      `/v1/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method: "POST",
        body: JSON.stringify({
          amount: amountMinor,
          ...(options?.reverseAll ? { reverse_all: true } : {}),
          receipt,
          notes: { receipt },
        }),
      },
    );
  }
  async getPaymentRefunds(paymentId: string) {
    const response = await request<{ items?: ProviderRefund[] }>(
      `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      { method: "GET" },
    );
    return response.items || [];
  }
  verifyWebhook(rawBody: Buffer, signature: string) {
    if (!env.RAZORPAY_WEBHOOK_SECRET) return false;
    const expected = crypto
      .createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET)
      .update(rawBody)
      .digest("hex");
    return safeHexEqual(signature, expected);
  }
}
