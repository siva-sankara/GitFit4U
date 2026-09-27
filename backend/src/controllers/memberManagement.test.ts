import { describe, expect, it } from "vitest";
import { offlinePlanQuote } from "./memberManagementController.js";
import {
  ownerMemberCreateInput,
  ownerTrainerInput,
} from "../routes/memberManagementSchemas.js";
describe("owner member creation contract", () => {
  it("calculates tax after discount and derives membership end from plan duration", () => {
    const result = offlinePlanQuote(
      {
        priceMinor: 200000,
        discountMinor: 20000,
        taxRateBasisPoints: 1800,
        durationDays: 30,
      },
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(result.totalMinor).toBe(212400);
    expect(result.endsAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("requires a real selected plan and offline payment details", () => {
    expect(
      ownerMemberCreateInput.safeParse({
        name: "Member Name",
        email: "member@example.com",
      }).success,
    ).toBe(false);
    expect(
      ownerMemberCreateInput.safeParse({
        name: "Member Name",
        phone: "bad",
        planId: "plan",
        startsAt: new Date(),
        payment: { amountMinor: 100, method: "RAZORPAY", paidAt: new Date() },
      }).success,
    ).toBe(false);
  });
  it("rejects invalid trainer contacts and backwards availability", () => {
    expect(
      ownerTrainerInput.safeParse({
        name: "Trainer Name",
        email: "invalid",
        phone: "abc",
      }).success,
    ).toBe(false);
    expect(
      ownerTrainerInput.safeParse({
        name: "Trainer Name",
        email: "trainer@example.com",
        availability: [{ day: 1, from: "18:00", to: "09:00" }],
      }).success,
    ).toBe(false);
  });
});
