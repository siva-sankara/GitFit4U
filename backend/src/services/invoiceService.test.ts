import { describe, expect, it } from "vitest";
import { invoicePaymentScope, invoicePricing, invoiceCustomerSnapshot } from "./invoiceService.js";
import { renderInvoicePdf } from "./invoicePdfService.js";

describe("invoice authorization and immutable pricing", () => {
  it("withholds global account contact details from invoices until a new gym invitation is accepted", () => {
    const customer = { name: "Private account name", email: "private@example.test", phone: "+919999999999" };
    expect(invoiceCustomerSnapshot({ invitation: { status: "PENDING" }, contact: { name: "Entered by gym", email: "entered@example.test" }, memberCode: "MEMBER-1" }, customer)).toEqual({ name: "Entered by gym", email: "entered@example.test", phone: undefined, memberCode: "MEMBER-1" });
  });
  const user = { role: "USER", userId: "member-a", permissions: [] as string[] };
  it("scopes members to their payments, owners to their active gym, and platform admins globally", () => {
    expect(invoicePaymentScope(user)).toEqual({ payerId: "member-a" });
    expect(invoicePaymentScope({ role: "GYM_OWNER", userId: "owner-a", gymId: "gym-a", permissions: ["finance:read"] }))
      .toEqual({ $or: [{ payerId: "owner-a" }, { gymId: "gym-a" }] });
    expect(invoicePaymentScope({ role: "GYM_OWNER", userId: "owner-a", gymId: "gym-a", permissions: [] }))
      .toEqual({ payerId: "owner-a" });
    expect(invoicePaymentScope({ role: "ADMIN", userId: "admin-a", permissions: ["admin:platform"] })).toEqual({});
  });
  it("uses the captured payment snapshot and preserves plan, offer, tax, and final amount", () => {
    const payment = { amountMinor: 90270, currency: "INR", pricingSnapshot: {
      subtotalMinor: 100000, planDiscountMinor: 10000, offerDiscountMinor: 13500,
      discountMinor: 23500, taxRateBasisPoints: 1800, taxMinor: 13770,
      offer: { publicId: "offer-a", name: "Autumn", code: "SAVE15", terms: "Eligible annual plans" },
    } };
    expect(invoicePricing(payment)).toEqual(expect.objectContaining({ subtotalMinor: 100000, planDiscountMinor: 10000, offerDiscountMinor: 13500, discountMinor: 23500, taxMinor: 13770, totalMinor: 90270, offer: expect.objectContaining({ code: "SAVE15" }) }));
  });
  it("rejects inconsistent financial snapshots rather than generating a misleading invoice", () => {
    expect(() => invoicePricing({ amountMinor: 1, currency: "INR", pricingSnapshot: { subtotalMinor: 10000, discountMinor: 0, taxMinor: 1800 } }))
      .toThrow(expect.objectContaining({ code: "INVOICE_AMOUNT_MISMATCH" }));
  });
  it("does not invent a discount or tax split for historical payments without a reconciling snapshot", () => {
    expect(invoicePricing({ amountMinor: 9999, currency: "INR" })).toEqual({ totalMinor: 9999, currency: "INR", breakdownUnavailable: true });
  });
});

it("renders a real PDF from authoritative invoice fields and tolerates a legacy timezone", async () => {
  const pdf = await renderInvoicePdf({
    publicId: "invoice-public", number: "GFU-payment-public", snapshotVersion: 2,
    issuedAt: new Date("2026-09-27T10:00:00Z"), status: "ISSUED", currency: "INR",
    supplierSnapshot: { name: "Example Gym", ownerName: "Owner", timezone: "legacy/invalid", address: { line1: "One Street", city: "Pune" }, contact: { phone: "+919876543210" } },
    customerSnapshot: { name: "Member", email: "member@example.com", phone: "+919999999999", memberCode: "MEM-1" },
    membershipSnapshot: { name: "Gold membership", startsAt: new Date("2026-09-27"), endsAt: new Date("2027-09-27"), durationDays: 365, status: "ACTIVE" },
    paymentSnapshot: { reference: "payment-public", transactionReference: "txn-reference", provider: "RAZORPAY", method: "ONLINE", paidAt: new Date("2026-09-27T10:00:00Z") },
    pricingSnapshot: { subtotalMinor: 1200000, discountMinor: 200100, taxMinor: 0, totalMinor: 999900, offer: { name: "Annual offer", code: "ANNUAL17", terms: "One use per member" } },
    subtotalMinor: 1200000, discountMinor: 200100, taxMinor: 0, totalMinor: 999900,
  }, "CAPTURED");
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.byteLength).toBeGreaterThan(5000);
});
