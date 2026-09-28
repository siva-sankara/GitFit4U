import { beforeEach, expect, it, vi } from "vitest";
import { sha256 } from "../utils/crypto.js";

const mocks = vi.hoisted(() => ({ find: vi.fn(), update: vi.fn(), revoke: vi.fn(), active: vi.fn() }));
vi.mock("../models/Auth.js", () => ({ Session: { findOne: mocks.find, findOneAndUpdate: mocks.update, updateMany: mocks.revoke } }));
vi.mock("../models/User.js", () => ({ User: { exists: mocks.active } }));
vi.mock("../config/env.js", () => ({ env: { JWT_ACCESS_SECRET: "isolated-test-access-secret-not-production", JWT_REFRESH_SECRET: "isolated-test-refresh-secret-not-production", JWT_ACCESS_TTL: "15m", JWT_REFRESH_TTL: "30d" }, isProduction: false }));
import { rotateRefreshToken } from "./tokenService.js";

const original = "test-session.original-test-secret";
let record: any;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.active.mockResolvedValue({ _id: "user" });
  record = { publicId: "test-session", userId: "user", tokenFamily: "family", refreshTokenHash: sha256(original), expiresAt: new Date(Date.now() + 60_000) };
  mocks.find.mockImplementation(() => ({ select: async () => {
    const snapshot = { ...record };
    return { ...snapshot, save: async function () { Object.assign(record, this); } };
  } }));
  mocks.update.mockImplementation(async (filter, update) => {
    if (record.revokedAt || record.expiresAt <= new Date() || filter.refreshTokenHash !== record.refreshTokenHash) return null;
    Object.assign(record, update.$set);
    return { ...record };
  });
  mocks.revoke.mockImplementation(async () => { record.revokedAt = new Date(); });
});

it("converges simultaneous refreshes on one cookie instead of revoking the losing tab", async () => {
  const [first, second] = await Promise.all([rotateRefreshToken(original), rotateRefreshToken(original)]);
  expect(first.refreshToken).toBe(second.refreshToken);
  expect(record.refreshTokenHash).toBe(sha256(first.refreshToken));
  await expect(rotateRefreshToken(first.refreshToken)).resolves.toMatchObject({ refreshToken: first.refreshToken });
  expect(mocks.revoke).not.toHaveBeenCalled();
});

it("converges current and previous-cookie retries without extending grace or absolute expiry", async () => {
  const first = await rotateRefreshToken(original);
  const grace = record.refreshGraceUntil;
  const expiry = record.expiresAt;
  const result = await Promise.all([rotateRefreshToken(original), rotateRefreshToken(first.refreshToken)]);
  expect(result.map(value => value.refreshToken)).toEqual([first.refreshToken, first.refreshToken]);
  expect(record.refreshGraceUntil).toBe(grace);
  expect(record.expiresAt).toBe(expiry);
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
