import "dotenv/config";
import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGO_URI: z.string().min(1).default("mongodb://127.0.0.1:27017/getfit4u"),
    CLIENT_ORIGIN: z.string().default("http://localhost:5173"),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32)
      .default("development-access-secret-change-me-123456"),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32)
      .default("development-refresh-secret-change-me-12345"),
    JWT_ACCESS_TTL: z.string().default("15m"),
    JWT_REFRESH_TTL: z.string().default("30d"),
    ATTENDANCE_QR_SECRET: z
      .string()
      .min(32)
      .default("development-attendance-qr-secret-change-me"),
    COOKIE_DOMAIN: z.string().optional(),
    REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    // GOOGLE_MAPS_API_KEY: z.string().optional(), // Legacy Google geocoding is disabled.
    LOCATIONIQ_API_KEY: z.string().optional(),
    LOCATIONIQ_REGION: z.enum(["us1", "eu1"]).default("us1"),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_TEMPLATE_ID: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    OBJECT_STORAGE_ENDPOINT: z.string().optional(),
    OBJECT_STORAGE_BUCKET: z.string().default("getfit4u-media"),
    OBJECT_STORAGE_ACCESS_KEY: z.string().optional(),
    OBJECT_STORAGE_SECRET_KEY: z.string().optional(),
    OBJECT_STORAGE_SESSION_TOKEN: z.string().optional(),
    OBJECT_STORAGE_REGION: z.string().default("ap-south-1"),
    MEDIA_STORAGE_PROVIDER: z.preprocess(
      (v) => v || undefined,
      z.enum(["s3", "cloudinary"]).optional(),
    ),
    CLOUDINARY_CLOUD_NAME: z.preprocess(
      (v) => v || undefined,
      z
        .string()
        .regex(/^[a-zA-Z0-9_-]+$/)
        .optional(),
    ),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    CLOUDINARY_FOLDER: z.preprocess(
      (v) => v || undefined,
      z
        .string()
        .regex(/^[a-zA-Z0-9/_-]+$/)
        .default("getfit4u"),
    ),
    LOG_LEVEL: z.string().default("info"),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV !== "production") return;
    for (const key of [
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "ATTENDANCE_QR_SECRET",
    ] as const) {
      if (
        value[key].length < 48 ||
        value[key].includes("development") ||
        value[key].includes("change-me")
      ) {
        context.addIssue({
          code: "custom",
          path: [key],
          message: `${key} must be an independent production secret of at least 48 characters.`,
        });
      }
    }
  });

// Existing names retain precedence; standard AWS names are supported server-side.
const awsRegion = process.env.OBJECT_STORAGE_REGION || process.env.AWS_REGION;
export const env = schema.parse({
  ...process.env,
  OBJECT_STORAGE_REGION: awsRegion,
  OBJECT_STORAGE_BUCKET: process.env.OBJECT_STORAGE_BUCKET || process.env.AWS_S3_BUCKET_NAME,
  OBJECT_STORAGE_ACCESS_KEY: process.env.OBJECT_STORAGE_ACCESS_KEY || process.env.AWS_ACCESS_KEY_ID,
  OBJECT_STORAGE_SECRET_KEY: process.env.OBJECT_STORAGE_SECRET_KEY || process.env.AWS_SECRET_ACCESS_KEY,
  OBJECT_STORAGE_SESSION_TOKEN: process.env.OBJECT_STORAGE_SESSION_TOKEN || process.env.AWS_SESSION_TOKEN,
  OBJECT_STORAGE_ENDPOINT: process.env.OBJECT_STORAGE_ENDPOINT ||
    (process.env.AWS_S3_BUCKET_NAME ? `https://s3.${awsRegion || "ap-south-1"}.amazonaws.com` : undefined),
});
export const isProduction = env.NODE_ENV === "production";
