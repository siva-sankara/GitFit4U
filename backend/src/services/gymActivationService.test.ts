import { describe, expect, it } from "vitest";
import { adminActivationInput, offlinePlatformPaymentInput, validateActivationTerm, authorizeGymActivation } from "./gymActivationService.js";
const now = new Date("2026-10-07T10:00:00Z");
const pending = { mode: "PAYMENT_PENDING", planId: "a".repeat(24), reason: "Collect at the front desk", startsAt: now, endsAt: new Date("2026-11-06T10:00:00Z"), dueAt: new Date("2026-10-10T10:00:00Z") };
const plan = { billingPeriod: "MONTHLY", priceMinor: 100000, currency: "INR", memberLimit: 100, staffLimit: 5 };
describe("admin platform access financial rules", () => {
  it("requires a reason, due date and bounded term without a pretend payment", () => {
    expect(() => validateActivationTerm(adminActivationInput.parse(pending), plan, now)).not.toThrow();
    for (const input of [{ ...pending, dueAt: undefined }, { ...pending, reason: "" }, { ...pending, override: true }, { ...pending, payment: { method: "CASH", amountMinor: 100000, currency: "INR", paidAt: now, confirmedReceived: true } }]) expect(adminActivationInput.safeParse(input).success).toBe(false);
  });
  it("requires explicit confirmation and UPI reference", () => {
    const payment = { method: "UPI", amountMinor: 100000, currency: "INR", paidAt: now, confirmedReceived: true };
    expect(offlinePlatformPaymentInput.safeParse(payment).success).toBe(false);
    expect(offlinePlatformPaymentInput.safeParse({ ...payment, reference: "UTR-TEST-0001" }).success).toBe(true);
    expect(offlinePlatformPaymentInput.safeParse({ ...payment, reference: "UTR-TEST-0001", confirmedReceived: false }).success).toBe(false);
  });
  it("rejects expiry, future activation, unlimited plans and price mismatches", () => {
    for (const input of [{ ...pending, startsAt: new Date("2026-10-08") }, { ...pending, endsAt: new Date("2027-01-01") }, { ...pending, endsAt: now }]) expect(() => validateActivationTerm(adminActivationInput.parse(input), plan, now)).toThrow();
    expect(() => validateActivationTerm(adminActivationInput.parse(pending), { ...plan, memberLimit: null }, now)).toThrow();
    const input = adminActivationInput.parse({ ...pending, mode: "OFFLINE_PAYMENT", payment: { method: "CASH", amountMinor: 1, currency: "INR", paidAt: now, confirmedReceived: true } });
    expect(() => validateActivationTerm(input, plan, now)).toThrow();
  });
  it("rejects forged non-admin requests before touching records", async () => {
    await expect(authorizeGymActivation({ userId: "owner", role: "GYM_OWNER", permissions: ["admin:platform"] }, "gym", pending, "request-key")).rejects.toMatchObject({ statusCode: 403 });
  });
});
