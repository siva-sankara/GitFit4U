import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ marketplace: false, connection: null as any }));
vi.mock("../config/env.js", () => ({
  env: {
    get PHONEPE_MARKETPLACE_ENABLED() { return state.marketplace; },
    PHONEPE_ENV: "sandbox",
  },
}));
vi.mock("../models/Business.js", () => ({
  PaymentConnection: {
    findOne: vi.fn(() => ({ lean: async () => state.connection })),
  },
}));

import { membershipCollectionReadiness, requireMembershipBeneficiary } from "./paymentConnectionService.js";

beforeEach(() => {
  state.marketplace = false;
  state.connection = null;
});

describe("gym beneficiary readiness", () => {
  it("blocks collection before provider onboarding instead of using the platform merchant", async () => {
    const result = await membershipCollectionReadiness("gym-a");
    expect(result.available).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/Marketplace\/Split Settlements/);
    expect(result.blockers.join(" ")).toMatch(/not started/);
  });

  it("still blocks an approved-looking record when the allocation API contract is unavailable", async () => {
    state.marketplace = true;
    state.connection = {
      publicId: "connection-a",
      onboardingStatus: "APPROVED",
      collectionEnabled: true,
      allocationCapability: "ENABLED",
      settlementCapability: "ENABLED",
    };
    const result = await membershipCollectionReadiness("gym-a");
    expect(result.available).toBe(false);
    expect(result.blockers[0]).toMatch(/allocation API contract/i);
    await expect(requireMembershipBeneficiary("gym-a")).rejects.toMatchObject({
      code: "GYM_ONLINE_PAYMENT_UNAVAILABLE",
      statusCode: 409,
    });
  });
});
