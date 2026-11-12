import { describe, expect, it } from "vitest";
import { assertSafeOtpPreview } from "./otpPreviewPolicy.js";
const local = { NODE_ENV: "development", OTP_MODE: "development_preview", OTP_DEV_PREVIEW_ENABLED: "true", OTP_PREVIEW_TIER: "local", MONGO_URI: "mongodb://127.0.0.1:27017/gfu_otp_test_local", CLIENT_ORIGIN: "http://localhost:5173" };
describe("OTP preview deployment boundary", () => {
  it("defaults to no preview", () => expect(() => assertSafeOtpPreview({ NODE_ENV: "production" })).not.toThrow());
  it("allows only an explicitly isolated local setup", () => expect(() => assertSafeOtpPreview(local)).not.toThrow());
  it.each([
    { NODE_ENV: "production" }, { OTP_PREVIEW_TIER: "preview" }, { OTP_DEV_PREVIEW_ENABLED: "false" },
    { OTP_MODE: "whatsapp" }, { MONGO_URI: "mongodb://localhost/getfit4u" },
    { MONGO_URI: "mongodb+srv://cluster.example/gfu_otp_test_local" }, { CLIENT_ORIGIN: "https://preview.example.com" },
    { VERCEL: "1" }, { RENDER: "true" }, { RAILWAY_ENVIRONMENT_NAME: "test" }, { FIREBASE_PRIVATE_KEY: "configured" },
    { WHATSAPP_ACCESS_TOKEN: "configured" }, { WHATSAPP_MODE: "live" }, { RESEND_API_KEY: "configured" },
  ])("rejects unsafe boundary %j", override => expect(() => assertSafeOtpPreview({ ...local, ...override })).toThrow("Unsafe OTP preview"));
});
