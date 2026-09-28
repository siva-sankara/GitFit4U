import { z } from "zod";

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(128, "Use at most 128 characters")
  .regex(/[A-Z]/, "Add an uppercase letter").regex(/[a-z]/, "Add a lowercase letter").regex(/\d/, "Add a number");
export const phoneSchema = z.string().trim().max(20).refine(value => {
  if (!/^\+?[0-9 ()-]+$/.test(value)) return false;
  const cleaned = value.replace(/[ ()-]/g, "");
  return cleaned.startsWith("+") && !cleaned.startsWith("+91")
    ? /^\+[1-9]\d{7,14}$/.test(cleaned)
    : Boolean(parseIndianMobile(cleaned));
}, "Enter a valid phone number, including country code outside India");
export const localMobileSchema = z.string().regex(/^[0-9]{10}$/, "Enter a 10-digit mobile number.");
// Parse only recognized Indian formatting. Never truncate or discard arbitrary text.
export function parseIndianMobile(value: string): string | undefined {
  const text = value.trim();
  if (!/^\+?[0-9 ()-]+$/.test(text)) return;
  const local = text.replace(/[ ()-]/g, "").replace(/^\+91/, "");
  return /^[0-9]{10}$/.test(local) ? local : undefined;
}
export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  phone: localMobileSchema,
  role: z.enum(["USER", "GYM_OWNER"], { error: "Select your account type." }),
  password: passwordSchema,
  confirm: z.string()
}).refine(value => value.password === value.confirm, { path: ["confirm"], message: "Passwords do not match" });
export const loginSchema = z.object({ identifier: z.string().trim().min(3, "Enter your email or phone").max(160), password: z.string().min(1, "Enter your password").max(128) });
export const resetSchema = z.object({ password: passwordSchema, confirm: z.string() })
  .refine(value => value.password === value.confirm, { path: ["confirm"], message: "Passwords do not match" });
