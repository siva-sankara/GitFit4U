import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ challenge: vi.fn(), verify: vi.fn(), request: vi.fn() }));
vi.mock("../models/Social.js", () => ({ ProfileContactChange: { findOne: mocks.challenge } }));
vi.mock("../services/otpService.js", () => ({ verifyOtp: mocks.verify, requestOtp: mocks.request, normalizePhone: (v: string) => v }));
import { confirmPhoneChange } from "./profileContactController.js";
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
