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

  it.each(["JWT_ACCESS_TTL", "JWT_REFRESH_TTL"])("rejects zero-duration %s", (key) => {
    expect(() => parseEnvironment({ NODE_ENV: "test", [key]: "0m" })).toThrow();
  });
});
