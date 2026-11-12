import crypto from "node:crypto";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import type { CreatePaymentInput, ProviderPaymentOrder, ProviderRefund } from "./paymentProvider.js";

export interface RazorpayOAuthTokens {
  access_token: string;
  refresh_token: string;
  public_token: string;
  token_type: "Bearer" | string;
  expires_in: number | string;
  razorpay_account_id?: string;
}

export function oauthConfigurationBlockers() {
  const blockers: string[] = [];
  if (!env.RAZORPAY_GYM_OAUTH_ENABLED)
    blockers.push("Razorpay gym merchant OAuth is disabled.");
  if (!env.RAZORPAY_OAUTH_CLIENT_ID) blockers.push("RAZORPAY_OAUTH_CLIENT_ID is not configured.");
  if (!env.RAZORPAY_OAUTH_CLIENT_SECRET) blockers.push("RAZORPAY_OAUTH_CLIENT_SECRET is not configured.");
  if (!env.RAZORPAY_OAUTH_REDIRECT_URI) blockers.push("RAZORPAY_OAUTH_REDIRECT_URI is not configured.");
  if (!env.RAZORPAY_OAUTH_WEBHOOK_SECRET) blockers.push("RAZORPAY_OAUTH_WEBHOOK_SECRET is not configured.");
  if (!env.PAYMENT_TOKEN_ENCRYPTION_KEY) blockers.push("PAYMENT_TOKEN_ENCRYPTION_KEY is not configured.");
  return blockers;
}

function requireOAuthConfiguration() {
  const blocker = oauthConfigurationBlockers()[0];
  if (blocker) throw new AppError(503, "RAZORPAY_OAUTH_NOT_CONFIGURED", blocker);
}

async function jsonRequest<T>(url: string, init: RequestInit, uncertain = false): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new AppError(
      502,
      uncertain ? "PAYMENT_PROVIDER_UNCERTAIN" : "RAZORPAY_OAUTH_UNAVAILABLE",
      uncertain
        ? "Razorpay did not return a conclusive response. Reconcile before retrying."
        : "Razorpay authorization is temporarily unavailable.",
    );
  }
  const body = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new AppError(
    response.status >= 500 ? 502 : 409,
    "RAZORPAY_PROVIDER_ERROR",
    "Razorpay could not complete this operation.",
    {
      providerCode: body?.error?.code || body?.error || "RAZORPAY_REQUEST_FAILED",
      providerReason: body?.error?.reason,
    },
  );
  return body as T;
}

export function buildRazorpayAuthorizeUrl(state: string) {
  requireOAuthConfiguration();
  const url = new URL("https://auth.razorpay.com/authorize");
  url.searchParams.set("client_id", env.RAZORPAY_OAUTH_CLIENT_ID!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", env.RAZORPAY_OAUTH_REDIRECT_URI!);
  url.searchParams.set("scope", "read_write");
  url.searchParams.set("state", state);
  return url.toString();
}

export function exchangeRazorpayAuthorizationCode(code: string) {
  requireOAuthConfiguration();
  return jsonRequest<RazorpayOAuthTokens>("https://auth.razorpay.com/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.RAZORPAY_OAUTH_CLIENT_ID,
      client_secret: env.RAZORPAY_OAUTH_CLIENT_SECRET,
      grant_type: "authorization_code",
      redirect_uri: env.RAZORPAY_OAUTH_REDIRECT_URI,
      code,
      mode: env.RAZORPAY_MODE,
    }),
  });
}

export function refreshRazorpayOAuthToken(refreshToken: string) {
  requireOAuthConfiguration();
  return jsonRequest<RazorpayOAuthTokens>("https://auth.razorpay.com/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.RAZORPAY_OAUTH_CLIENT_ID,
      client_secret: env.RAZORPAY_OAUTH_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
}

export function revokeRazorpayOAuthToken(accessToken: string) {
  requireOAuthConfiguration();
  return jsonRequest<{ message?: string }>("https://auth.razorpay.com/revoke", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.RAZORPAY_OAUTH_CLIENT_ID,
      client_secret: env.RAZORPAY_OAUTH_CLIENT_SECRET,
      token_type_hint: "access_token",
      token: accessToken,
    }),
  }, true);
}

export class GymOAuthPaymentClient {
  constructor(
    private readonly accessToken: string,
    readonly merchantAccountId: string,
  ) {}

  private request<T>(path: string, init: RequestInit, uncertain = false) {
    return jsonRequest<T>(`https://api.razorpay.com${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
    }, uncertain);
  }

  async createOrder(input: CreatePaymentInput): Promise<ProviderPaymentOrder> {
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor < 100)
      throw new AppError(422, "PAYMENT_AMOUNT_INVALID", "Razorpay checkout requires at least INR 1 in paise.");
    if (input.currency !== "INR")
      throw new AppError(422, "PAYMENT_CURRENCY_UNSUPPORTED", "GETFIT4U Razorpay checkout supports INR only.");
    if (input.transfers?.length)
      throw new AppError(422, "OAUTH_TRANSFER_FORBIDDEN", "Gym OAuth orders cannot include Route transfers.");
    return this.request<ProviderPaymentOrder>("/v1/orders", {
      method: "POST",
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        receipt: input.receipt,
        partial_payment: false,
        payment_capture: 1,
        notes: input.notes,
      }),
    }, true);
  }

  getPayment(paymentId: string) {
    return this.request<Record<string, any>>(`/v1/payments/${encodeURIComponent(paymentId)}`, { method: "GET" });
  }

  refundPayment(paymentId: string, amountMinor: number, receipt: string) {
    return this.request<ProviderRefund>(`/v1/payments/${encodeURIComponent(paymentId)}/refund`, {
      method: "POST",
      headers: { "X-Refund-Idempotency": receipt },
      body: JSON.stringify({ amount: amountMinor, receipt, notes: { receipt } }),
    }, true);
  }

  async getPaymentRefunds(paymentId: string) {
    const response = await this.request<{ items?: ProviderRefund[] }>(
      `/v1/payments/${encodeURIComponent(paymentId)}/refunds`,
      { method: "GET" },
    );
    return response.items || [];
  }
}

function safeHexEqual(candidate: string, expected: string) {
  if (!/^[a-f\d]{64}$/i.test(candidate)) return false;
  return crypto.timingSafeEqual(Buffer.from(candidate, "hex"), Buffer.from(expected, "hex"));
}

export function verifyOAuthCheckoutSignature(input: {
  orderId: string;
  paymentId: string;
  signature: string;
}) {
  if (!env.RAZORPAY_OAUTH_CLIENT_SECRET) return false;
  const expected = crypto.createHmac("sha256", env.RAZORPAY_OAUTH_CLIENT_SECRET)
    .update(`${input.orderId}|${input.paymentId}`)
    .digest("hex");
  return safeHexEqual(input.signature, expected);
}

export function verifyRazorpayWebhook(rawBody: Buffer, signature: string, secret?: string) {
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeHexEqual(signature, expected);
}
