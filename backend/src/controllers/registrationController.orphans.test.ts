import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
import { sha256 } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";
const mocks = vi.hoisted(() => ({ userUpdate: vi.fn(), replay: vi.fn(), remember: vi.fn(), registration: vi.fn(), createGym: vi.fn(), availableGym: vi.fn() }));
vi.mock("../models/User.js", () => ({ User: { updateOne: mocks.userUpdate } }));
vi.mock("../models/Gym.js", () => ({ Gym: { create: mocks.createGym } }));
vi.mock("../models/GymRegistration.js", () => ({ GymRegistration: { findOne: mocks.registration } }));
vi.mock("../models/Operations.js", () => ({ IdempotencyRecord: { findOne: mocks.replay, create: mocks.remember } }));
vi.mock("../services/registrationService.js", () => ({ editableRegistrationStates: [], payableGym: vi.fn(), registrationStatus: vi.fn(), availableRegistrationGym: mocks.availableGym }));
import { createRegistration } from "./registrationController.js";
const databaseSession = {} as any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (callback: any) => callback(databaseSession));
  mocks.userUpdate.mockResolvedValue({ matchedCount: 1 });
});
afterEach(() => vi.restoreAllMocks());
describe("creation does not recreate unavailable registration gyms", () => {
  it.each(["replay", "resume"])("rejects %s before creating gyms or remembering a success", async flow => {
    const body = { name: "Gym" };
    const registration = { _id: "registration", ownerId: "owner", gymId: "missing-gym" };
    mocks.replay.mockReturnValue({ session: vi.fn().mockResolvedValue(flow === "replay" ? { requestHash: sha256(JSON.stringify(body)), responseBody: { registrationId: "registration" } } : null) });
    mocks.registration.mockReturnValue({ session: vi.fn().mockResolvedValue(registration) });
    mocks.availableGym.mockRejectedValue(new AppError(409, "REGISTRATION_UNAVAILABLE", "Contact support."));
    await expect(createRegistration({ body, auth: { userId: "owner" }, idempotencyKey: "stable-request-key" } as any, {} as any)).rejects.toMatchObject({ code: "REGISTRATION_UNAVAILABLE" });
    expect(mocks.availableGym).toHaveBeenCalledWith(registration, "owner", databaseSession);
    expect(mocks.createGym).not.toHaveBeenCalled();
    expect(mocks.remember).not.toHaveBeenCalled();
  });
});
