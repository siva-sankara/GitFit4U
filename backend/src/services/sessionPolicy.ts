import { env } from "../config/env.js";

/** Refresh-cookie lifetime and maximum time without foreground user activity. */
export function sessionIdleTtlMs(): number {
  const match = /^(\d+)([dhm])$/.exec(env.JWT_REFRESH_TTL);
  if (!match) return 3 * 86_400_000;
  const multiplier = match[2] === "d" ? 86_400_000 : match[2] === "h" ? 3_600_000 : 60_000;
  return Number(match[1]) * multiplier;
}

export function sessionExpiry(session: {
  expiresAt: Date;
  lastUsedAt?: Date;
  createdAt?: Date;
}): Date {
  // Apply the idle policy to sessions created with the former 30-day lifetime
  // too. Background token rotations must not change lastUsedAt.
  const lastActivity = session.lastUsedAt || session.createdAt;
  return new Date(Math.min(
    new Date(session.expiresAt).getTime(),
    lastActivity ? new Date(lastActivity).getTime() + sessionIdleTtlMs() : Infinity,
  ));
}
