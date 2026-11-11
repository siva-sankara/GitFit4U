import { AppError } from "./AppError.js";

/** Meta expects country-code digits, without a leading +. */
export function normalizeWhatsAppRecipient(value: string) {
  const invalid = () => new AppError(422, "WHATSAPP_PHONE_INVALID", "A valid international phone number is required.");
  if (typeof value !== "string" || !/^\+?[\d ()-]+$/.test(value.trim())) throw invalid();
  let digits = value.replace(/\D/g, "");
  if (!value.trim().startsWith("+")) {
    if (/^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`;
    else if (/^0[6-9]\d{9}$/.test(digits)) digits = `91${digits.slice(1)}`;
  }
  if (!/^[1-9]\d{7,14}$/.test(digits) || /^(\d)\1+$/.test(digits)) throw invalid();
  return digits;
}
