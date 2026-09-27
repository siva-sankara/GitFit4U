import { afterEach, expect, it, vi } from "vitest";
vi.mock("../../config/env.js", () => ({
  env: {
    RAZORPAY_KEY_ID: "test-public-key",
    RAZORPAY_KEY_SECRET: "test-server-secret",
  },
}));
import { RazorpayProvider } from "./razorpayProvider.js";
afterEach(() => vi.unstubAllGlobals());
it("uses the stable refund identifier for Razorpay idempotency and receipt correlation", async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({
      id: "rfnd_test",
      payment_id: "pay_test",
      amount: 500,
      currency: "INR",
      status: "pending",
    }),
  });
  vi.stubGlobal("fetch", fetcher);
  await new RazorpayProvider().refundPayment(
    "pay_test",
    500,
    "stable_refund_12345",
  );
  expect(fetcher.mock.calls[0][0]).toBe(
    "https://api.razorpay.com/v1/payments/pay_test/refund",
  );
  expect(fetcher.mock.calls[0][1].headers["X-Refund-Idempotency"]).toBe(
    "stable_refund_12345",
  );
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    amount: 500,
    receipt: "stable_refund_12345",
    notes: { receipt: "stable_refund_12345" },
  });
});
