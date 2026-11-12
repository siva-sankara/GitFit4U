import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  templates: vi.fn(),
  phones: vi.fn(),
  send: vi.fn(),
}));

vi.mock("../config/env.js", () => ({
  env: {
    WHATSAPP_MODE: "live",
    WHATSAPP_ACCESS_TOKEN: "server-token",
    WHATSAPP_PHONE_NUMBER_ID: "platform-phone",
    WHATSAPP_WABA_ID: "platform-waba",
    WHATSAPP_AUTH_TEMPLATE_NAME: "getfit4u_verification_code",
    WHATSAPP_AUTH_TEMPLATE_LANGUAGE: "en_US",
  },
}));
vi.mock("./whatsappConnectionService.js", () => ({
  normalizeWhatsAppRecipient: (value: string) => value.replace(/\D/g, ""),
}));
vi.mock("../integrations/messaging/whatsappProvider.js", () => {
  class WhatsAppProviderError extends Error {
    constructor(
      public category: string,
      message: string,
      public retryable = false,
      public providerCode?: string,
      public uncertain = false,
    ) {
      super(message);
    }
  }
  return {
    WhatsAppProviderError,
    WhatsAppProvider: class {
      listTemplates = mocks.templates;
      listPhoneNumbers = mocks.phones;
      sendAuthenticationCode = mocks.send;
    },
  };
});

import { WhatsAppProviderError } from "../integrations/messaging/whatsappProvider.js";
import { sendWhatsAppAuthenticationOtp } from "./whatsappAuthOtpService.js";

const approvedTemplate = {
  name: "getfit4u_verification_code",
  language: "en_US",
  category: "AUTHENTICATION",
  status: "APPROVED",
  components: [
    { type: "FOOTER", code_expiration_minutes: 5 },
    { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
  ],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.templates.mockResolvedValue([approvedTemplate]);
  mocks.phones.mockResolvedValue([{ id: "platform-phone", status: "CONNECTED" }]);
  mocks.send.mockResolvedValue({ providerMessageId: "wamid.auth" });
});

describe("platform WhatsApp authentication sender", () => {
  it("accepts Meta's retrieved URL-button and rendered English footer shape", async () => {
    mocks.templates.mockResolvedValue([{ ...approvedTemplate, components: [
      { type: "FOOTER", text: "This code expires in 5 minutes." },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Copy code", url: "https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code={{1}}" }] },
    ] }]);
    await expect(sendWhatsAppAuthenticationOtp("+919876543210", "246810")).resolves.toEqual({ providerMessageId: "wamid.auth" });
  });
  it("rejects an arbitrary URL masquerading as an authentication button", async () => {
    mocks.templates.mockResolvedValue([{ ...approvedTemplate, components: [
      { type: "FOOTER", code_expiration_minutes: 5 }, { type: "BUTTONS", buttons: [{ type: "URL", url: "https://example.com/otp/code/?code={{1}}" }] },
    ] }]);
    await expect(sendWhatsAppAuthenticationOtp("+919876543210", "246810")).rejects.toMatchObject({ code: "WHATSAPP_AUTH_TEMPLATE_BUTTON_INVALID" });
  });
  it("validates the approved template and connected platform sender before submitting", async () => {
    await expect(
      sendWhatsAppAuthenticationOtp("+919876543210", "123456"),
    ).resolves.toEqual({ providerMessageId: "wamid.auth" });
    expect(mocks.send).toHaveBeenCalledWith({
      token: "server-token",
      phoneNumberId: "platform-phone",
      to: "919876543210",
      template: "getfit4u_verification_code",
      language: "en_US",
      code: "123456",
    });
  });

  it("reports an exact blocker when the authentication template is not approved", async () => {
    mocks.templates.mockResolvedValue([{ ...approvedTemplate, status: "PENDING" }]);
    await expect(
      sendWhatsAppAuthenticationOtp("+919876543210", "123456"),
    ).rejects.toMatchObject({ code: "WHATSAPP_AUTH_TEMPLATE_NOT_APPROVED" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("rejects a template whose displayed expiry differs from the five-minute backend expiry", async () => {
    mocks.templates.mockResolvedValue([
      {
        ...approvedTemplate,
        components: [
          { type: "FOOTER", code_expiration_minutes: 10 },
          { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] },
        ],
      },
    ]);
    await expect(
      sendWhatsAppAuthenticationOtp("+919876543210", "123456"),
    ).rejects.toMatchObject({ code: "WHATSAPP_AUTH_TEMPLATE_EXPIRY_MISMATCH" });
  });

  it("maps Meta credential failures to a safe configuration error", async () => {
    mocks.send.mockRejectedValue(
      new WhatsAppProviderError(
        "TOKEN_OR_PERMISSION_INVALID" as any,
        "raw provider detail",
        false,
        "190",
      ),
    );
    await expect(
      sendWhatsAppAuthenticationOtp("+919876543210", "123456"),
    ).rejects.toMatchObject({
      code: "WHATSAPP_AUTH_CREDENTIALS_INVALID",
      details: { providerCode: "190" },
    });
  });
});
