import { describe, expect, it } from "vitest";
import { signupSchema, resetSchema, phoneSchema, localMobileSchema, parseIndianMobile } from "./authValidation";
const valid = { name: "Test Member", email: "member@example.com", phone: "9876543210", role: "USER", password: "StrongPass123", confirm: "StrongPass123" };
describe("account form validation", () => {
  it("accepts an intentional member registration and canonicalizes profile fields", () => {
    expect(signupSchema.parse({ ...valid, name: " Test Member " }).name).toBe("Test Member");
    expect(signupSchema.parse({ ...valid, email: " Member+fitness@Example.COM " }).email).toBe("member+fitness@example.com");
    expect(signupSchema.parse({ ...valid, role: "GYM_OWNER" }).role).toBe("GYM_OWNER");
    for (const role of [undefined, "", "ADMIN", "TRAINER", "GYM_STAFF"]) expect(signupSchema.safeParse({ ...valid, role }).success).toBe(false);
    expect(signupSchema.safeParse({ ...valid, phone: "" }).success).toBe(false);
  });
  it("requires ten local digits without stripping arbitrary text or truncating", () => {
    expect(localMobileSchema.parse("9876543210")).toBe("9876543210");
    for (const phone of ["987654321", "98765432101", "98765e3210", "98765.3210", "123abc4567890", "+919876543210"]) expect(localMobileSchema.safeParse(phone).success).toBe(false);
    for (const phone of ["9876543210", "+91 98765 43210", "+91-98765-43210"]) expect(parseIndianMobile(phone)).toBe("9876543210");
    for (const phone of ["987654321012", "919876543210", "+1 9876543210", "call +91 9876543210", "9.876543210", "9e876543210"]) expect(parseIndianMobile(phone)).toBeUndefined();
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
