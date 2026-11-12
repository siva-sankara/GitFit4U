import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { assertSafeOtpPreview } from "../config/otpPreviewPolicy.js";

// Select the isolated file before importing anything that loads config/env.ts.
// Never merge the normal application .env or change its database/settings.
const configPath = fileURLToPath(new URL("../../.env.otp-preview", import.meta.url));
if (!existsSync(configPath)) {
  const example = readFileSync(new URL("../../.env.otp-preview.example", import.meta.url), "utf8");
  const secrets = ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "AUTH_OTP_HMAC_SECRET", "ATTENDANCE_QR_SECRET"]
    .map(key => `${key}=${randomBytes(48).toString("hex")}`).join("\n");
  writeFileSync(configPath, `${example}\n${secrets}\n`, { flag: "wx", mode: 0o600 });
}
process.env.DOTENV_CONFIG_PATH = configPath;
dotenv.config({ path: configPath, quiet: true });
if (process.env.OTP_MODE !== "development_preview" || process.env.OTP_DEV_PREVIEW_ENABLED !== "true")
  throw new Error("The OTP preview command requires development_preview mode and OTP_DEV_PREVIEW_ENABLED=true in .env.otp-preview.");
assertSafeOtpPreview(process.env);
console.info("Starting local signup/login OTP preview. Use a local test MongoDB replica set; no WhatsApp messages or email will be sent.");
await import("../server.js");
