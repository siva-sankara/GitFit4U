/** Local-only by design: shared/public test servers are not an allowed tier. */
export function assertSafeOtpPreview(input: NodeJS.ProcessEnv) {
  if (input.OTP_MODE !== "development_preview" && input.OTP_DEV_PREVIEW_ENABLED !== "true") return;
  const localOrigin = (value: string) => {
    try { const url = new URL(value); return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) && ["http:", "https:"].includes(url.protocol); }
    catch { return false; }
  };
  const isolatedDatabase = /^mongodb:\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/gfu_otp_test_[a-z0-9_]+(?:\?[^#]*)?$/i.test(input.MONGO_URI || "");
  const deployed = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "RENDER", "RENDER_EXTERNAL_HOSTNAME", "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "FLY_APP_NAME", "AWS_LAMBDA_FUNCTION_NAME", "WEBSITE_HOSTNAME", "K_SERVICE"].some(key => Boolean(input[key]));
  const liveIntegration = ["RAZORPAY_KEY_SECRET", "RESEND_API_KEY", "FIREBASE_PRIVATE_KEY", "WHATSAPP_ACCESS_TOKEN", "OBJECT_STORAGE_SECRET_KEY", "AWS_SECRET_ACCESS_KEY", "CLOUDINARY_API_SECRET"].some(key => Boolean(input[key]));
  if (input.OTP_MODE !== "development_preview" || input.OTP_DEV_PREVIEW_ENABLED !== "true" ||
      !["development", "test"].includes(input.NODE_ENV || "") || input.OTP_PREVIEW_TIER !== "local" ||
      !isolatedDatabase || deployed || liveIntegration || input.WHATSAPP_MODE === "live" ||
      !(input.CLIENT_ORIGIN || "").split(",").every(value => localOrigin(value.trim())))
    throw new Error("Unsafe OTP preview configuration. Preview requires an explicit local tier, loopback-only origins, an isolated gfu_otp_test_* loopback database and no live integration credentials or deployment markers.");
}
