import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../config/env.js", () => ({
  env: {
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_test_public_key",
    RAZORPAY_KEY_SECRET: "test-server-secret",
    RAZORPAY_WEBHOOK_SECRET: "test-webhook-secret",
  },
}));

import { RazorpayProvider } from "./razorpayProvider.js";

afterEach(() => vi.unstubAllGlobals());

describe("Razorpay Route provider", () => {
  it("creates a platform order without any gym transfer", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "order_platform", amount: 10_000, currency: "INR", status: "created" }),
    });
    vi.stubGlobal("fetch", fetcher);
    await new RazorpayProvider().createPayment({
      amountMinor: 10_000,
      currency: "INR",
      receipt: "platform-purchase",
      notes: { purpose: "PLATFORM_SUBSCRIPTION" },
    });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.transfers).toBeUndefined();
    expect(body.partial_payment).toBe(false);
  });

  it("sends exactly the server-resolved gym transfer on a membership order", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "order_membership",
        amount: 25_000,
        currency: "INR",
        status: "created",
        transfers: [{ id: "trf_gym_a", recipient: "acc_GymA123", amount: 25_000, currency: "INR", status: "created" }],
      }),
    });
    vi.stubGlobal("fetch", fetcher);
    await new RazorpayProvider().createPayment({
      amountMinor: 25_000,
      currency: "INR",
      receipt: "membership-purchase",
      notes: { purpose: "GYM_MEMBERSHIP" },
      transfers: [{
        account: "acc_GymA123",
        amount: 25_000,
        currency: "INR",
        on_hold: false,
      }],
    });
    const body = JSON.parse(fetcher.mock.calls[0][1].body);
    expect(body.transfers).toEqual([{ account: "acc_GymA123", amount: 25_000, currency: "INR", on_hold: false }]);
  });

  it("keeps Gym A and Gym B membership allocations isolated", async () => {
    const fetcher = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body));
        const transfer = body.transfers[0];
        return {
          ok: true,
          json: async () => ({
            id: `order_${transfer.account}`,
            amount: body.amount,
            currency: body.currency,
            status: "created",
            transfers: [{
              id: `trf_${transfer.account}`,
              recipient: transfer.account,
              amount: transfer.amount,
              currency: transfer.currency,
              status: "created",
            }],
          }),
        };
      });
    vi.stubGlobal("fetch", fetcher);
    const provider = new RazorpayProvider();

    for (const gym of [
      { account: "acc_GymA123", amount: 25_000 },
      { account: "acc_GymB456", amount: 40_000 },
    ]) {
      await provider.createPayment({
        amountMinor: gym.amount,
        currency: "INR",
        receipt: `membership-${gym.account}`,
        notes: { purpose: "GYM_MEMBERSHIP" },
        transfers: [{
          account: gym.account,
          amount: gym.amount,
          currency: "INR",
          on_hold: false,
        }],
      });
    }

    const gymABody = JSON.parse(fetcher.mock.calls[0][1].body);
    const gymBBody = JSON.parse(fetcher.mock.calls[1][1].body);
    expect(gymABody.transfers).toEqual([
      { account: "acc_GymA123", amount: 25_000, currency: "INR", on_hold: false },
    ]);
    expect(gymBBody.transfers).toEqual([
      { account: "acc_GymB456", amount: 40_000, currency: "INR", on_hold: false },
    ]);
    expect(gymABody.transfers).not.toContainEqual(expect.objectContaining({ account: "acc_GymB456" }));
    expect(gymBBody.transfers).not.toContainEqual(expect.objectContaining({ account: "acc_GymA123" }));
  });

  it("rejects multiple beneficiaries before calling Razorpay", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await expect(new RazorpayProvider().createPayment({
      amountMinor: 25_000,
      currency: "INR",
      receipt: "membership-purchase",
      transfers: [
        { account: "acc_GymA123", amount: 12_500, currency: "INR" },
        { account: "acc_GymB123", amount: 12_500, currency: "INR" },
      ],
    })).rejects.toMatchObject({ code: "ROUTE_TRANSFER_INVALID" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("verifies checkout against the stored order signature", () => {
    const signature = createHmac("sha256", "test-server-secret")
      .update("order_membership|pay_member")
      .digest("hex");
    expect(new RazorpayProvider().verifyCheckout({
      orderId: "order_membership",
      paymentId: "pay_member",
      signature,
    })).toBe(true);
    expect(new RazorpayProvider().verifyCheckout({
      orderId: "order_other",
      paymentId: "pay_member",
      signature,
    })).toBe(false);
  });

  it("uses reverse_all only for the explicitly selected full-refund flow", async () => {
    const fetcher = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "rfnd_full", payment_id: "pay_member", amount: 25_000, status: "pending" }),
    });
    vi.stubGlobal("fetch", fetcher);
    await new RazorpayProvider().refundPayment("pay_member", 25_000, "refund-full", { reverseAll: true });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).reverse_all).toBe(true);
    await new RazorpayProvider().refundPayment("pay_member", 5_000, "refund-partial");
    expect(JSON.parse(fetcher.mock.calls[1][1].body).reverse_all).toBeUndefined();
  });

  it("fetches linked-account and Route-product readiness from Razorpay", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "acc_GymA123",
          type: "route",
          status: "created",
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "acc_prd_RouteA123",
          account_id: "acc_GymA123",
          product_name: "route",
          activation_status: "activated",
          tnc: { accepted: true },
        }),
      });
    vi.stubGlobal("fetch", fetcher);
    const provider = new RazorpayProvider();
    await provider.getLinkedAccount("acc_GymA123");
    await provider.getProductConfiguration(
      "acc_GymA123",
      "acc_prd_RouteA123",
    );
    expect(fetcher.mock.calls[0][0]).toBe(
      "https://api.razorpay.com/v2/accounts/acc_GymA123",
    );
    expect(fetcher.mock.calls[1][0]).toBe(
      "https://api.razorpay.com/v2/accounts/acc_GymA123/products/acc_prd_RouteA123",
    );
  });
});
