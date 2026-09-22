import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { nanoid } from "nanoid";
import type { Response } from "express";
import { env, isProduction } from "../config/env.js";
import type { Role } from "../constants/domain.js";
import { Session } from "../models/Auth.js";
import { sha256 } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";

type AccessClaims = { sub: string; sid: string };

function refreshExpiry(): Date {
  const value = env.JWT_REFRESH_TTL;
  const match = /^(\d+)([dhm])$/.exec(value);
  if (!match) return new Date(Date.now() + 30 * 86_400_000);
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "d" ? 86_400_000 : unit === "h" ? 3_600_000 : 60_000;
  return new Date(Date.now() + amount * multiplier);
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
  const [sessionId] = refreshToken.split(".");
  if (!sessionId) throw new AppError(401, "INVALID_REFRESH_TOKEN", "Please sign in again.");
  const session = await Session.findOne({ publicId: sessionId }).select("+refreshTokenHash");
  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new AppError(401, "SESSION_EXPIRED", "Your session has expired. Please sign in again.");
  }
  if (session.refreshTokenHash !== sha256(refreshToken)) {
    await Session.updateMany({ tokenFamily: session.tokenFamily }, { revokedAt: new Date(), revokeReason: "TOKEN_REUSE" });
    throw new AppError(401, "REFRESH_TOKEN_REUSE", "This session was revoked for your protection.");
  }
  const newSecret = crypto.randomBytes(48).toString("base64url");
  const newRefreshToken = `${session.publicId}.${newSecret}`;
  session.refreshTokenHash = sha256(newRefreshToken);
  session.lastUsedAt = new Date();
  await session.save();
  return {
    accessToken: signAccessToken(String(session.userId), session.publicId),
    refreshToken: newRefreshToken,
    sessionId: session.publicId
  };
}

export function setRefreshCookie(res: Response, token: string): void {
  res.cookie("gfu_refresh", token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    domain: env.COOKIE_DOMAIN || undefined,
    path: "/api/v1/auth",
    maxAge: 30 * 86_400_000
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
