import { describe, expect, it, vi } from "vitest";

vi.mock("../config/env.js", () => ({
  env: {
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    WHATSAPP_MODE: "disabled",
    WHATSAPP_DEFAULT_LANGUAGE: "en_US",
    WHATSAPP_WEBHOOK_RETENTION_DAYS: 30,
    WHATSAPP_API_VERSION: "v26.0",
    WHATSAPP_COEXISTENCE_ENABLED: true,
  },
}));

import { normalizeEmbeddedSignupEvent } from "./whatsappConnectionService.js";
import { coexistenceMessageIdentity } from "./whatsappWebhookService.js";

describe("WhatsApp Coexistence policy", () => {
  it("separates standard and Business app completion events", () => {
    expect(normalizeEmbeddedSignupEvent("COEXISTENCE", {
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      version: 3,
      data: { waba_id: "123456789", history_sharing: false },
    })).toMatchObject({
      wabaId: "123456789",
      phoneNumberId: undefined,
      historySharing: "DECLINED",
    });
    expect(() => normalizeEmbeddedSignupEvent("COEXISTENCE", {
      event: "FINISH",
      data: { waba_id: "123456789" },
    })).toThrowError(expect.objectContaining({ code: "WHATSAPP_ONBOARDING_EVENT_INVALID" }));
    expect(() => normalizeEmbeddedSignupEvent("STANDARD", {
      event: "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING",
      data: { waba_id: "123456789" },
    })).toThrowError(expect.objectContaining({ code: "WHATSAPP_ONBOARDING_EVENT_INVALID" }));
    expect(normalizeEmbeddedSignupEvent("STANDARD", {
      event: "FINISH",
      version: 3,
      data: { waba_id: "123456789", phone_number_id: "987654321" },
    })).toMatchObject({
      event: "FINISH",
      wabaId: "123456789",
      phoneNumberId: "987654321",
    });
  });

  it("marks Business app echoes as outbound without creating inbound activity", () => {
    expect(coexistenceMessageIdentity("ECHO", {
      from: "919000000001",
      to: "919000000002",
    })).toEqual({
      direction: "OUTBOUND",
      source: "BUSINESS_APP",
      contactId: "919000000002",
      importedHistory: false,
    });
  });

  it("labels imported history and derives direction from original participants", () => {
    expect(coexistenceMessageIdentity("HISTORY", {
      from: "919000000002",
      to: "919000000001",
    }, "919000000001")).toEqual({
      direction: "INBOUND",
      source: "HISTORY_IMPORT",
      contactId: "919000000002",
      importedHistory: true,
    });
  });
});
