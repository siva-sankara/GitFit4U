import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ whatsapp: vi.fn(), sms: vi.fn() }));
vi.mock("../config/env.js", () => ({ env: { NODE_ENV: "test", LOG_LEVEL: "silent", WHATSAPP_MODE: "live", WHATSAPP_AUTH_OTP_ENABLED: false, MSG91_AUTH_KEY: "test", MSG91_TEMPLATE_ID: "test" } }));
vi.mock("./whatsappAuthOtpService.js", () => ({ sendWhatsAppAuthenticationOtp: mocks.whatsapp }));
vi.mock("./smsService.js", () => ({ sendOtpSms: mocks.sms }));
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { sendMobileAuthenticationOtp } from "./authOtpMobileService.js";
beforeEach(() => { vi.resetAllMocks(); env.WHATSAPP_MODE = "live"; env.WHATSAPP_AUTH_OTP_ENABLED = false; env.MSG91_AUTH_KEY = "test"; mocks.sms.mockResolvedValue(true); });
describe("independent WhatsApp authentication flag and existing SMS fallback", () => {
  it("never calls WhatsApp with Authentication disabled and sends the same code by SMS", async () => {
    expect(await sendMobileAuthenticationOtp("+919876543210", "004281")).toHaveProperty("providerMessageId", expect.stringMatching(/^sms:/));
    expect(mocks.whatsapp).not.toHaveBeenCalled();
    expect(mocks.sms).toHaveBeenCalledWith("+919876543210", "004281");
  });
  it("uses approved WhatsApp authentication when enabled", async () => {
    env.WHATSAPP_AUTH_OTP_ENABLED = true; mocks.whatsapp.mockResolvedValue({ providerMessageId: "wamid.test" });
    expect(await sendMobileAuthenticationOtp("+919876543210", "004281")).toEqual({ providerMessageId: "wamid.test" });
    expect(mocks.sms).not.toHaveBeenCalled();
  });
  it("falls back with the same code when Meta rejects Authentication", async () => {
    env.WHATSAPP_AUTH_OTP_ENABLED = true; mocks.whatsapp.mockRejectedValue(new AppError(503, "WHATSAPP_AUTH_TEMPLATE_UNAVAILABLE", "Internal template details"));
    await sendMobileAuthenticationOtp("+919876543210", "004281");
    expect(mocks.sms).toHaveBeenCalledWith("+919876543210", "004281");
  });
  it("does not contact Meta when the entire integration is disabled", async () => {
    env.WHATSAPP_MODE = "disabled"; env.WHATSAPP_AUTH_OTP_ENABLED = true;
    await sendMobileAuthenticationOtp("+919876543210", "004281");
    expect(mocks.whatsapp).not.toHaveBeenCalled();
  });
  it("returns a safe error when no mobile provider is configured", async () => {
    env.MSG91_AUTH_KEY = "";
    await expect(sendMobileAuthenticationOtp("+919876543210", "004281")).rejects.toMatchObject({ code: "OTP_MOBILE_UNAVAILABLE" });
    expect(mocks.whatsapp).not.toHaveBeenCalled(); expect(mocks.sms).not.toHaveBeenCalled();
  });
});
