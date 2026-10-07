import "dotenv/config";
import { z } from "zod";
import { normalizeClientOrigins } from "./clientOrigins.js";

const schema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    PORT: z.coerce.number().int().positive().default(5000),
    MONGO_URI: z
      .string()
      .regex(/^mongodb(?:\+srv)?:\/\//, "MONGO_URI must be a MongoDB connection URI.")
      .default("mongodb://127.0.0.1:27017/getfit4u"),
    CLIENT_ORIGIN: z.string().default("http://localhost:5173").transform((value, context) => {
      try {
        return normalizeClientOrigins(value);
      } catch (error) {
        context.addIssue({ code: "custom", message: error instanceof Error ? error.message : "Invalid CLIENT_ORIGIN" });
        return z.NEVER;
      }
    }),
    JWT_ACCESS_SECRET: z
      .string()
      .min(32)
      .default("development-access-secret-change-me-123456"),
    JWT_REFRESH_SECRET: z
      .string()
      .min(32)
      .default("development-refresh-secret-change-me-12345"),
    JWT_ACCESS_TTL: z.string().regex(/^[1-9]\d*[mhd]$/).default("15m"),
    JWT_REFRESH_TTL: z.string().regex(/^[1-9]\d*[mhd]$/).default("3d"),
    AUTH_OTP_HMAC_SECRET: z
      .string()
      .min(32)
      .default("development-auth-otp-secret-change-me-1234"),
    ATTENDANCE_QR_SECRET: z
      .string()
      .min(32)
      .default("development-attendance-qr-secret-change-me"),
    COOKIE_DOMAIN: z.preprocess(
      (value) => value || undefined,
      z.string().regex(/^(?:\.)?[A-Za-z0-9.-]+$/).optional(),
    ),
    REDIS_URL: z.string().default("redis://127.0.0.1:6379"),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    GOOGLE_CLIENT_ID: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.string().optional(),
    EMAIL_ENCRYPTION_KEY: z.preprocess((value) => value || undefined, z.string().min(32).optional()),
    // GOOGLE_MAPS_API_KEY: z.string().optional(), // Legacy Google geocoding is disabled.
    LOCATIONIQ_API_KEY: z.string().optional(),
    LOCATIONIQ_REGION: z.enum(["us1", "eu1"]).default("us1"),
    FIREBASE_PROJECT_ID: z.string().optional(),
    FIREBASE_CLIENT_EMAIL: z.string().optional(),
    FIREBASE_PRIVATE_KEY: z.string().optional(),
    MSG91_AUTH_KEY: z.string().optional(),
    MSG91_TEMPLATE_ID: z.string().optional(),
    WHATSAPP_MODE: z.enum(["disabled", "dry_run", "live"]).default("disabled"),
    WHATSAPP_APP_ID: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_WABA_ID: z.string().optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_API_VERSION: z
      .string()
      .regex(/^v\d+\.\d+$/)
      .default("v26.0"),
    WHATSAPP_DEFAULT_LANGUAGE: z.string().min(2).max(20).default("en_US"),
    WHATSAPP_AUTH_TEMPLATE_NAME: z.preprocess(
      (value) => value || undefined,
      z.string().regex(/^[a-z0-9_]+$/).optional(),
    ),
    WHATSAPP_AUTH_TEMPLATE_LANGUAGE: z.string().min(2).max(20).default("en_US"),
    WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID: z.string().optional(),
    WHATSAPP_COEXISTENCE_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
    WHATSAPP_COEXISTENCE_CONFIG_ID: z.string().optional(),
    WHATSAPP_CREDENTIAL_ENCRYPTION_KEY: z
      .preprocess((value) => value || undefined, z.string().min(32).optional()),
    WHATSAPP_WEBHOOK_RETENTION_DAYS: z.coerce.number().int().min(1).max(90).default(30),
    WHATSAPP_WORKER_ENABLED: z
      .enum(["true", "false"])
      .default("false")
      .transform((value) => value === "true"),
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
    if (value.WHATSAPP_MODE === "live") {
      for (const key of [
        "WHATSAPP_APP_ID",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_VERIFY_TOKEN",
        "WHATSAPP_EMBEDDED_SIGNUP_CONFIG_ID",
        "WHATSAPP_CREDENTIAL_ENCRYPTION_KEY",
      ] as const) {
        if (!value[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when WHATSAPP_MODE=live.`,
          });
        }
      }
    }
    if (value.NODE_ENV !== "production") return;
    const secretKeys = [
      "JWT_ACCESS_SECRET",
      "JWT_REFRESH_SECRET",
      "AUTH_OTP_HMAC_SECRET",
      "ATTENDANCE_QR_SECRET",
    ] as const;
    for (const key of secretKeys) {
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
    if (new Set(secretKeys.map((key) => value[key])).size !== secretKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message: "Production authentication and signing secrets must be independent values.",
      });
    }
    if (/mongodb(?:\+srv)?:\/\/(?:[^@/]+@)?(?:localhost|127\.0\.0\.1|\[::1\])(?::|\/)/i.test(value.MONGO_URI)) {
      context.addIssue({
        code: "custom",
        path: ["MONGO_URI"],
        message: "MONGO_URI must reference the persistent production database.",
      });
    }
    for (const origin of value.CLIENT_ORIGIN.split(",")) {
      const url = new URL(origin);
      if (url.protocol !== "https:" || ["localhost", "127.0.0.1", "::1"].includes(url.hostname)) {
        context.addIssue({
          code: "custom",
          path: ["CLIENT_ORIGIN"],
          message: "Production CLIENT_ORIGIN entries must use HTTPS public hostnames.",
        });
        break;
      }
    }
  });

export function parseEnvironment(input: NodeJS.ProcessEnv) {
  // Existing names retain precedence; standard AWS names are supported server-side.
  const awsRegion = input.OBJECT_STORAGE_REGION || input.AWS_REGION;
  return schema.parse({
    ...input,
    OBJECT_STORAGE_REGION: awsRegion,
    OBJECT_STORAGE_BUCKET: input.OBJECT_STORAGE_BUCKET || input.AWS_S3_BUCKET_NAME,
    OBJECT_STORAGE_ACCESS_KEY: input.OBJECT_STORAGE_ACCESS_KEY || input.AWS_ACCESS_KEY_ID,
    OBJECT_STORAGE_SECRET_KEY: input.OBJECT_STORAGE_SECRET_KEY || input.AWS_SECRET_ACCESS_KEY,
    OBJECT_STORAGE_SESSION_TOKEN: input.OBJECT_STORAGE_SESSION_TOKEN || input.AWS_SESSION_TOKEN,
    OBJECT_STORAGE_ENDPOINT: input.OBJECT_STORAGE_ENDPOINT ||
      (input.AWS_S3_BUCKET_NAME ? `https://s3.${awsRegion || "ap-south-1"}.amazonaws.com` : undefined),
  });
}

export const env = parseEnvironment(process.env);
export const isProduction = env.NODE_ENV === "production";
