import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import type { CreatePaymentInput, ProviderPaymentOrder, ProviderRefund } from "./paymentProvider.js";

type TokenResponse = {
  access_token: string;
  expires_at: number;
  token_type: string;
};

type OrderStatus = {
  orderId: string;
  state: "PENDING" | "COMPLETED" | "FAILED";
  amount: number;
  expireAt?: number;
  merchantId?: string;
  paymentDetails?: Array<{
    transactionId?: string;
    paymentMode?: string;
    state?: string;
    amount?: number;
    timestamp?: number;
    errorCode?: string;
    detailedErrorCode?: string;
  }>;
};

const endpoints = () =>
  env.PHONEPE_ENV === "production"
    ? {
        token: "https://api.phonepe.com/apis/identity-manager/v1/oauth/token",
        checkout: "https://api.phonepe.com/apis/pg/checkout/v2",
        payments: "https://api.phonepe.com/apis/pg/payments/v2",
      }
    : {
        token: "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
        checkout: "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2",
        payments: "https://api-preprod.phonepe.com/apis/pg-sandbox/payments/v2",
      };

function configured() {
  return Boolean(
    env.PHONEPE_CLIENT_ID &&
      env.PHONEPE_CLIENT_SECRET &&
      env.PHONEPE_CLIENT_VERSION &&
      env.PHONEPE_MERCHANT_ID,
  );
}

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export class PhonePeProvider {
  private token?: { value: string; expiresAt: number; scope: string };

  private requireConfiguration() {
    if (!configured())
      throw new AppError(
        503,
        "PHONEPE_NOT_CONFIGURED",
        "PhonePe checkout is unavailable until its server credentials are configured.",
      );
  }

  private async authorization() {
    this.requireConfiguration();
    const scope = `${env.PHONEPE_ENV}:${env.PHONEPE_CLIENT_ID}:${env.PHONEPE_CLIENT_VERSION}`;
    const now = Math.floor(Date.now() / 1000);
    if (this.token?.scope === scope && this.token.expiresAt > now + 60)
      return this.token.value;
    const body = new URLSearchParams({
      client_id: env.PHONEPE_CLIENT_ID!,
      client_version: env.PHONEPE_CLIENT_VERSION!,
      client_secret: env.PHONEPE_CLIENT_SECRET!,
      grant_type: "client_credentials",
    });
    const response = await fetch(endpoints().token, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new AppError(
        502,
        "PHONEPE_AUTHORIZATION_FAILED",
        "PhonePe rejected the configured checkout credentials.",
      );
    const result = (await response.json()) as TokenResponse;
    if (!result.access_token || result.token_type !== "O-Bearer")
      throw new AppError(
        502,
        "PHONEPE_AUTHORIZATION_INVALID",
        "PhonePe returned an invalid authorization response.",
      );
    this.token = {
      value: result.access_token,
      expiresAt: Number(result.expires_at || now + 300),
      scope,
    };
    return result.access_token;
  }

  private async request<T>(url: string, init: RequestInit): Promise<T> {
    const token = await this.authorization();
    const response = await fetch(url, {
      ...init,
      headers: {
        "content-type": "application/json",
        authorization: `O-Bearer ${token}`,
        ...init.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok)
      throw new AppError(
        response.status === 401 || response.status === 403 ? 502 : 502,
        "PHONEPE_PROVIDER_ERROR",
        "PhonePe could not complete the payment request.",
      );
    return (await response.json()) as T;
  }

  async createPayment(input: CreatePaymentInput): Promise<ProviderPaymentOrder> {
    if (input.currency !== "INR" || !Number.isSafeInteger(input.amountMinor) || input.amountMinor < 100)
      throw new AppError(422, "PHONEPE_AMOUNT_INVALID", "PhonePe checkout requires at least INR 1 in paise.");
    if (!input.redirectUrl)
      throw new AppError(500, "PHONEPE_REDIRECT_REQUIRED", "A safe payment return URL is required.");
    const result = await this.request<{
      orderId: string;
      state: string;
      expireAt: number;
      redirectUrl: string;
    }>(`${endpoints().checkout}/pay`, {
      method: "POST",
      body: JSON.stringify({
        merchantOrderId: input.receipt.slice(0, 63),
        amount: input.amountMinor,
        expireAfter: 900,
        metaInfo: {
          udf1: input.notes?.paymentId || "",
          udf2: input.notes?.purpose || "",
        },
        paymentFlow: {
          type: "PG_CHECKOUT",
          message: "GETFIT4U payment",
          merchantUrls: { redirectUrl: input.redirectUrl },
        },
      }),
    });
    if (!result.orderId || !result.redirectUrl)
      throw new AppError(502, "PHONEPE_ORDER_INVALID", "PhonePe returned an incomplete checkout order.");
    return {
      id: input.receipt.slice(0, 63),
      amount: input.amountMinor,
      currency: input.currency,
      status: result.state,
      redirectUrl: result.redirectUrl,
      gatewayOrderId: result.orderId,
    };
  }

  getOrderStatus(merchantOrderId: string) {
    return this.request<OrderStatus>(
      `${endpoints().checkout}/order/${encodeURIComponent(merchantOrderId)}/status?details=true&errorContext=true`,
      { method: "GET" },
    );
  }

  async refundPayment(merchantOrderId: string, amountMinor: number, receipt: string): Promise<ProviderRefund> {
    const result = await this.request<{ refundId: string; amount: number; state: string }>(
      `${endpoints().payments}/refund`,
      {
        method: "POST",
        body: JSON.stringify({
          merchantRefundId: receipt.slice(0, 63),
          originalMerchantOrderId: merchantOrderId,
          amount: amountMinor,
        }),
      },
    );
    return { id: result.refundId, paymentId: merchantOrderId, amount: result.amount, status: result.state };
  }

  verifyWebhook(rawBody: Buffer, headers: Record<string, string | undefined>) {
    if (env.PHONEPE_WEBHOOK_AUTH_MODE === "sha") {
      if (!env.PHONEPE_WEBHOOK_USERNAME || !env.PHONEPE_WEBHOOK_PASSWORD) return false;
      const provided = (headers.authorization || "").replace(/^SHA256\s+/i, "").trim();
      const expected = crypto
        .createHash("sha256")
        .update(`${env.PHONEPE_WEBHOOK_USERNAME}:${env.PHONEPE_WEBHOOK_PASSWORD}`)
        .digest("hex");
      return /^[a-f0-9]{64}$/i.test(provided) && safeEqual(provided.toLowerCase(), expected);
    }
    // PhonePe's public HMAC page does not publish an unambiguous primitive and
    // encoding. Never guess a verification algorithm for financial webhooks.
    // Use SHA mode, or add the account-specific HMAC contract/official verifier.
    return false;
  }

  webhookConfigurationBlocker() {
    if (!env.PHONEPE_WEBHOOK_AUTH_MODE) return "PHONEPE_WEBHOOK_AUTH_MODE is not configured.";
    if (env.PHONEPE_WEBHOOK_AUTH_MODE === "hmac")
      return "HMAC verification requires the exact PhonePe account contract or official verifier; configure documented SHA mode meanwhile.";
    if (!env.PHONEPE_WEBHOOK_USERNAME || !env.PHONEPE_WEBHOOK_PASSWORD)
      return "PHONEPE_WEBHOOK_USERNAME and PHONEPE_WEBHOOK_PASSWORD are required for SHA mode.";
    return null;
  }
}

export const phonePeProvider = new PhonePeProvider();
