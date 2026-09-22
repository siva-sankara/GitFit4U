import pino from "pino";
import { env } from "./env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "phone",
      "email",
      "accountNumber",
      "razorpaySignature"
    ],
    censor: "[REDACTED]"
  }
});
