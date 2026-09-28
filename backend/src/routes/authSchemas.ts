import { z } from "zod";
import { normalizeAccountPhone, normalizeContactPhone, normalizeEmail, normalizeIndiaSignupPhone } from "../utils/accountIdentity.js";

export const accountEmail = z.string().trim().email("Enter a valid email address.").transform(normalizeEmail);
function phoneSchema(normalize: (value: string) => string, message: string) {
  return z.string().max(32, message).transform((value, context) => {
    try { return normalize(value); } catch {
      context.addIssue({ code: "custom", message });
      return z.NEVER;
    }
  });
}
export const accountPhone = phoneSchema(normalizeAccountPhone, "Enter a valid mobile number with country code.");
export const indiaSignupPhone = phoneSchema(normalizeIndiaSignupPhone, "Enter a 10-digit mobile number.");
export const contactPhone = phoneSchema(normalizeContactPhone, "Enter a 10-digit Indian mobile number or an international number with country code.");
export const optionalContactPhone = z.preprocess((value) => typeof value === "string" && !value.trim() ? undefined : value, contactPhone.optional());
export const accountPassword = z.string().min(10).max(128).regex(/[A-Z]/, "One uppercase letter is required").regex(/[a-z]/, "One lowercase letter is required").regex(/\d/, "One number is required");
export const publicSignupInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: accountEmail,
  phone: indiaSignupPhone,
  password: accountPassword,
  role: z.enum(["USER", "GYM_OWNER"], { error: "Select your account type." }),
}).strict();
