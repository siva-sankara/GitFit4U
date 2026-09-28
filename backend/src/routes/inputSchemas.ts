import { z } from "zod";
import { accountEmail, optionalContactPhone } from "./authSchemas.js";
export const id = z
  .string()
  .regex(/^[a-f\d]{24}$/i, "Invalid record identifier");
const text = z.string().trim().min(1).max(160);
const money = z.number().int().min(0).max(100_000_000);
export const gymInput = z.object({
  location: z
    .object({
      coordinates: z.tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ]),
    })
    .optional(),
  timezone: z
    .string()
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, "Invalid timezone")
    .optional(),
  name: text,
  description: z.string().max(4000).optional(),
  coverImageUrl: z.string().url().optional(),
  logoUrl: z.string().url().optional(),
  gallery: z.array(z.string().url()).max(20).optional(),
  mediaAttachmentIds: z
    .array(id)
    .max(25)
    .refine((v) => new Set(v).size === v.length, "Duplicate media files")
    .optional(),
  coverAttachmentId: id.nullable().optional(),
  logoAttachmentId: id.nullable().optional(),
  benefits: z.array(text).max(30).optional(),
  facilities: z.array(text).max(30).optional(),
  amenities: z.array(text).max(30).optional(),
  contact: z
    .object({
      phone: optionalContactPhone.nullable(),
      email: z.string().email().nullable().optional(),
      whatsapp: optionalContactPhone.nullable(),
      website: z.string().url().nullable().optional(),
    })
    .optional(),
  address: z
    .object({
      line1: text.optional(),
      line2: text.optional(),
      locality: text.optional(),
      city: text.optional(),
      state: text.optional(),
      postalCode: z.string().max(12).optional(),
      country: z.string().length(2).optional(),
    })
    .optional(),
  attendanceLocationRequired: z.boolean().optional(),
  classReminders: z.object({
    enabled: z.boolean(),
    leadMinutes: z.number().int().min(15).max(1440),
  }).strict().optional(),
  membershipReminders: z.object({ postExpiryDays: z.number().int().min(0).max(7) }).strict().optional(),
  attendanceRadiusMeters: z.number().int().min(25).max(1000).optional(),
  openingHours: z
    .array(
      z
        .object({
          day: z.number().int().min(0).max(6),
          closed: z.boolean(),
          opensAt: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .optional(),
          closesAt: z
            .string()
            .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
            .optional(),
        })
        .refine(
          (v) =>
            v.closed ||
            (!!v.opensAt && !!v.closesAt && v.opensAt !== v.closesAt),
          "Open days require different opening and closing times",
        ),
    )
    .max(7)
    .refine(
      (v) => new Set(v.map((d) => d.day)).size === v.length,
      "Each day can appear only once",
    )
    .optional(),
});
export const planInput = z.object({
  name: text,
  code: text,
  description: z.string().max(3000).optional(),
  durationDays: z.number().int().min(1).max(1095),
  priceMinor: money,
  discountMinor: money.optional(),
  taxRateBasisPoints: z.number().int().min(0).max(10000).optional(),
  benefits: z.array(text).max(30).optional(),
  freezeDaysAllowed: z.number().int().min(0).max(90).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"]).optional(),
});
export const memberInput = z
  .object({
    name: text,
    email: accountEmail.optional(),
    phone: optionalContactPhone,
    fitnessGoal: z.string().max(200).optional(),
  })
  .refine((v) => v.email || v.phone, "Email or phone is required");
export const memberUpdate = z.object({
  fitnessGoal: z.string().max(200).optional(),
  assignedTrainerId: id.optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"]).optional(),
});
export const classInput = z
  .object({
    name: text,
    category: z.enum([
      "YOGA",
      "ZUMBA",
      "CROSSFIT",
      "HIIT",
      "STRENGTH",
      "CARDIO",
      "OTHER",
    ]),
    trainerId: z.preprocess(
      (value) => (value === "" ? undefined : value),
      id.nullable().optional(),
    ),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    capacity: z.number().int().min(1).max(1000),
    imageAttachmentId: id.nullable().optional(),
    room: z.string().trim().max(160).optional(),
    description: z.string().trim().max(3000).optional(),
    status: z.enum(["SCHEDULED", "CANCELLED", "COMPLETED"]).optional(),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: "End time must be later than start time.",
    path: ["endsAt"],
  });
export const trainerInput = z.object({
  name: text,
  email: accountEmail,
  bio: z.string().max(3000).optional(),
  qualifications: z.array(text).max(20).optional(),
  specializations: z.array(text).max(20).optional(),
});
export const campaignInput = z.object({
  name: text,
  channel: z.enum(["IN_APP", "WHATSAPP", "PUSH", "EMAIL"]),
  audience: z.object({
    status: z.enum(["ACTIVE", "INACTIVE", "SUSPENDED"]).default("ACTIVE"),
  }),
  message: z.string().min(1).max(3000),
  templateId: text.optional(),
});
export { offerInput, adInput } from "./promotionSchemas.js";
export const platformInput = z.object({
  code: text,
  name: text,
  billingPeriod: z.enum(["MONTHLY", "YEARLY"]),
  priceMinor: money.min(100),
  memberLimit: z.number().int().positive().optional(),
  staffLimit: z.number().int().positive().optional(),
  features: z.array(text).max(30).optional(),
  active: z.boolean().optional(),
});
export const workoutInput = z.object({
  name: text,
  description: z.string().max(3000).optional(),
  goal: z.string().max(200).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
  exercises: z
    .array(
      z.object({
        name: text,
        sets: z.number().int().min(1).max(100).optional(),
        reps: text.optional(),
        notes: z.string().max(1000).optional(),
      }),
    )
    .min(1)
    .max(100),
});
export const progressInput = z.object({
  recordedAt: z.coerce.date().optional(),
  weightKg: z.number().min(20).max(400).optional(),
  bodyFatPercent: z.number().min(1).max(80).optional(),
  notes: z.string().max(3000).optional(),
});
export const reviewInput = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(160).optional(),
  body: z.string().max(3000).optional(),
  attachmentIds: z.array(id).max(8).refine(value => new Set(value).size === value.length, "Choose each image only once.").optional(),
  removeLegacyPhotos: z.boolean().optional(),
}).strict();
