/** Strict dialable account number. Never turn arbitrary text or extensions into a URI. */
export function normalizeContactPhone(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^[+\d\s()-]+$/.test(value.trim())) return undefined;
  const phone = value.replace(/[\s()-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(phone)) return phone;
  if (/^[6-9]\d{9}$/.test(phone)) return "+91" + phone;
  if (/^91[6-9]\d{9}$/.test(phone)) return "+" + phone;
  if (/^0[6-9]\d{9}$/.test(phone)) return "+91" + phone.slice(1);
  return undefined;
}
