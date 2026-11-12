import { describe, expect, it } from "vitest";
import { parseEnvironment } from "./env.js";

const production = {
  NODE_ENV: "production",
  MONGO_URI: "mongodb+srv://cluster.example/getfit4u",
  CLIENT_ORIGIN: "https://www.getfit4u.in,https://getfit4u.in",
  JWT_ACCESS_SECRET: "access-" + "a".repeat(64),
  JWT_REFRESH_SECRET: "refresh-" + "b".repeat(64),
  AUTH_OTP_HMAC_SECRET: "otp-" + "c".repeat(64),
  ATTENDANCE_QR_SECRET: "attendance-" + "d".repeat(64),
} satisfies NodeJS.ProcessEnv;

describe("production environment validation", () => {
  it("accepts stable public production auth configuration", () => {
    expect(parseEnvironment(production)).toMatchObject({
      NODE_ENV: "production",
      MONGO_URI: production.MONGO_URI,
      CLIENT_ORIGIN: production.CLIENT_ORIGIN,
      JWT_ACCESS_TTL: "15m",
      JWT_REFRESH_TTL: "3d",
    });
  });

  it.each([
    ["MONGO_URI", undefined],
    ["MONGO_URI", "mongodb://127.0.0.1:27017/getfit4u"],
    ["CLIENT_ORIGIN", undefined],
    ["CLIENT_ORIGIN", "http://localhost:5173"],
    ["CLIENT_ORIGIN", "http://www.getfit4u.in"],
  ])("rejects unsafe production %s=%s", (key, value) => {
    expect(() => parseEnvironment({ ...production, [key]: value })).toThrow();
  });

  it("rejects reused production signing secrets", () => {
    expect(() => parseEnvironment({
      ...production,
      JWT_REFRESH_SECRET: production.JWT_ACCESS_SECRET,
    })).toThrow(/independent/);
  });

  it("keeps local defaults available outside production", () => {
    expect(parseEnvironment({ NODE_ENV: "test" })).toMatchObject({
      MONGO_URI: "mongodb://127.0.0.1:27017/getfit4u",
      CLIENT_ORIGIN: "http://localhost:5173",
    });
  });

  it("allows a blank Route fee policy while Route is disabled", () => {
    expect(parseEnvironment({
      NODE_ENV: "test",
      RAZORPAY_ROUTE_ENABLED: "false",
      RAZORPAY_GYM_FEE_BEARER: "",
    })).toMatchObject({
      RAZORPAY_ROUTE_ENABLED: false,
      RAZORPAY_GYM_FEE_BEARER: undefined,
    });
  });

  it("does not require a new-order fee policy for historical Route reconciliation", () => {
    expect(parseEnvironment({
      NODE_ENV: "test",
      RAZORPAY_ROUTE_ENABLED: "true",
      RAZORPAY_GYM_FEE_BEARER: "",
    })).toMatchObject({ RAZORPAY_ROUTE_ENABLED: true, RAZORPAY_GYM_FEE_BEARER: undefined });
  });

  it("maps legacy Razorpay merchant variables to the scoped platform names", () => {
    expect(parseEnvironment({
      NODE_ENV: "test",
      RAZORPAY_KEY_ID: "rzp_test_legacy",
      RAZORPAY_KEY_SECRET: "legacy-secret",
      RAZORPAY_WEBHOOK_SECRET: "legacy-webhook",
    })).toMatchObject({
      RAZORPAY_PLATFORM_PAYMENTS_ENABLED: true,
      RAZORPAY_PLATFORM_KEY_ID: "rzp_test_legacy",
      RAZORPAY_PLATFORM_KEY_SECRET: "legacy-secret",
      RAZORPAY_PLATFORM_WEBHOOK_SECRET: "legacy-webhook",
    });
  });

  it("fails closed when gym OAuth is enabled without its server secrets", () => {
    expect(() => parseEnvironment({
      NODE_ENV: "test",
      RAZORPAY_GYM_OAUTH_ENABLED: "true",
    })).toThrow(/RAZORPAY_OAUTH_CLIENT_ID is required/);
  });

  it("accepts a fully configured test OAuth environment", () => {
    expect(parseEnvironment({
      NODE_ENV: "test",
      RAZORPAY_GYM_OAUTH_ENABLED: "true",
      RAZORPAY_OAUTH_CLIENT_ID: "client",
      RAZORPAY_OAUTH_CLIENT_SECRET: "client-secret",
      RAZORPAY_OAUTH_REDIRECT_URI: "https://api.example.com/api/v1/payments/razorpay/oauth/callback",
      RAZORPAY_OAUTH_WEBHOOK_SECRET: "webhook-secret",
      PAYMENT_TOKEN_ENCRYPTION_KEY: "a".repeat(64),
      FRONTEND_URL: "https://www.getfit4u.in",
    })).toMatchObject({ RAZORPAY_GYM_OAUTH_ENABLED: true, RAZORPAY_MODE: "test" });
  });

  it.each(["JWT_ACCESS_TTL", "JWT_REFRESH_TTL"])("rejects zero-duration %s", (key) => {
    expect(() => parseEnvironment({ NODE_ENV: "test", [key]: "0m" })).toThrow();
  });
});
