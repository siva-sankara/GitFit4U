import { describe, expect, it } from "vitest";
import { normalizePhone } from "./otpService.js";

describe("normalizePhone", () => {
  it("normalizes an Indian local mobile number", () => {
    expect(normalizePhone("098765 43210")).toBe("+919876543210");
  });

  it("preserves a valid international E.164 number", () => {
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
  });

  it("rejects malformed numbers", () => {
    expect(() => normalizePhone("123")).toThrowError(/valid mobile number/i);
  });
});
