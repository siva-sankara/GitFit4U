import pino from "pino";
import { env } from "./env.js";

export const safeError = (error: unknown) => {
  const value = error as { name?: unknown; code?: unknown } | null;
  const safe = (entry: unknown) =>
    typeof entry === "string" && /^[A-Za-z0-9_.-]{1,80}$/.test(entry)
      ? entry
      : undefined;
  return {
    type: safe(value?.name) || "Error",
    code: typeof value?.code === "number" ? value.code : safe(value?.code),
  };
};
export const logger = pino({
  level:
    env.NODE_ENV === "production" && ["debug", "trace"].includes(env.LOG_LEVEL)
      ? "info"
      : env.LOG_LEVEL,
  base: undefined,
  serializers: { err: safeError, error: safeError },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "phone",
      "email",
      "accountNumber",
      "razorpaySignature",
      "password",
      "passwordHash",
      "accessToken",
      "refreshToken",
      "token",
      "secret",
      "privateKey",
      "headers",
      "body",
      "req.body",
      "res.body",
      "res.headers",
      "*.password",
      "*.passwordHash",
      "*.accessToken",
      "*.refreshToken",
      "*.token",
      "*.secret",
      "*.privateKey",
      "*.email",
      "*.phone",
      "*.authorization",
      "*.cookie",
    ],
    censor: "[REDACTED]",
  },
});
