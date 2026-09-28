import { beforeEach, expect, it, vi } from "vitest";
import mongoose from "mongoose";
const mocks = vi.hoisted(() => ({ challenge: vi.fn(), verify: vi.fn(), request: vi.fn(), exists: vi.fn(), update: vi.fn() }));
vi.mock("../models/User.js", () => ({ User: { exists: mocks.exists, updateOne: mocks.update } }));
vi.mock("../models/Social.js", () => ({ ProfileContactChange: { findOne: mocks.challenge } }));
vi.mock("../services/otpService.js", () => ({ verifyOtp: mocks.verify, requestOtp: mocks.request, normalizePhone: (v: string) => v }));
import { confirmPhoneChange, requestPhoneChange } from "./profileContactController.js";
beforeEach(() => vi.resetAllMocks());
const req = { body: { challengeId: "challenge1", code: "123456" }, auth: { userId: "viewer", sessionId: "current" } } as any;
it("binds phone challenges to the authenticated account before consuming an OTP", async () => {
  mocks.challenge.mockResolvedValue(null);
  await expect(confirmPhoneChange(req, {} as any)).rejects.toMatchObject({ code: "CONTACT_CHALLENGE_INVALID" });
  expect(mocks.challenge).toHaveBeenCalledWith(expect.objectContaining({ userId: "viewer", challengeId: "challenge1", consumedAt: null }));
  expect(mocks.verify).not.toHaveBeenCalled();
});
it("rejects a login-purpose OTP or a verified phone that does not match the bound target", async () => {
  mocks.challenge.mockResolvedValue({ phone: "+919876543210" });
  mocks.verify.mockResolvedValue({ phone: "+919876543210", purpose: "LOGIN" });
  await expect(confirmPhoneChange(req, {} as any)).rejects.toMatchObject({ code: "CONTACT_CHALLENGE_INVALID" });
  mocks.verify.mockResolvedValue({ phone: "+919876543211", purpose: "STEP_UP" });
  await expect(confirmPhoneChange(req, {} as any)).rejects.toMatchObject({ code: "CONTACT_CHALLENGE_INVALID" });
});
it("excludes the current account but refuses another account's phone before sending OTP", async () => {
  mocks.exists.mockResolvedValue(true);
  await expect(requestPhoneChange({ ...req, body: { phone: "+919876543210" } }, {} as any)).rejects.toMatchObject({ code: "CONTACT_UNAVAILABLE" });
  expect(mocks.exists).toHaveBeenCalledWith({ phone: "+919876543210", _id: { $ne: "viewer" } });
  expect(mocks.request).not.toHaveBeenCalled();
});
it("rechecks collisions inside phone confirmation without overwriting another identity", async () => {
  mocks.challenge.mockResolvedValue({ phone: "+919876543210" });
  mocks.verify.mockResolvedValue({ phone: "+919876543210", purpose: "STEP_UP" });
  mocks.exists.mockReturnValue({ session: vi.fn().mockResolvedValue(true) });
  const transaction = vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (callback: any) => callback({}));
  try {
    await expect(confirmPhoneChange(req, {} as any)).rejects.toMatchObject({ code: "CONTACT_UNAVAILABLE" });
    expect(mocks.update).not.toHaveBeenCalled();
  } finally { transaction.mockRestore(); }
});
