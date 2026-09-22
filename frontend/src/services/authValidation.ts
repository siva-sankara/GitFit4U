import { z } from "zod";

export const passwordSchema = z.string().min(10, "Use at least 10 characters").max(128, "Use at most 128 characters")
  .regex(/[A-Z]/, "Add an uppercase letter").regex(/[a-z]/, "Add a lowercase letter").regex(/\d/, "Add a number");
export const phoneSchema = z.string().trim().max(20).refine(value => {
  const cleaned = value.replace(/[\s()-]/g, "");
  return /^\+[1-9]\d{7,14}$/.test(cleaned.startsWith("+") ? cleaned : `+91${cleaned.replace(/^0+/, "")}`);
}, "Enter a valid phone number, including country code outside India");
export const signupSchema = z.object({
  name: z.string().trim().min(2, "Enter your full name").max(120),
  email: z.string().trim().email("Enter a valid email address"),
  phone: z.union([z.literal(""), phoneSchema]),
  password: passwordSchema,
  confirm: z.string()
}).refine(value => value.password === value.confirm, { path: ["confirm"], message: "Passwords do not match" });
export const loginSchema = z.object({ identifier: z.string().trim().min(3, "Enter your email or phone").max(160), password: z.string().min(1, "Enter your password").max(128) });
export const resetSchema = z.object({ password: passwordSchema, confirm: z.string() })
  .refine(value => value.password === value.confirm, { path: ["confirm"], message: "Passwords do not match" });
