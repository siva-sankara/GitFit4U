import { AppError } from "./AppError.js";

// Shared with the existing Member List reminder flow. Keep its normalization
// contract stable; manual messaging validates ambiguous input before using it.
export function normalizeWhatsAppRecipient(value: string, international = false) {
  let digits = value.replace(/\D/g, "");
  if (!international && /^[6-9]\d{9}$/.test(digits)) digits = `91${digits}`;
  else if (/^0[6-9]\d{9}$/.test(digits)) digits = `91${digits.slice(1)}`;
  if (!/^\d{8,15}$/.test(digits))
    throw new AppError(422, "WHATSAPP_PHONE_INVALID", "A verified international phone number is required.");
  return digits;
}

export function whatsappChatUrl(phone: string, message?: string, international = false) {
  const recipient = normalizeWhatsAppRecipient(phone, international);
  return `https://wa.me/${recipient}${message === undefined ? "" : `?text=${encodeURIComponent(message)}`}`;
}

export function manualWhatsAppChatUrl(phone: string) {
  // Local numbers use the existing Indian default. Other countries need an
  // explicit international prefix to avoid guessing a recipient's country.
  const value = phone.trim();
  if (!/^\+?[\d\s().-]+$/.test(value)) return null;
  const digits = value.replace(/\D/g, "");
  if (value.startsWith("+") && digits.startsWith("0")) return null;
  const indian = /^(?:0|91)?[6-9]\d{9}$/.test(digits);
  if (!indian && !(value.startsWith("+") && /^[1-9]\d{7,14}$/.test(digits))) return null;
  try { return whatsappChatUrl(value, undefined, value.startsWith("+")); } catch { return null; }
}
