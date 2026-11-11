import { describe, expect, it } from "vitest";
import { normalizeWhatsAppRecipient } from "./whatsappPhone.js";
describe("one WhatsApp destination normalizer", () => {
  it.each(["9876543210", "09876543210", "+91 98765 43210", "919876543210"])("normalizes %s to Meta digits", value => expect(normalizeWhatsAppRecipient(value)).toBe("919876543210"));
  it.each(["+1 (415) 555-2671", "14155552671"])("preserves international country codes: %s", value => expect(normalizeWhatsAppRecipient(value)).toBe("14155552671"));
  it.each(["", "1234", "0000000000", "+000012345678", "abc9876543210", "919876543210@example.com", "++919876543210", "1234567890123456"])("rejects invalid destination %s", value => expect(() => normalizeWhatsAppRecipient(value)).toThrowError(expect.objectContaining({ code: "WHATSAPP_PHONE_INVALID" })));
});
