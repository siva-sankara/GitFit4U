import { describe, expect, it } from "vitest";
import { deriveOwnerOnboarding } from "./ownerOnboardingService.js";

describe("persisted owner onboarding projection", () => {
  it("starts a new owner at gym details", () => {
    expect(deriveOwnerOnboarding([], [])).toEqual({ state: "NOT_STARTED", currentStep: "GYM" });
  });
  it("resumes saved registration details and step", () => {
    expect(deriveOwnerOnboarding([{ _id: "gym", status: "INACTIVE" }], [{ publicId: "registration", gymId: "gym", status: "DRAFT", currentStep: "PLAN" }])).toEqual({ state: "DRAFT", gymId: "gym", registrationId: "registration", currentStep: "PLAN" });
  });
  it("resumes pending payment without starting another gym", () => {
    expect(deriveOwnerOnboarding([{ _id: "gym", status: "INACTIVE" }], [{ publicId: "registration", gymId: "gym", status: "PAYMENT_PENDING" }])).toMatchObject({ state: "PENDING", currentStep: "PAYMENT" });
  });
  it("recognizes an established active gym even without a legacy registration record", () => {
    expect(deriveOwnerOnboarding([{ _id: "gym", status: "ACTIVE" }], [])).toEqual({ state: "ACTIVE", gymId: "gym", currentStep: "COMPLETE" });
  });
  it("prefers an existing active gym over a new incomplete gym at login", () => {
    expect(deriveOwnerOnboarding([{ _id: "draft", status: "INACTIVE" }, { _id: "active", status: "ACTIVE" }], []).gymId).toBe("active");
  });
  it("respects the selected gym rather than another owned gym", () => {
    expect(deriveOwnerOnboarding([{ _id: "active", status: "ACTIVE" }, { _id: "selected", status: "INACTIVE" }], [{ publicId: "registration", gymId: "selected", status: "DRAFT" }], "selected")).toMatchObject({ state: "DRAFT", gymId: "selected" });
  });
  it.each(["SUSPENDED", "ARCHIVED"])("preserves a %s gym without opening a new registration", (status) => {
    expect(deriveOwnerOnboarding([{ _id: "gym", status }], [])).toMatchObject({ state: "SUSPENDED", gymId: "gym" });
  });
  it("does not infer activation from an unpaid legacy approval label", () => {
    expect(deriveOwnerOnboarding([{ _id: "gym", status: "INACTIVE" }], [{ publicId: "registration", gymId: "gym", status: "APPROVED" }]).state).toBe("DRAFT");
  });
  it("does not treat a deleted gym as an active workspace", () => {
    expect(deriveOwnerOnboarding([{ _id: "gym", status: "ACTIVE", deletedAt: new Date() }], []).state).toBe("SUSPENDED");
  });
  it("requires support for orphaned drafts instead of restarting owner registration", () => {
    expect(deriveOwnerOnboarding([], [{ publicId: "orphan", gymId: "missing", status: "DRAFT" }])).toEqual({ state: "SUSPENDED", registrationId: "orphan" });
  });
  it("requires support for an inactive legacy gym without inventing a registration", () => {
    expect(deriveOwnerOnboarding([{ _id: "legacy", status: "INACTIVE" }], [])).toEqual({ state: "SUSPENDED", gymId: "legacy" });
  });
  it("preserves an active legacy owner's destination when an unrelated old registration is orphaned", () => {
    expect(deriveOwnerOnboarding([{ _id: "active", status: "ACTIVE" }], [{ publicId: "orphan", gymId: "missing", status: "DRAFT" }])).toEqual({ state: "ACTIVE", gymId: "active", currentStep: "COMPLETE" });
  });
});
