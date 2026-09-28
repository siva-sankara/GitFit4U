import { describe, expect, it } from "vitest";
import { publicSignupInput } from "./authSchemas.js";
const signup = { name: "Member", email: " Member.Name+Fitness@Example.com ", phone: "9876543210", password: "  StrongPass123  ", role: "USER" };
describe("public signup trust boundary", () => {
  it.each(["USER", "GYM_OWNER"])("permits only intentional %s signup and preserves password bytes", role => {
    expect(publicSignupInput.parse({ ...signup, role })).toEqual({ ...signup, role, email: "member.name+fitness@example.com", phone: "+919876543210" });
  });
  it.each([undefined, "ADMIN", "TRAINER", "GYM_STAFF", "SUPER_ADMIN", "user"])("rejects role %s", role => {
    const result = publicSignupInput.safeParse({ ...signup, role });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["role"]);
  });
  it.each(["isAdmin", "permissions", "approved", "ownerId", "roles", "gymId"])("rejects forged %s", key => {
    expect(publicSignupInput.safeParse({ ...signup, [key]: "forged" }).success).toBe(false);
  });
  it.each([undefined, "", "98765", "98765432101", "919876543210", "09876543210", "+449876543210", "abc9876543210", "9876543210.0", "9.876543210e9"])("rejects malformed or absent signup phone %s", phone => {
    expect(publicSignupInput.safeParse({ ...signup, phone }).success).toBe(false);
  });
  it.each(["9876543210", "+919876543210", "+91 98765-43210", "+91 (98765) 43210"])("normalizes recognized signup phone %s", phone => {
    expect(publicSignupInput.parse({ ...signup, phone }).phone).toBe("+919876543210");
  });
  it.each([undefined, "", "bad"])("requires valid email %s", email => {
    expect(publicSignupInput.safeParse({ ...signup, email }).success).toBe(false);
  });
});
