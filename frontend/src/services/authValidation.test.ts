import { describe, expect, it } from "vitest";
import { signupSchema, resetSchema, phoneSchema } from "./authValidation";
const valid = { name: "Test Member", email: "member@example.com", phone: "", password: "StrongPass123", confirm: "StrongPass123" };
describe("account form validation", () => {
  it("accepts registration without an optional phone and trims profile fields", () => {
    expect(signupSchema.parse({ ...valid, name: " Test Member " }).name).toBe("Test Member");
  });
  it("rejects mismatched confirmation and weak or oversized passwords", () => {
    expect(signupSchema.safeParse({ ...valid, confirm: "different" }).success).toBe(false);
    for (const password of ["short", "lowercase123", "UPPERCASE123", "NoNumbersHere", "Aa1" + "x".repeat(126)]) {
      expect(signupSchema.safeParse({ ...valid, password, confirm: password }).success).toBe(false);
      expect(resetSchema.safeParse({ password, confirm: password }).success).toBe(false);
    }
  });
  it("accepts local and international phones and rejects malformed input", () => {
    for (const value of ["9876543210", "+919876543210", "+1 (415) 555-2671"]) expect(phoneSchema.safeParse(value).success).toBe(true);
    for (const value of ["123", "not-a-phone"]) expect(phoneSchema.safeParse(value).success).toBe(false);
  });
});
