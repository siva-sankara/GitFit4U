import { AppError } from "./AppError.js";

// Account identity policy: trim/lowercase email, retaining dots and plus tags.
export const normalizeEmail = (value: string) => value.trim().toLowerCase();

function phoneDigits(input: string): string {
  const value = input.trim();
  // Parse only recognized phone formatting. Never strip arbitrary text, decimal
  // points or scientific notation into a different, apparently valid number.
  if (!/^\+?[0-9 ()-]+$/.test(value)) throw invalidPhone();
  return value.replace(/[ ()-]/g, "");
}
function invalidPhone() {
  return new AppError(422, "INVALID_PHONE", "Enter a valid mobile number with country code.");
}
export function normalizeIndiaSignupPhone(input: string): string {
  let digits: string;
  try { digits = phoneDigits(input); } catch {
    throw new AppError(422, "INVALID_PHONE", "Enter a 10-digit mobile number.");
  }
  const local = digits.startsWith("+91") ? digits.slice(3) : digits;
  if (!/^\d{10}$/.test(local))
    throw new AppError(422, "INVALID_PHONE", "Enter a 10-digit mobile number.");
  return `+91${local}`;
}

// Explicit international numbers and Indian national/trunk-prefix aliases are
// normalized to E.164. Public signup and WhatsApp authentication use this path.
export function normalizeAccountPhone(input: string): string {
  const digits = phoneDigits(input);
  if (digits.startsWith("+") && !digits.startsWith("+91")) {
    if (!/^\+[1-9]\d{7,14}$/.test(digits)) throw invalidPhone();
    return digits;
  }
  const local = digits.startsWith("+91") ? digits.slice(3)
    : /^0\d{10}$/.test(digits) ? digits.slice(1) : digits;
  if (!/^\d{10}$/.test(local)) throw invalidPhone();
  return `+91${local}`;
}

// Newly entered contacts use exactly ten Indian local digits; explicit foreign
// country codes remain intact. Legacy trunk aliases are only for account lookup.
export function normalizeContactPhone(input: string): string {
  const value = input.trim();
  return value.startsWith("+") && !value.startsWith("+91")
    ? normalizeAccountPhone(value) : normalizeIndiaSignupPhone(value);
}

export function duplicateAccountError() {
  return new AppError(409, "ACCOUNT_EXISTS", "An account already exists for these details. Sign in or recover your account.");
}
export function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === 11000;
}
