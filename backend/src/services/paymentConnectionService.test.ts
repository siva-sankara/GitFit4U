import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ route: false, feeBearer: undefined as string | undefined, connection: null as any }));
vi.mock("../config/env.js", () => ({
  env: {
    get RAZORPAY_ROUTE_ENABLED() { return state.route; },
    get RAZORPAY_GYM_FEE_BEARER() { return state.feeBearer; },
    RAZORPAY_MODE: "test",
    RAZORPAY_KEY_ID: "rzp_test_key",
    RAZORPAY_KEY_SECRET: "server-secret",
    RAZORPAY_WEBHOOK_SECRET: "webhook-secret",
  },
}));
vi.mock("../models/Business.js", () => ({
  PaymentConnection: {
    findOne: vi.fn(() => ({ lean: async () => state.connection })),
  },
}));

import { membershipCollectionReadiness, requireMembershipBeneficiary } from "./paymentConnectionService.js";

beforeEach(() => {
  state.route = false;
  state.feeBearer = undefined;
  state.connection = null;
});

describe("gym beneficiary readiness", () => {
  it("blocks collection before provider onboarding instead of using the platform merchant", async () => {
    const result = await membershipCollectionReadiness("gym-a");
    expect(result.available).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/Razorpay Route/);
    expect(result.blockers.join(" ")).toMatch(/not started/);
  });

  it("still blocks an approved-looking record when fee policy and linked-account evidence are unavailable", async () => {
    state.route = true;
    state.connection = {
      publicId: "connection-a",
      onboardingStatus: "APPROVED",
      collectionEnabled: true,
      allocationCapability: "ENABLED",
      settlementCapability: "ENABLED",
    };
    const result = await membershipCollectionReadiness("gym-a");
    expect(result.available).toBe(false);
    expect(result.blockers.join(" ")).toMatch(/FEE_BEARER|linked-account|approval evidence/i);
    await expect(requireMembershipBeneficiary("gym-a")).rejects.toMatchObject({
      code: "GYM_ONLINE_PAYMENT_UNAVAILABLE",
      statusCode: 409,
    });
  });

  it("enables only an approved one-gym Route mapping under the configured full-gross policy", async () => {
    state.route = true;
    state.feeBearer = "platform_absorbs";
    state.connection = {
      publicId: "connection-a",
      onboardingStatus: "APPROVED",
      collectionEnabled: true,
      allocationCapability: "ENABLED",
      settlementCapability: "ENABLED",
      linkedAccountId: "acc_GymA123",
      providerEvidenceReference: "route-case-123",
      termsAcceptedAt: new Date(),
      termsAcceptedBy: "owner-a",
      feeBearerPolicy: "PLATFORM_ABSORBS",
    };
    await expect(membershipCollectionReadiness("gym-a")).resolves.toMatchObject({
      available: true,
      provider: "RAZORPAY",
      environment: "TEST",
    });
  });
});
