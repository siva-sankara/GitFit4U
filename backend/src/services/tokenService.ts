import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import type { CookieOptions, Response } from "express";
import { env, isProduction } from "../config/env.js";
import type { Role } from "../constants/domain.js";
import { Session } from "../models/Auth.js";
import { User } from "../models/User.js";
import { sha256 } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";
import { sessionExpiry, sessionIdleTtlMs } from "./sessionPolicy.js";

type AccessClaims = { sub: string; sid: string };

export function signAccessToken(userId: string, sessionId: string): string {
  return jwt.sign({ sid: sessionId }, env.JWT_ACCESS_SECRET, {
    subject: userId,
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions["expiresIn"],
    issuer: "getfit4u-api",
    audience: "getfit4u-web"
  });
}

export function verifyAccessToken(token: string): AccessClaims {
  const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, {
    issuer: "getfit4u-api",
    audience: "getfit4u-web"
  });
  if (typeof decoded === "string" || !decoded.sub || typeof decoded.sid !== "string") {
    throw new AppError(401, "INVALID_TOKEN", "Your session is invalid. Please sign in again.");
  }
  return { sub: decoded.sub, sid: decoded.sid };
}

export async function createSession(input: {
  userId: string;
  activeRole: Role;
  activeGymId?: string;
  userAgent?: string;
  ip?: string;
}) {
  const publicId = nanoid(24);
  const secret = crypto.randomBytes(48).toString("base64url");
  const refreshToken = `${publicId}.${secret}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionIdleTtlMs());
  await Session.create({
    publicId,
    userId: input.userId,
    tokenFamily: nanoid(24),
    refreshTokenHash: sha256(refreshToken),
    activeRole: input.activeRole,
    activeGymId: input.activeGymId,
    device: {
      name: input.userAgent?.slice(0, 80),
      userAgent: input.userAgent?.slice(0, 300),
      ipHash: input.ip ? sha256(input.ip) : undefined
    },
    lastUsedAt: now,
    expiresAt,
  });
  return { accessToken: signAccessToken(input.userId, publicId), refreshToken, sessionId: publicId, expiresAt };
}

export async function rotateRefreshToken(refreshToken: string, { activity = false }: { activity?: boolean } = {}) {
  if (typeof refreshToken !== "string")
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Please sign in again.");
  const parts = refreshToken.split(".");
  const sessionId = parts[0];
  if (parts.length !== 2 || !sessionId || !parts[1])
    throw new AppError(401, "INVALID_REFRESH_TOKEN", "Please sign in again.");
  const hash = sha256(refreshToken);
  // Concurrent tabs can reconstruct the same successor without storing a
  // plaintext refresh credential. The server secret prevents prediction.
  const successor = `${sessionId}.${crypto.createHmac("sha384", env.JWT_REFRESH_SECRET)
    .update(`gfu-refresh-v1\0${refreshToken}`).digest("base64url")}`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const session = await Session.findOne({ publicId: sessionId })
      .select("+refreshTokenHash +previousRefreshTokenHash");
    const active = session && !session.revokedAt && await User.exists({ _id: session.userId, status: "ACTIVE" });
    const now = new Date();
    if (!active || sessionExpiry(session) <= now)
      throw new AppError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.");
    const inGrace = session.refreshGraceUntil && session.refreshGraceUntil > now;
    const current = session.refreshTokenHash === hash;
    const previous = inGrace && session.previousRefreshTokenHash === hash &&
      session.refreshTokenHash === sha256(successor);
    if (!current && !previous) {
      await Session.updateMany(
        { tokenFamily: session.tokenFamily, refreshTokenHash: session.refreshTokenHash, revokedAt: null },
        { $set: { revokedAt: now, revokeReason: "TOKEN_REUSE" } },
      );
      throw new AppError(401, "REFRESH_TOKEN_REUSE", "This session was revoked for your protection.");
    }
    const rotate = current && !inGrace;
    const nextToken = rotate || previous ? successor : refreshToken;
    const expiresAt = activity ? new Date(now.getTime() + sessionIdleTtlMs()) : sessionExpiry(session);
    const updated = await Session.findOneAndUpdate(
      { publicId: sessionId, refreshTokenHash: session.refreshTokenHash, revokedAt: null, expiresAt: { $gt: now },
        ...(session.lastUsedAt ? { lastUsedAt: session.lastUsedAt } : {}),
      },
      { $set: { expiresAt, ...(activity ? { lastUsedAt: now } : {}), ...(rotate ? {
        refreshTokenHash: sha256(nextToken), previousRefreshTokenHash: hash,
        // Retries never extend the token-reuse grace window. Only foreground
        // activity extends the independent session inactivity deadline.
        refreshGraceUntil: new Date(now.getTime() + 10_000),
      } : {}) } },
      { returnDocument: "after" },
    );
    if (updated) return {
      accessToken: signAccessToken(String(session.userId), session.publicId),
      refreshToken: nextToken, sessionId: session.publicId,
      expiresAt: updated.expiresAt,
    };
    // A refresh or logout won the compare-and-swap; never overwrite its state.
  }
  throw new AppError(503, "REFRESH_BUSY", "Session recovery is busy. Please retry.");
}

export function buildRefreshCookieOptions(input: {
  production: boolean;
  domain?: string;
  maxAge?: number;
}): CookieOptions {
  return {
    httpOnly: true,
    secure: input.production,
    sameSite: input.production ? "none" : "lax",
    domain: input.domain || undefined,
    // Keep one policy for direct API calls and the same-origin Vercel proxy.
    // The refresh credential remains HttpOnly and is never read by JavaScript.
    path: "/",
    ...(input.maxAge === undefined ? {} : { maxAge: input.maxAge }),
  };
}

export function setRefreshCookie(res: Response, token: string, expiresAt = new Date(Date.now() + sessionIdleTtlMs())): void {
  clearLegacyRefreshCookies(res);
  res.cookie(
    "gfu_refresh",
    token,
    buildRefreshCookieOptions({
      production: isProduction,
      domain: env.COOKIE_DOMAIN,
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    }),
  );
}

export function clearRefreshCookie(res: Response): void {
  clearLegacyRefreshCookies(res);
  res.clearCookie(
    "gfu_refresh",
    buildRefreshCookieOptions({
      production: isProduction,
      domain: env.COOKIE_DOMAIN,
    }),
  );
}

function clearLegacyRefreshCookies(res: Response): void {
  // Remove narrower path variants that can shadow the current root cookie.
  // Browsers send the more specific (potentially stale) credential first.
  for (const path of ["/api/v1/auth", "/api/v1/auth/"]) {
    res.clearCookie("gfu_refresh", {
      ...buildRefreshCookieOptions({ production: isProduction, domain: env.COOKIE_DOMAIN }),
      path,
    });
  }
}
