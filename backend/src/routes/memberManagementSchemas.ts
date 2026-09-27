import { z } from "zod";
const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{8,20}$/, "Enter a valid phone number");
const identifier = z.string().min(3).max(64);
const contact = {
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().optional(),
  phone: phone.optional(),
  avatarUrl: z.string().url().optional(),
  fitnessGoal: z.string().max(200).optional(),
  emergencyContact: z
    .object({
      name: z.string().max(120),
      phone,
      relationship: z.string().max(80),
    })
    .optional(),
  medicalNotes: z.string().max(2000).optional(),
};
export const ownerMemberCreateInput = z
  .object({
    ...contact,
    planId: identifier,
    startsAt: z.coerce.date(),
    payment: z.object({
      amountMinor: z.number().int().nonnegative(),
      method: z.enum(["CASH", "UPI", "CARD_POS", "BANK_TRANSFER", "OTHER"]),
      paidAt: z.coerce.date(),
      reference: z.string().max(120).optional(),
      notes: z.string().max(1000).optional(),
    }),
  })
  .refine((value) => value.email || value.phone, "Email or phone is required");
export const ownerMemberUpdateInput = z.object({
  ...contact,
  name: contact.name.optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
  assignedTrainerId: z
    .string()
    .regex(/^[a-f\d]{24}$/i)
    .nullable()
    .optional(),
  note: z.string().max(2000).optional(),
});
export const ownerTrainerInput = z.object({
  name: contact.name,
  email: z.string().trim().email(),
  phone: phone.optional(),
  photoUrl: z.string().url().optional(),
  bio: z.string().max(3000).optional(),
  qualifications: z.array(z.string().min(1).max(200)).max(20).optional(),
  specializations: z.array(z.string().min(1).max(120)).max(20).optional(),
  experienceYears: z.number().min(0).max(70).optional(),
  availability: z
    .array(
      z
        .object({
          day: z.number().int().min(0).max(6),
          from: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          to: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
        })
        .refine((v) => v.from < v.to, "Availability must end after it starts"),
    )
    .max(21)
    .optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});
