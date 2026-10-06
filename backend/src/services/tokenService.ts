import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import type { Response } from "express";
import { env, isProduction } from "../config/env.js";
import type { Role } from "../constants/domain.js";
import { Session } from "../models/Auth.js";
import { User } from "../models/User.js";
import { sha256 } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";

type AccessClaims = { sub: string; sid: string };

function refreshTtlMs(): number {
  const value = env.JWT_REFRESH_TTL;
  const match = /^(\d+)([dhm])$/.exec(value);
  if (!match) return 30 * 86_400_000;
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  return amount * multiplier;
}

function refreshExpiry(): Date {
  return new Date(Date.now() + refreshTtlMs());
}

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
    expiresAt: refreshExpiry()
  });
  return { accessToken: signAccessToken(input.userId, publicId), refreshToken, sessionId: publicId };
}

export async function rotateRefreshToken(refreshToken: string) {
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
    if (!active || session.expiresAt <= now)
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
    const updated = await Session.findOneAndUpdate(
      { publicId: sessionId, refreshTokenHash: session.refreshTokenHash, revokedAt: null, expiresAt: { $gt: now } },
      { $set: { lastUsedAt: now, ...(rotate ? {
        refreshTokenHash: sha256(nextToken), previousRefreshTokenHash: hash,
        // Fixed window: retries never extend it or absolute session expiry.
        refreshGraceUntil: new Date(now.getTime() + 10_000),
      } : {}) } },
      { returnDocument: "after" },
    );
    if (updated) return {
      accessToken: signAccessToken(String(session.userId), session.publicId),
      refreshToken: nextToken, sessionId: session.publicId,
    };
    // A refresh or logout won the compare-and-swap; never overwrite its state.
  }
  throw new AppError(503, "REFRESH_BUSY", "Session recovery is busy. Please retry.");
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie("gfu_refresh", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    domain: env.COOKIE_DOMAIN || undefined,
    path: "/api/v1/auth",
    maxAge: refreshTtlMs()
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie("gfu_refresh", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    domain: env.COOKIE_DOMAIN || undefined,
    path: "/api/v1/auth"
  });
}
