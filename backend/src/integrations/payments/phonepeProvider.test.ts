import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testEnv = vi.hoisted(() => ({
  PHONEPE_ENV: "sandbox",
  PHONEPE_CLIENT_ID: "client-id",
  PHONEPE_CLIENT_SECRET: "client-secret",
  PHONEPE_CLIENT_VERSION: "1",
  PHONEPE_MERCHANT_ID: "merchant-id",
  PHONEPE_WEBHOOK_AUTH_MODE: "sha",
  PHONEPE_WEBHOOK_USERNAME: "callback-user",
  PHONEPE_WEBHOOK_PASSWORD: "callback-password",
}));
vi.mock("../../config/env.js", () => ({ env: testEnv }));

import { PhonePeProvider } from "./phonepeProvider.js";

function response(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  testEnv.PHONEPE_WEBHOOK_AUTH_MODE = "sha";
});
afterEach(() => vi.unstubAllGlobals());

describe("PhonePe Standard Checkout v2 adapter", () => {
  it("uses OAuth O-Bearer and the documented sandbox checkout contract", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({
        access_token: "access-token",
        token_type: "O-Bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      }))
      .mockResolvedValueOnce(response({
        orderId: "OMO-provider-order",
        state: "PENDING",
        expireAt: Date.now() + 900_000,
        redirectUrl: "https://mercury-uat.phonepe.com/checkout/token",
      }));
    vi.stubGlobal("fetch", fetcher);
    const order = await new PhonePeProvider().createPayment({
      amountMinor: 12500,
      currency: "INR",
      receipt: "GFU_payment_123",
      redirectUrl: "https://getfit4u.in/payment-return?paymentId=payment_123",
      notes: { paymentId: "payment_123", purpose: "PLATFORM_SUBSCRIPTION" },
    });
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api-preprod.phonepe.com/apis/pg-sandbox/v1/oauth/token",
    );
    expect(String(fetcher.mock.calls[0][1].body)).toContain("grant_type=client_credentials");
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api-preprod.phonepe.com/apis/pg-sandbox/checkout/v2/pay",
    );
    expect(fetcher.mock.calls[1][1].headers.authorization).toBe("O-Bearer access-token");
    expect(JSON.parse(fetcher.mock.calls[1][1].body)).toMatchObject({
      merchantOrderId: "GFU_payment_123",
      amount: 12500,
      paymentFlow: {
        type: "PG_CHECKOUT",
        merchantUrls: {
          redirectUrl: "https://getfit4u.in/payment-return?paymentId=payment_123",
        },
      },
    });
    expect(order).toMatchObject({
      id: "GFU_payment_123",
      amount: 12500,
      currency: "INR",
      status: "PENDING",
      redirectUrl: "https://mercury-uat.phonepe.com/checkout/token",
      gatewayOrderId: "OMO-provider-order",
    });
  });

  it("caches a scoped token and checks authoritative order status", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(response({ access_token: "token", token_type: "O-Bearer", expires_at: Math.floor(Date.now() / 1000) + 3600 }))
      .mockResolvedValueOnce(response({ orderId: "GFU_one", state: "COMPLETED", amount: 100 }))
      .mockResolvedValueOnce(response({ orderId: "GFU_two", state: "PENDING", amount: 200 }));
    vi.stubGlobal("fetch", fetcher);
    const provider = new PhonePeProvider();
    await provider.getOrderStatus("GFU_one");
    await provider.getOrderStatus("GFU_two");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls[1][0]).toContain("/order/GFU_one/status?details=true&errorContext=true");
    expect(fetcher.mock.calls[2][0]).toContain("/order/GFU_two/status?details=true&errorContext=true");
  });

  it("verifies SHA callback credentials without accepting a forged value", () => {
    const provider = new PhonePeProvider();
    const expected = crypto.createHash("sha256").update("callback-user:callback-password").digest("hex");
    expect(provider.verifyWebhook(Buffer.from("{}"), { authorization: expected })).toBe(true);
    expect(provider.verifyWebhook(Buffer.from("{}"), { authorization: "a".repeat(64) })).toBe(false);
  });

  it("fails closed for HMAC until the exact account contract is supplied", () => {
    testEnv.PHONEPE_WEBHOOK_AUTH_MODE = "hmac";
    const provider = new PhonePeProvider();
    expect(provider.verifyWebhook(Buffer.from("{}"), {
      checksumKeyId: "key",
      checksumSignature: "signature",
    })).toBe(false);
    expect(provider.webhookConfigurationBlocker()).toMatch(/exact PhonePe account contract/i);
  });

  it("does not expose provider response details when OAuth fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({ message: "sensitive provider detail" }, false, 401)));
    await expect(new PhonePeProvider().getOrderStatus("GFU_one")).rejects.toMatchObject({
      code: "PHONEPE_AUTHORIZATION_FAILED",
      statusCode: 502,
    });
  });
});
