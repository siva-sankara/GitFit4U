import { describe, expect, it } from "vitest";
import {
  bindingKey,
  communicationScope,
  normalizeWhatsAppRecipient,
} from "./whatsappConnectionService.js";

describe("WhatsApp tenant and contact policy", () => {
  it("creates distinct platform and gym sender bindings without fallback", () => {
    expect(bindingKey("PLATFORM")).toBe("PLATFORM");
    expect(bindingKey("GYM", "gym-a")).toBe("GYM:gym-a");
    expect(bindingKey("GYM", "gym-b")).toBe("GYM:gym-b");
    expect(() => bindingKey("GYM")).toThrowError(expect.objectContaining({ code: "GYM_CONTEXT_REQUIRED" }));
  });

  it("derives scope from authenticated server context instead of request sender data", () => {
    expect(communicationScope({ userId: "admin", role: "ADMIN", permissions: ["admin:platform"] })).toEqual({ scope: "PLATFORM" });
    expect(communicationScope({ userId: "owner", role: "GYM_OWNER", gymId: "gym-a", permissions: ["gym:update"] })).toEqual({ scope: "GYM", gymId: "gym-a" });
    expect(() => communicationScope({ userId: "member", role: "USER", permissions: [] })).toThrowError(expect.objectContaining({ code: "WHATSAPP_SCOPE_FORBIDDEN" }));
  });

  it("normalizes international recipients and rejects unsafe values", () => {
    expect(normalizeWhatsAppRecipient("+91 98765 43210")).toBe("919876543210");
    expect(() => normalizeWhatsAppRecipient("1234")).toThrowError(expect.objectContaining({ code: "WHATSAPP_PHONE_INVALID" }));
  });
});
