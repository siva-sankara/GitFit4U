import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ findGym: vi.fn() }));
vi.mock("../models/Gym.js", () => ({ Gym: { findOne: mocks.findGym } }));
import { availableRegistrationGym, payableGym, registrationStatus } from "./registrationService.js";
beforeEach(() => vi.resetAllMocks());
describe("unavailable registration gyms", () => {
  it.each([null, undefined, { status: "INACTIVE", deletedAt: new Date() }, { status: "ACTIVE", deletedAt: new Date() }])("projects missing or deleted populated gyms as suspended", gymId => {
    expect(registrationStatus({ status: "DRAFT", gymId })).toBe("SUSPENDED");
  });
  it("preserves existing active legacy gyms and live draft status", () => {
    expect(registrationStatus({ status: "APPROVED", gymId: { status: "ACTIVE" } })).toBe("ACTIVE");
    expect(registrationStatus({ status: "DRAFT", gymId: { status: "INACTIVE" } })).toBe("DRAFT");
    expect(registrationStatus({ status: "DRAFT", gymId: "unpopulated-reference" })).toBe("DRAFT");
  });
  it.each([{ ownerId: "owner" }, { ownerId: "other", gymId: "gym" }])("refuses unavailable or wrong-owner registration references before lookup", async registration => {
    await expect(availableRegistrationGym(registration, "owner")).rejects.toMatchObject({ code: "REGISTRATION_UNAVAILABLE", statusCode: 409 });
    expect(mocks.findGym).not.toHaveBeenCalled();
  });
  it("requires the referenced gym to exist, belong to the owner and not be deleted", async () => {
    const session = {} as any;
    mocks.findGym.mockReturnValue({ session: vi.fn().mockResolvedValue(null) });
    await expect(availableRegistrationGym({ ownerId: "owner", gymId: "gym" }, "owner", session)).rejects.toMatchObject({ code: "REGISTRATION_UNAVAILABLE" });
    expect(mocks.findGym).toHaveBeenCalledWith({ _id: "gym", ownerId: "owner", deletedAt: null });
    const gym = { _id: "gym", ownerId: "owner", status: "INACTIVE" };
    mocks.findGym.mockReturnValue({ session: vi.fn().mockResolvedValue(gym) });
    await expect(availableRegistrationGym({ ownerId: "owner", gymId: "gym" }, "owner", session)).resolves.toBe(gym);
  });
  it("does not allow payment for a deleted inactive gym", async () => {
    mocks.findGym.mockReturnValue({ session: vi.fn().mockResolvedValue({ status: "INACTIVE", deletedAt: new Date() }) });
    await expect(payableGym({ status: "DRAFT", gymId: "gym", ownerId: "owner" })).rejects.toMatchObject({ code: "REGISTRATION_PAYMENT_CONFLICT" });
  });
});
