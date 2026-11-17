import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env.js", () => ({
  env: {
    RAZORPAY_MODE: "test",
    RAZORPAY_GYM_OAUTH_ENABLED: true,
    RAZORPAY_OAUTH_CLIENT_ID: "oauth-client",
    RAZORPAY_OAUTH_CLIENT_SECRET: "oauth-client-secret",
    RAZORPAY_OAUTH_REDIRECT_URI: "https://api.getfit4u.in/api/v1/payments/razorpay/oauth/callback",
    RAZORPAY_OAUTH_WEBHOOK_SECRET: "oauth-webhook-secret",
    PAYMENT_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
  },
}));

import {
  GymOAuthPaymentClient,
  buildRazorpayAuthorizeUrl,
  exchangeRazorpayAuthorizationCode,
  verifyOAuthCheckoutSignature,
  verifyRazorpayWebhook,
} from "./razorpayOAuthProvider.js";

afterEach(() => vi.unstubAllGlobals());

describe("Razorpay gym merchant OAuth provider", () => {
  it("builds a read_write authorization request with exact state and redirect URI", () => {
    const url = new URL(buildRazorpayAuthorizeUrl("state-value"));
    expect(url.origin + url.pathname).toBe("https://auth.razorpay.com/authorize");
    expect(url.searchParams.get("client_id")).toBe("oauth-client");
    expect(url.searchParams.get("scope")).toBe("read_write");
    expect(url.searchParams.get("state")).toBe("state-value");
    expect(url.searchParams.get("redirect_uri")).toBe("https://api.getfit4u.in/api/v1/payments/razorpay/oauth/callback");
  });

  it("exchanges the framework-decoded code and explicitly selects test mode", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      access_token: "private", refresh_token: "refresh", public_token: "rzp_test_oauth_public",
      token_type: "Bearer", expires_in: 60, razorpay_account_id: "acc_GymA",
    }) });
    vi.stubGlobal("fetch", fetcher);
    await exchangeRazorpayAuthorizationCode("decoded-code");
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body).toMatchObject({ code: "decoded-code", mode: "test", grant_type: "authorization_code" });
  });

  it("isolates each gym with Bearer auth and never sends Route transfers", async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      id: "order_gym_a", amount: 25000, currency: "INR", status: "created",
    }) });
    vi.stubGlobal("fetch", fetcher);
    await new GymOAuthPaymentClient("gym-a-token", "acc_GymA").createOrder({
      amountMinor: 25_000, currency: "INR", receipt: "purchase-a",
    });
    expect(fetcher.mock.calls[0][1].headers.authorization).toBe("Bearer gym-a-token");
    expect(JSON.parse(fetcher.mock.calls[0][1].body).transfers).toBeUndefined();
  });

  it("rejects any attempt to attach a Route transfer to an OAuth order", async () => {
    await expect(new GymOAuthPaymentClient("gym-a-token", "acc_GymA").createOrder({
      amountMinor: 25_000,
      currency: "INR",
      receipt: "purchase-a",
      transfers: [{ account: "acc_other", amount: 25_000, currency: "INR" }],
    })).rejects.toMatchObject({ code: "OAUTH_TRANSFER_FORBIDDEN" });
  });

  it("uses the OAuth client secret for Checkout and a distinct webhook secret", () => {
    const checkout = createHmac("sha256", "oauth-client-secret")
      .update("order_1|pay_1").digest("hex");
    expect(verifyOAuthCheckoutSignature({ orderId: "order_1", paymentId: "pay_1", signature: checkout })).toBe(true);
    const raw = Buffer.from('{"event":"payment.captured"}');
    const webhook = createHmac("sha256", "oauth-webhook-secret").update(raw).digest("hex");
    expect(verifyRazorpayWebhook(raw, webhook, "oauth-webhook-secret")).toBe(true);
    expect(verifyRazorpayWebhook(raw, checkout, "oauth-webhook-secret")).toBe(false);
  });
});

