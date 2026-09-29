import { describe, expect, it } from "vitest";
import {
  embeddedSignupOptions,
  parseEmbeddedSignupMessage,
  type WhatsAppSignup,
} from "./whatsappOnboarding";

const base: WhatsAppSignup = {
  onboardingSessionId: "session-123",
  state: "state-value",
  connectionMode: "STANDARD",
  appId: "12345",
  configId: "67890",
  graphApiVersion: "v26.0",
  embeddedSignupVersion: "v4",
  diagnosticReference: "diagnostic",
};

describe("WhatsApp Embedded Signup launcher", () => {
  it("launches Coexistence with the Business app feature and no legacy session override", () => {
    const options = embeddedSignupOptions({
      ...base,
      connectionMode: "COEXISTENCE",
      featureType: "whatsapp_business_app_onboarding",
    });
    expect(options.extras).toEqual({
      setup: {},
      featureType: "whatsapp_business_app_onboarding",
    });
    expect(options.extras).not.toHaveProperty("sessionInfoVersion");
  });

  it("preserves the standard number path without the Coexistence selector", () => {
    expect(embeddedSignupOptions(base).extras).toEqual({ setup: {} });
  });

  it("accepts the documented Business app completion event only from Meta origins", () => {
    const payload = {
      type: "WA_EMBEDDED_SIGNUP",
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      version: 3,
      data: { waba_id: "123456789", history_sharing: false },
    };
    expect(parseEmbeddedSignupMessage({
      origin: "https://www.facebook.com",
      data: JSON.stringify(payload),
    })).toMatchObject({
      kind: "FINISH",
      sessionEvent: {
        event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
        data: { waba_id: "123456789", history_sharing: false },
      },
    });
    expect(parseEmbeddedSignupMessage({
      origin: "https://attacker.example",
      data: payload,
    })).toBeNull();
  });
});
