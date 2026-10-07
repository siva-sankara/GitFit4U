import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Response } from "express";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { sha256 } from "../utils/crypto.js";

const mocks = vi.hoisted(() => ({ create: vi.fn(), find: vi.fn(), update: vi.fn(), revoke: vi.fn(), active: vi.fn() }));
vi.mock("../models/Auth.js", () => ({ Session: { create: mocks.create, findOne: mocks.find, findOneAndUpdate: mocks.update, updateMany: mocks.revoke } }));
vi.mock("../models/User.js", () => ({ User: { exists: mocks.active } }));
vi.mock("../config/env.js", () => ({ env: { JWT_ACCESS_SECRET: "isolated-test-access-secret-not-production", JWT_REFRESH_SECRET: "isolated-test-refresh-secret-not-production", JWT_ACCESS_TTL: "15m", JWT_REFRESH_TTL: "3d" }, isProduction: false }));
import { buildRefreshCookieOptions, clearRefreshCookie, createSession, rotateRefreshToken, setRefreshCookie, verifyAccessToken } from "./tokenService.js";
import { sessionExpiry } from "./sessionPolicy.js";

const original = "test-session.original-test-secret";
let record: any;
const day = 86_400_000;
const started = new Date("2026-10-07T10:00:00Z");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(started);
  vi.clearAllMocks();
  mocks.active.mockResolvedValue({ _id: "user" });
  record = { publicId: "test-session", userId: "user", tokenFamily: "family", refreshTokenHash: sha256(original), lastUsedAt: started, expiresAt: new Date(Date.now() + 3 * day) };
  mocks.find.mockImplementation(() => ({ select: async () => {
    const snapshot = { ...record };
    return { ...snapshot, save: async function () { Object.assign(record, this); } };
  } }));
  mocks.update.mockImplementation(async (filter, update) => {
    if (record.revokedAt || record.expiresAt <= new Date() || filter.refreshTokenHash !== record.refreshTokenHash ||
      (filter.lastUsedAt && filter.lastUsedAt.getTime() !== record.lastUsedAt.getTime())) return null;
    Object.assign(record, update.$set);
    return { ...record };
  });
  mocks.revoke.mockImplementation(async () => { record.revokedAt = new Date(); });
});
afterEach(() => vi.useRealTimers());

