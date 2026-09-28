import { expect, it } from "vitest";
import { contactPhone, optionalContactPhone } from "./authSchemas.js";
import { gymInput, memberInput } from "./inputSchemas.js";
import { ownerMemberUpdateInput, ownerTrainerInput } from "./memberManagementSchemas.js";
import { profileUpdateInput } from "./profileSchemas.js";
import { registrationContact } from "../services/registrationService.js";
import { accountUpdate, settingsInput } from "../controllers/adminManagementController.js";
it.each(["9876543210", "+91 98765 43210", "98765-43210"])("normalizes recognized Indian contact %s", (phone) => {
  expect(contactPhone.parse(phone)).toBe("+919876543210");
});
it.each(["987654321", "98765432101", "09876543210", "+9198765432101", "98abc76543210", "9.876543210e9", "+91+919876543210"])("rejects invalid new contact %s without truncation", (phone) => {
  expect(contactPhone.safeParse(phone).success).toBe(false);
});
it("preserves explicit international contacts and accepts optional empty fields", () => {
  expect(contactPhone.parse("+1 (415) 555-0123")).toBe("+14155550123");
  expect(optionalContactPhone.parse("   ")).toBeUndefined();
  expect(optionalContactPhone.parse(undefined)).toBeUndefined();
  expect(contactPhone.safeParse(9876543210).success).toBe(false);
});
it("applies the same contact policy across gym, member, trainer, profile, registration and admin inputs", () => {
  const phone = "98765 43210", canonical = "+919876543210";
  expect(gymInput.parse({ name: "Gym", contact: { phone, whatsapp: "" } }).contact).toEqual({ phone: canonical, whatsapp: undefined });
  expect(memberInput.parse({ name: "Member", phone }).phone).toBe(canonical);
  expect(ownerMemberUpdateInput.parse({ phone }).phone).toBe(canonical);
  expect(ownerTrainerInput.parse({ name: "Trainer", email: "trainer@example.test", phone }).phone).toBe(canonical);
  expect(profileUpdateInput.parse({ profile: { emergencyContact: { name: "Emergency", phone, relationship: "Friend" } } }).profile?.emergencyContact?.phone).toBe(canonical);
  expect(registrationContact.parse({ phone, email: "owner@example.test" }).phone).toBe(canonical);
  expect(accountUpdate.parse({ phone }).phone).toBe(canonical);
  expect(settingsInput.parse({ supportPhone: phone }).supportPhone).toBe(canonical);
  expect(gymInput.safeParse({ name: "Gym", contact: { phone: "98765432101" } }).success).toBe(false);
  expect(registrationContact.safeParse({ phone: "", email: "owner@example.test" }).success).toBe(false);
});
