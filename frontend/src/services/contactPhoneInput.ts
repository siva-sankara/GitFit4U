import { parseIndianMobile } from "./authValidation";

export function isInternationalPhone(value: string) {
  return value.trim().startsWith("+") && !value.trim().startsWith("+91");
}

export function normalizeContactPhone(value: string): string | undefined {
  if (!value.trim()) return "";
  const local = parseIndianMobile(value);
  if (local) return `+91${local}`;
  if (!/^\+[0-9 ()-]+$/.test(value.trim())) return;
  const compact = value.trim().replace(/[ ()-]/g, "");
  if (isInternationalPhone(compact) && /^\+[1-9]\d{7,14}$/.test(compact)) return compact;
}

export function phoneDisplayValue(value: string, international: boolean) {
  if (international) return normalizeContactPhone(value) ?? value;
  return parseIndianMobile(value) ?? value;
}

export function isPhoneField(key: string) {
  return /(?:phone|mobile|whatsapp)$/i.test(key);
}
