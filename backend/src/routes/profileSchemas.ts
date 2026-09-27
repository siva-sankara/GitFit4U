import { z } from "zod";
const timezone = z
  .string()
  .max(80)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Choose a valid timezone.");
export const profileUpdateInput = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    avatarAttachmentId: z
      .string()
      .regex(/^[a-fA-F0-9]{24}$/)
      .nullable()
      .optional(),
    social: z
      .object({
        bio: z.string().trim().max(500).optional(),
        location: z.string().trim().max(120).optional(),
        fitnessInterests: z
          .array(z.string().trim().min(1).max(60))
          .max(12)
          .optional(),
        visibility: z.enum(["PUBLIC", "PRIVATE"]).optional(),
        timezone: timezone.optional(),
      })
      .strict()
      .optional(),
    preferences: z
      .object({ theme: z.enum(["system", "light", "dark"]).optional() })
      .strict()
      .optional(),
    notificationPreferences: z
      .object({
        push: z.boolean().optional(),
        sound: z.boolean().optional(),
        categories: z
          .array(
            z.enum([
              "SYSTEM",
              "MEMBERSHIP",
              "PAYMENT",
              "ATTENDANCE",
              "GYM",
              "TRAINER",
              "WORKOUT",
            ]),
          )
          .max(7)
          .optional(),
      })
      .strict()
      .optional(),
    profile: z
      .object({
        dateOfBirth: z.coerce
          .date()
          .refine(
            (value) => value.getTime() <= Date.now(),
            "Birth date cannot be in the future.",
          )
          .nullable()
          .optional(),
        gender: z
          .enum(["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"])
          .nullable()
          .optional(),
        heightCm: z.number().min(50).max(260).nullable().optional(),
        weightKg: z.number().min(20).max(400).nullable().optional(),
        fitnessGoal: z.string().max(200).optional(),
        emergencyContact: z
          .object({
            name: z.string().max(120),
            phone: z.string().max(25),
            relationship: z.string().max(80),
          })
          .strict()
          .nullable()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
