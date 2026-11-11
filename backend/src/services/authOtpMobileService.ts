import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { AppError } from "../utils/AppError.js";
import { sendOtpSms } from "./smsService.js";
import { sendWhatsAppAuthenticationOtp } from "./whatsappAuthOtpService.js";

export const whatsappOtpAvailable = () => env.WHATSAPP_MODE === "live" && env.WHATSAPP_AUTH_OTP_ENABLED !== false;

/** One server-generated code; changing delivery channel never changes its proof. */
export async function sendMobileAuthenticationOtp(phone: string, code: string) {
  let whatsappError: unknown;
  if (whatsappOtpAvailable()) {
    try { return await sendWhatsAppAuthenticationOtp(phone, code); }
    catch (error) { whatsappError = error; }
  } else {
    logger.info({ event: "auth.otp.whatsapp.skipped", reason: "OTP_TEMPLATE_DISABLED" }, "WhatsApp authentication is disabled; using configured fallback channels");
  }
  if (env.MSG91_AUTH_KEY && env.MSG91_TEMPLATE_ID) {
    if (await sendOtpSms(phone, code)) return { providerMessageId: `sms:${nanoid(24)}` };
  }
  if (whatsappError instanceof AppError)
    throw new AppError(whatsappError.statusCode, whatsappError.code, "The verification message could not be sent. Try another available sign-in method.", whatsappError.details);
  if (whatsappError) throw whatsappError;
  throw new AppError(503, "OTP_MOBILE_UNAVAILABLE", "Mobile verification is unavailable. Use your verified email or password to sign in.");
}