it("converges simultaneous refreshes on one cookie instead of revoking the losing tab", async () => {
  const [first, second] = await Promise.all([rotateRefreshToken(original), rotateRefreshToken(original)]);
  expect(first.refreshToken).toBe(second.refreshToken);
  expect(record.refreshTokenHash).toBe(sha256(first.refreshToken));
  await expect(rotateRefreshToken(first.refreshToken)).resolves.toMatchObject({ refreshToken: first.refreshToken });
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it("converges background cookie retries without extending grace or inactivity expiry", async () => {
  const first = await rotateRefreshToken(original);
  const grace = record.refreshGraceUntil;
  const expiry = record.expiresAt;
  const result = await Promise.all([rotateRefreshToken(original), rotateRefreshToken(first.refreshToken)]);
  expect(result.map(value => value.refreshToken)).toEqual([first.refreshToken, first.refreshToken]);
  expect(record.refreshGraceUntil).toBe(grace);
  expect(record.expiresAt).toEqual(expiry);
});

it("revokes reuse of the previous credential after the bounded grace period", async () => {
  await rotateRefreshToken(original);
  record.refreshGraceUntil = new Date(Date.now() - 1);
  await expect(rotateRefreshToken(original)).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSE" });
  expect(record.revokedAt).toBeInstanceOf(Date);
});

it.each(["expired", "revoked", "inactive"])("rejects %s sessions even within grace", async (reason) => {
  const first = await rotateRefreshToken(original);
  if (reason === "expired") record.expiresAt = new Date(Date.now() - 1);
  if (reason === "revoked") record.revokedAt = new Date();
  if (reason === "inactive") mocks.active.mockResolvedValue(null);
  await expect(rotateRefreshToken(first.refreshToken)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  await expect(rotateRefreshToken(original)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
});

it("cannot overwrite logout that wins the atomic update", async () => {
  mocks.update.mockImplementationOnce(async () => { record.revokedAt = new Date(); return null; });
  await expect(rotateRefreshToken(original)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  expect(record.revokedAt).toBeInstanceOf(Date);
  expect(record.refreshTokenHash).toBe(sha256(original));
});

it("rotates again after grace and rejects unknown or malformed credentials", async () => {
  const first = await rotateRefreshToken(original);
  record.refreshGraceUntil = new Date(Date.now() - 1);
  const next = await rotateRefreshToken(first.refreshToken);
  expect(next.refreshToken).not.toBe(first.refreshToken);
  await expect(rotateRefreshToken("test-session.wrong-secret")).rejects.toMatchObject({ code: "REFRESH_TOKEN_REUSE" });
  await expect(rotateRefreshToken("malformed")).rejects.toMatchObject({ code: "INVALID_REFRESH_TOKEN" });
});

it("uses a persistent host-only production cookie that survives all application routes", () => {
  expect(buildRefreshCookieOptions({
    production: true,
    maxAge: 3 * 86_400_000,
  })).toEqual({
    httpOnly: true,
    secure: true,
    sameSite: "none",
    domain: undefined,
    path: "/",
    maxAge: 3 * 86_400_000,
  });
});

it("creates a persistent session for three days from login", async () => {
  const result = await createSession({ userId: "user", activeRole: "USER" });
  expect(result.expiresAt).toEqual(new Date(started.getTime() + 3 * day));
  expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ lastUsedAt: started, expiresAt: result.expiresAt }));
  const res = { cookie: vi.fn(), clearCookie: vi.fn() };
  setRefreshCookie(res as unknown as Response, result.refreshToken, result.expiresAt);
  expect(res.cookie).toHaveBeenCalledWith("gfu_refresh", result.refreshToken, expect.objectContaining({ httpOnly: true, maxAge: 3 * day }));
});

it("starts a new three-day window on every return before expiry, beyond the original login deadline", async () => {
  vi.setSystemTime(started.getTime() + 2 * day);
  const first = await rotateRefreshToken(original, { activity: true });
  expect(record.expiresAt).toEqual(new Date(started.getTime() + 5 * day));
  expect(record.lastUsedAt).toEqual(new Date(started.getTime() + 2 * day));
  vi.setSystemTime(started.getTime() + 4 * day);
  const second = await rotateRefreshToken(first.refreshToken, { activity: true });
  expect(second.expiresAt).toEqual(new Date(started.getTime() + 7 * day));
  expect(record.lastUsedAt).toEqual(new Date(started.getTime() + 4 * day));
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it.each([-1, 0, 1])("enforces the exact 72-hour idle boundary (offset %s ms)", async (offset) => {
  vi.setSystemTime(started.getTime() + 3 * day + offset);
  if (offset < 0) {
    await expect(rotateRefreshToken(original, { activity: true })).resolves.toHaveProperty("accessToken");
    expect(record.expiresAt).toEqual(new Date(Date.now() + 3 * day));
  } else {
    await expect(rotateRefreshToken(original, { activity: true })).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(mocks.update).not.toHaveBeenCalled();
  }
});

it("background refreshes preserve last activity and only give the cookie its remaining lifetime", async () => {
  vi.setSystemTime(started.getTime() + 2 * day);
  const result = await rotateRefreshToken(original);
  expect(record.lastUsedAt).toEqual(started);
  expect(result.expiresAt).toEqual(new Date(started.getTime() + 3 * day));
  const res = { cookie: vi.fn(), clearCookie: vi.fn() };
  setRefreshCookie(res as unknown as Response, result.refreshToken, result.expiresAt);
  expect(res.cookie).toHaveBeenCalledWith("gfu_refresh", result.refreshToken, expect.objectContaining({ maxAge: day }));
  vi.setSystemTime(started.getTime() + 3 * day);
  await expect(rotateRefreshToken(result.refreshToken)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
});

it("extends inactivity on a foreground grace retry without extending the reuse grace window", async () => {
  const first = await rotateRefreshToken(original, { activity: true });
  const grace = record.refreshGraceUntil;
  vi.setSystemTime(started.getTime() + 5000);
  const result = await rotateRefreshToken(original, { activity: true });
  expect(result.refreshToken).toBe(first.refreshToken);
  expect(record.refreshGraceUntil).toBe(grace);
  expect(record.expiresAt).toEqual(new Date(Date.now() + 3 * day));
});

it("applies the idle cutoff to old 30-day sessions without reviving already inactive users", async () => {
  record.expiresAt = new Date(started.getTime() + 30 * day);
  expect(sessionExpiry(record)).toEqual(new Date(started.getTime() + 3 * day));
  vi.setSystemTime(started.getTime() + 4 * day);
  await expect(rotateRefreshToken(original, { activity: true })).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  expect(mocks.update).not.toHaveBeenCalled();
});

it("a stale background rotation cannot shorten a concurrent foreground extension", async () => {
  const first = await rotateRefreshToken(original);
  const update = mocks.update.getMockImplementation()!;
  mocks.update.mockImplementationOnce(async (filter, changes) => {
    record.lastUsedAt = new Date(started.getTime() + 1000);
    record.expiresAt = new Date(record.lastUsedAt.getTime() + 3 * day);
    return update(filter, changes);
  });
  await rotateRefreshToken(first.refreshToken);
  expect(record.expiresAt).toEqual(new Date(started.getTime() + 1000 + 3 * day));
});

it("uses a non-secure lax cookie only for local development", () => {
  expect(buildRefreshCookieOptions({
    production: false,
    domain: "localhost",
  })).toMatchObject({
    httpOnly: true,
    secure: false,
    sameSite: "lax",
    domain: "localhost",
    path: "/",
  });
});

// Exercise real Set-Cookie parsing and a persistent HTTP cookie jar, rather
// than passing a refresh token straight into the service under test.
function cookieApp() {
  const app = express();
  app.use(express.json(), cookieParser());
  app.post("/api/v1/auth/login", async (_req, res) => {
    const result = await createSession({ userId: "user", activeRole: "USER" });
    setRefreshCookie(res, result.refreshToken, result.expiresAt);
    res.json({ accessToken: result.accessToken });
  });
  app.post("/api/v1/auth/refresh", async (req, res) => {
    if (!req.cookies.gfu_refresh) { res.status(401).json({ code: "REFRESH_REQUIRED" }); return; }
    try {
      const result = await rotateRefreshToken(req.cookies.gfu_refresh, { activity: req.body.activity === true });
      setRefreshCookie(res, result.refreshToken, result.expiresAt);
      res.json({ accessToken: result.accessToken });
    } catch (error: any) { res.status(error.statusCode || 401).json({ code: error.code }); }
  });
  app.post("/api/v1/auth/logout", (_req, res) => { clearRefreshCookie(res); res.sendStatus(204); });
  app.get("/legacy", (_req, res) => {
    res.cookie("gfu_refresh", "expired-session.stale-secret", { path: "/api/v1/auth", httpOnly: true });
    res.sendStatus(204);
  });
  return app;
}

it("keeps the real cookie jar signed in after one minute, access expiry, and returns on days two and four", async () => {
  mocks.create.mockImplementation(async input => { record = { ...input }; });
  const browser = request.agent(cookieApp());
  const login = await browser.post("/api/v1/auth/login").expect(200);
  const issued = login.headers["set-cookie"].find((value: string) => value.includes("Max-Age="));
  expect(issued).toContain("Max-Age=259200");
  expect(issued).toContain("HttpOnly");
  expect(issued).toContain("Path=/;");
  expect(issued).not.toContain("Secure");
  for (const elapsed of [60_000, 16 * 60_000, 2 * day, 4 * day]) {
    vi.setSystemTime(started.getTime() + elapsed);
    if (elapsed === 16 * 60_000) expect(() => verifyAccessToken(login.body.accessToken)).toThrow();
    const refreshed = await browser.post("/api/v1/auth/refresh").send({ activity: true }).expect(200);
    expect(verifyAccessToken(refreshed.body.accessToken).sid).toBe(record.publicId);
    expect(record.expiresAt).toEqual(new Date(Date.now() + 3 * day));
  }
  vi.setSystemTime(started.getTime() + 7 * day);
  await browser.post("/api/v1/auth/refresh").send({ activity: true }).expect(401);
});

it("replaces a stale auth-path cookie on login and removes both paths on logout", async () => {
  mocks.create.mockImplementation(async input => { record = { ...input }; });
  const browser = request.agent(cookieApp());
  await browser.get("/legacy").expect(204);
  await browser.post("/api/v1/auth/login").expect(200);
  await browser.post("/api/v1/auth/refresh").send({ activity: true }).expect(200);
  await browser.get("/legacy").expect(204);
  await browser.post("/api/v1/auth/logout").expect(204);
  const response = await browser.post("/api/v1/auth/refresh").send({ activity: true }).expect(401);
  expect(response.body.code).toBe("REFRESH_REQUIRED");
});
