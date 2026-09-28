import crypto from "node:crypto";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";

interface QrPayload {
  v: 1;
  memberId: string;
  gymId: string;
  nonce: string;
  exp: number;
}
const encode = (value: string) => Buffer.from(value).toString("base64url");
const sign = (encoded: string) =>
  crypto
    .createHmac("sha256", env.ATTENDANCE_QR_SECRET)
    .update(encoded)
    .digest("base64url");

export function issueAttendanceQr(
  memberId: string,
  gymId: string,
  ttlSeconds = 60,
) {
  const expiresAt = new Date(
    Date.now() + Math.min(Math.max(ttlSeconds, 30), 120) * 1000,
  );
  const payload: QrPayload = {
    v: 1,
    memberId,
    gymId,
    nonce: nanoid(24),
    exp: Math.floor(expiresAt.getTime() / 1000),
  };
  const encoded = encode(JSON.stringify(payload));
  return {
    token: `${encoded}.${sign(encoded)}`,
    expiresAt,
    nonce: payload.nonce,
  };
}

export function verifyAttendanceQr(token: string): QrPayload {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature)
    throw new AppError(400, "INVALID_QR", "This attendance QR is invalid.");
  const expected = sign(encoded);
  const valid =
    signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid)
    throw new AppError(400, "INVALID_QR", "This attendance QR is invalid.");
  let payload: QrPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_QR", "This attendance QR is invalid.");
  }
  if (payload.v !== 1 || payload.exp <= Math.floor(Date.now() / 1000))
    throw new AppError(
      410,
      "QR_EXPIRED",
      "This attendance QR has expired. Ask the member to refresh it.",
    );
  return payload;
}

export interface GymQrPayload {
  v: 2;
  purpose: "GYM_ATTENDANCE";
  gymId: string;
  identityId: string;
  revision: number;
}
export function issueGymQr(
  gymId: string,
  identityId: string,
  revision: number,
) {
  const payload: GymQrPayload = {
    v: 2,
    purpose: "GYM_ATTENDANCE",
    gymId,
    identityId,
    revision,
  };
  const encoded = encode(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}
export function verifyGymQr(token: string): GymQrPayload {
  if (
    typeof token !== "string" ||
    token.length > 2048 ||
    token.split(".").length !== 2
  )
    throw new AppError(
      400,
      "INVALID_QR",
      "Scan the gym attendance QR displayed at reception.",
    );
  const [encoded, signature] = token.split(".");
  const expected = sign(encoded);
  if (
    Buffer.byteLength(signature) !== Buffer.byteLength(expected) ||
    !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))
  )
    throw new AppError(
      400,
      "INVALID_QR",
      "This gym QR is invalid or has been modified.",
    );
  let payload: GymQrPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new AppError(400, "INVALID_QR", "This gym QR is invalid.");
  }
  if (
    payload.v !== 2 ||
    payload.purpose !== "GYM_ATTENDANCE" ||
    !/^[a-f\d]{24}$/i.test(payload.gymId) ||
    typeof payload.identityId !== "string" ||
    !Number.isInteger(payload.revision) ||
    payload.revision < 1
  )
    throw new AppError(
      400,
      "INVALID_QR",
      "Scan the current gym attendance QR.",
    );
  return payload;
}
