import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import mongoose from "mongoose";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ create: vi.fn(), find: vi.fn(), claim: vi.fn(), update: vi.fn(),
  connectionFind: vi.fn(), connectionSave: vi.fn(), gym: vi.fn(), user: vi.fn(), session: vi.fn(), assignment: vi.fn(),
  exchange: vi.fn(), revoke: vi.fn(), logger: vi.fn(), constructed: [] as any[] }));
vi.mock("../config/env.js", () => ({ env: {
  NODE_ENV: "test", FRONTEND_URL: "https://www.getfit4u.in", BACKEND_PUBLIC_URL: "https://backend.example.com",
  CLIENT_ORIGIN: "https://www.getfit4u.in", RAZORPAY_MODE: "test", JWT_REFRESH_TTL: "3d",
  RAZORPAY_GYM_OAUTH_ENABLED: true, RAZORPAY_OAUTH_CLIENT_ID: "test-client", RAZORPAY_OAUTH_CLIENT_SECRET: "test-secret",
  RAZORPAY_OAUTH_WEBHOOK_SECRET: "test-webhook", RAZORPAY_OAUTH_REDIRECT_URI: "https://backend.example.com/api/v1/payments/razorpay/oauth/callback",
  PAYMENT_TOKEN_ENCRYPTION_KEY: "a".repeat(64), PAYMENT_TOKEN_ENCRYPTION_KEY_VERSION: 1,
} }));
vi.mock("../config/logger.js", () => ({ logger: { info: mocks.logger } }));
vi.mock("../models/Business.js", () => ({
  PaymentOAuthState: { create: mocks.create, findOne: mocks.find, findOneAndUpdate: mocks.claim, updateOne: mocks.update },
  PaymentConnection: class {
    static findOne = mocks.connectionFind;
    _id = "connection-id";
    connectionRevision = 1;
    constructor(value: any) { Object.assign(this, value); mocks.constructed.push(this); }
    save(options: any) { return mocks.connectionSave(this, options); }
  },
}));
vi.mock("../models/Gym.js", () => ({ Gym: { findOne: mocks.gym } }));
vi.mock("../models/User.js", () => ({ User: { findById: mocks.user } }));
vi.mock("../models/Auth.js", () => ({ Session: { findOne: mocks.session }, RoleAssignment: { findOne: mocks.assignment } }));
vi.mock("../integrations/payments/razorpayOAuthProvider.js", async importOriginal => ({
  ...await importOriginal<any>(), exchangeRazorpayAuthorizationCode: mocks.exchange, revokeRazorpayOAuthToken: mocks.revoke,
}));
import { env } from "../config/env.js";
import { beginGymRazorpayConnection, completeGymRazorpayConnection, gymRazorpayAttempt } from "./razorpayOAuthFlow.js";
import { decryptPaymentToken } from "../integrations/payments/paymentTokenCrypto.js";
import { sha256 } from "../utils/crypto.js";
import { AppError } from "../utils/AppError.js";

const callback = "/api/v1/payments/razorpay/oauth/callback";
const states = new Map<string, any>();
const auth = { userId: "owner-id", gymId: "gym-id", sessionId: "session-id", role: "GYM_OWNER", permissions: ["gym:update"] };
const gym = { _id: "gym-id", publicId: "gym-public", ownerId: "owner-id", name: "Test gym", contact: { email: "gym@example.com" } };
const query = (value: any) => ({ lean: () => Promise.resolve(value), select: () => Promise.resolve(value), session: () => Promise.resolve(value) });
function app(context: any = auth) {
  const server = express();
  server.use(express.json(), cookieParser());
  server.use((req, _res, next) => { req.auth = context; req.idempotencyKey = req.get("idempotency-key"); req.requestId = "request-test-123"; next(); });
  server.post("/connect/:gymId", beginGymRazorpayConnection);
  server.get(callback, completeGymRazorpayConnection);
  server.get("/attempts/:reference", gymRazorpayAttempt);
  server.use((error: any, _req: any, res: any, _next: any) => res.status(error.statusCode || 500).json({ code: error.code }));
  return server;
}
async function initiate(server = app(), key = "request-key-123") {
  const response = await request(server).post("/connect/gym-public").set("Origin", env.FRONTEND_URL!)
    .set("Idempotency-Key", key).send({ browserApiOrigin: env.FRONTEND_URL });
  expect(response.status).toBe(201);
  const url = new URL(response.body.data.authorizationUrl);
  const state = url.searchParams.get("state")!;
  const cookie = response.headers["set-cookie"][0].split(";")[0];
  return { state, cookie, attempt: states.get(sha256(state)), response };
}
const reason = () => mocks.logger.mock.calls.at(-1)?.[0].reason;

beforeEach(() => {
  vi.clearAllMocks(); states.clear(); mocks.constructed.length = 0;
  env.RAZORPAY_MODE = "test";
  env.FRONTEND_URL = "https://www.getfit4u.in";
  env.RAZORPAY_OAUTH_CLIENT_ID = "test-client";
  env.RAZORPAY_OAUTH_REDIRECT_URI = `https://backend.example.com${callback}`;
  mocks.create.mockImplementation(async value => {
    if ([...states.values()].some(a => a.initiationKeyHash === value.initiationKeyHash)) throw { code: 11000 };
    const attempt = { _id: `attempt-${states.size}`, status: "PENDING", createdAt: new Date(), ...value };
    states.set(value.stateHash, attempt); return attempt;
  });
  mocks.find.mockImplementation(filter => query(filter.stateHash ? states.get(filter.stateHash) : [...states.values()].find(a =>
    a.publicId === filter.publicId && a.ownerId === filter.ownerId && a.gymId === filter.gymId && a.sessionId === filter.sessionId && a.environment === filter.environment)));
  mocks.claim.mockImplementation(async (filter, update) => {
    const attempt = [...states.values()].find(a => a._id === filter._id && a.status === filter.status && !a.consumedAt && a.expiresAt > filter.expiresAt.$gt);
    if (!attempt) return null;
    Object.assign(attempt, update.$set); return attempt;
  });
  mocks.update.mockImplementation(async (filter, update) => {
    const attempt = [...states.values()].find(a => a._id === filter._id && (typeof filter.status === "string" ? a.status === filter.status : filter.status.$in.includes(a.status)));
    if (!attempt) return { matchedCount: 0 };
    Object.assign(attempt, update.$set); return { matchedCount: 1 };
  });
  mocks.gym.mockImplementation(filter => query(filter.ownerId === "owner-id" && filter._id === "gym-id" ? gym : null));
  mocks.user.mockReturnValue(query({ _id: "owner-id", status: "ACTIVE", roles: ["GYM_OWNER"] }));
  mocks.assignment.mockReturnValue(query({ permissions: ["gym:update"] }));
  mocks.session.mockResolvedValue({ activeRole: "GYM_OWNER", activeGymId: "gym-id", expiresAt: new Date(Date.now() + 86400000), lastUsedAt: new Date() });
  mocks.connectionFind.mockReturnValue(query(null));
  mocks.connectionSave.mockResolvedValue(undefined);
  mocks.exchange.mockResolvedValue({ access_token: "issued-access-secret", refresh_token: "issued-refresh-secret", public_token: "rzp_test_oauth_public",
    razorpay_account_id: "acc_TestGym", expires_in: 3600 });
  mocks.revoke.mockResolvedValue({});
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (fn: any) => fn({ mockTransaction: true }));
});
afterEach(() => vi.restoreAllMocks());

describe("shared Mongo OAuth transaction and browser binding", () => {
  it("connects only the initiating gym across two server instances and stores encrypted tokens atomically", async () => {
    const first = app(), second = app();
    const { state, cookie, attempt, response } = await initiate(first);
    expect(response.headers["set-cookie"][0]).toMatch(/HttpOnly/);
    expect(response.headers["set-cookie"][0]).toMatch(/Secure/);
    expect(response.headers["set-cookie"][0]).toMatch(/SameSite=Lax/);
    expect(response.headers["set-cookie"][0]).not.toContain("Domain=");
    expect(attempt.stateHash).toBe(sha256(state));
    expect(JSON.stringify(attempt)).not.toContain(state);
    const done = await request(second).get(callback).query({ state, code: "provider-code" }).set("Cookie", cookie);
    expect(done.status).toBe(303);
    expect(new URL(done.headers.location).searchParams.get("status")).toBe("connected");
    expect(attempt.status).toBe("COMPLETED");
    const connection = mocks.constructed[0];
    expect(connection.gymId).toBe("gym-id");
    expect(connection.authorizedOwnerId).toBe("owner-id");
    expect(connection.collectionEnabled).toBe(false);
    expect(decryptPaymentToken(connection.accessTokenCiphertext, connection._id, "access")).toBe("issued-access-secret");
    expect(decryptPaymentToken(connection.refreshTokenCiphertext, connection._id, "refresh")).toBe("issued-refresh-secret");
    expect(mocks.connectionSave).toHaveBeenCalledTimes(1);
    expect(mocks.connectionSave.mock.calls[0][1]).toEqual({ session: { mockTransaction: true } });
  });

  it("relays a standalone-backend callback to the initiating proxy without minting a new browser cookie", async () => {
    const { state, cookie } = await initiate();
    const first = await request(app()).get(callback).query({ state, code: "code-with+literal" });
    const relay = new URL(first.headers.location);
    expect(relay.origin).toBe("https://www.getfit4u.in");
    expect(relay.pathname).toBe(callback);
    expect(relay.searchParams.get("code")).toBe("code-with+literal");
    expect(relay.searchParams.get("gfu_return")).toBe("1");
    expect(first.headers["set-cookie"]).toBeUndefined();
    expect(first.headers["referrer-policy"]).toBe("no-referrer");
    expect(first.headers["x-getfit4u-oauth-flow"]).toBe("2");
    expect(mocks.exchange).not.toHaveBeenCalled();
    await request(app()).get(relay.pathname + relay.search).set("Cookie", cookie).expect(303);
    expect(mocks.exchange).toHaveBeenCalledExactlyOnceWith("code-with+literal");
  });

  it("fails closed after one relay if the original browser cookie is still missing", async () => {
    const { state } = await initiate();
    const res = await request(app()).get(callback).query({ state, code: "code", gfu_return: "1" });
    expect(new URL(res.headers.location).pathname).toBe("/razorpay-connection-result");
    expect(reason()).toBe("browser_binding_failed");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });

  it.each([
    [undefined, "missing_state"], ["short", "malformed_state"], ["A".repeat(43), "attempt_not_found"],
  ])("rejects state %s without token exchange", async (state, expected) => {
    await request(app()).get(callback).query(state === undefined ? {} : { state }).expect(303);
    expect(reason()).toBe(expected);
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("rejects duplicate query parameters rather than coercing them into a state", async () => {
    await request(app()).get(`${callback}?state=a&state=b`).expect(303);
    expect(reason()).toBe("malformed_state");
  });
  it("enforces expiry even while the expired record still exists in Mongo", async () => {
    const { state, cookie, attempt } = await initiate();
    attempt.expiresAt = new Date(Date.now() - 1);
    await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(reason()).toBe("expired_state");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("rejects another browser's nonce", async () => {
    const first = await initiate(app(), "first-request");
    const second = await initiate(app(), "second-request");
    const forged = first.cookie.split("=")[0] + "=" + second.cookie.split("=")[1];
    await request(app()).get(callback).query({ state: first.state, code: "code" }).set("Cookie", forged);
    expect(reason()).toBe("browser_binding_failed");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("does not overwrite another tab's cookie", async () => {
    const first = await initiate(app(), "first-request");
    const second = await initiate(app(), "second-request");
    expect(first.cookie.split("=")[0]).not.toBe(second.cookie.split("=")[0]);
  });
  it("deduplicates repeated initiation keys in shared storage", async () => {
    await initiate();
    const duplicate = await request(app()).post("/connect/gym-public").set("Origin", env.FRONTEND_URL!).set("Idempotency-Key", "request-key-123").send({});
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.code).toBe("RAZORPAY_OAUTH_ATTEMPT_EXISTS");
    expect(duplicate.headers["set-cookie"]).toBeUndefined();
    expect(states.size).toBe(1);
  });
  it("atomically claims concurrent duplicate callbacks and never exchanges a replay", async () => {
    const { state, cookie } = await initiate();
    await Promise.all([app(), app()].map(server => request(server).get(callback).query({ state, code: "code" }).set("Cookie", cookie)));
    await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(mocks.exchange).toHaveBeenCalledTimes(1);
    expect(mocks.connectionSave).toHaveBeenCalledTimes(1);
    expect(reason()).toBe("attempt_already_processed");
  });
  it.each(["owner", "gym", "permission"])("rejects unauthorized %s initiation", async kind => {
    const context = { ...auth, ...(kind === "owner" ? { userId: "other-owner" } : kind === "gym" ? { gymId: "other-gym" } : { permissions: [] }) };
    await request(app(context)).post("/connect/gym-public").set("Origin", env.FRONTEND_URL!).set("Idempotency-Key", "request-key").send({}).expect(403);
    expect(states.size).toBe(0);
  });
  it("rejects untrusted browser API origins before persisting an attempt", async () => {
    await request(app()).post("/connect/gym-public").set("Origin", env.FRONTEND_URL!).set("Idempotency-Key", "request-key").send({ browserApiOrigin: "https://attacker.example" }).expect(409);
    expect(states.size).toBe(0);
  });
  it("rejects localhost initiation with a deployed callback before creating state", async () => {
    env.FRONTEND_URL = "http://localhost:5173";
    const res = await request(app()).post("/connect/gym-public").set("Origin", env.FRONTEND_URL).set("Idempotency-Key", "request-key").send({ browserApiOrigin: env.FRONTEND_URL });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("RAZORPAY_OAUTH_ENVIRONMENT_MISMATCH");
    expect(states.size).toBe(0);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });
  it("permits a consistently local setup with a host-only non-Secure cookie", async () => {
    env.FRONTEND_URL = "http://localhost:5173";
    env.RAZORPAY_OAUTH_REDIRECT_URI = `${env.FRONTEND_URL}${callback}`;
    const { response } = await initiate();
    expect(response.headers["set-cookie"][0]).not.toContain("Secure");
    expect(response.body.data.oauthFlowVersion).toBe(2);
  });
  it("rejects a switched or revoked initiating session", async () => {
    const { state, cookie } = await initiate();
    mocks.session.mockResolvedValue(null);
    await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(reason()).toBe("owner_context_changed");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it.each(["client", "environment", "redirect"])("binds the attempt to its OAuth %s", async kind => {
    const { state, cookie } = await initiate();
    if (kind === "client") env.RAZORPAY_OAUTH_CLIENT_ID = "different-client";
    if (kind === "environment") env.RAZORPAY_MODE = "live";
    if (kind === "redirect") env.RAZORPAY_OAUTH_REDIRECT_URI = `https://www.getfit4u.in${callback}`;
    await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(reason()).toBe("configuration_binding_failed");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("handles denial and permits a new attempt", async () => {
    const { state, cookie, attempt } = await initiate();
    await request(app()).get(callback).query({ state, error: "access_denied" }).set("Cookie", cookie);
    expect(attempt.status).toBe("DENIED");
    expect(mocks.exchange).not.toHaveBeenCalled();
    await initiate(app(), "fresh-after-denial");
  });
  it("handles failed token exchange without altering existing connections", async () => {
    const { state, cookie, attempt } = await initiate();
    mocks.exchange.mockRejectedValue(new AppError(409, "PROVIDER_ERROR", "provider private details"));
    const res = await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(attempt.status).toBe("FAILED");
    expect(res.headers.location).not.toContain("private");
    expect(mocks.connectionSave).not.toHaveBeenCalled();
    await initiate(app(), "fresh-after-failure");
  });
  it("never overwrites a connection changed since initiation", async () => {
    const { state, cookie } = await initiate();
    mocks.connectionFind.mockImplementation(filter => query(filter.merchantAccountId ? null : { _id: "newer-connection", connectionRevision: 2 }));
    await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(mocks.connectionSave).not.toHaveBeenCalled();
    expect(reason()).toBe("connection_failed");
  });
  it("does not undo a disconnect or admin update that kept the same connection revision", async () => {
    const existing = { _id: "existing-connection", connectionRevision: 1, documentVersion: 2 };
    mocks.connectionFind.mockReturnValue(query(existing));
    const { state, cookie } = await initiate();
    mocks.connectionFind.mockImplementation(filter => query(filter.merchantAccountId ? null : { ...existing, documentVersion: 3 }));
    await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(mocks.connectionSave).not.toHaveBeenCalled();
    expect(reason()).toBe("connection_failed");
  });
  it("rejects a gym suspended during consent before exchanging the code", async () => {
    const { state, cookie } = await initiate();
    mocks.gym.mockReturnValue(query({ ...gym, status: "SUSPENDED" }));
    await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(reason()).toBe("owner_context_changed");
    expect(mocks.exchange).not.toHaveBeenCalled();
  });
  it("does not report success or revoke possibly persisted tokens after an uncertain commit", async () => {
    const { state, cookie, attempt } = await initiate();
    vi.mocked(mongoose.connection.transaction).mockRejectedValue(new Error("unknown commit result"));
    const res = await request(app()).get(callback).query({ state, code: "code" }).set("Cookie", cookie);
    expect(attempt.status).toBe("PROCESSING");
    expect(new URL(res.headers.location).searchParams.get("status")).toBe("processing");
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("does not expose another owner's attempt or trust a claimed success", async () => {
    const { attempt } = await initiate();
    await request(app({ ...auth, userId: "different-owner" })).get(`/attempts/${attempt.publicId}`).expect(404);
    const pending = await request(app()).get(`/attempts/${attempt.publicId}`).expect(200);
    expect(pending.body.data.connected).toBe(false);
  });
  it("logs safe reasons and request IDs without state, code or token values", async () => {
    const { state, cookie } = await initiate();
    await request(app()).get(callback).query({ state, code: "private-authorization-code" }).set("Cookie", cookie);
    const logs = JSON.stringify(mocks.logger.mock.calls);
    for (const value of [state, cookie.split("=")[1], "private-authorization-code", "issued-access-secret", "issued-refresh-secret", "test-secret"])
      expect(logs).not.toContain(value);
    expect(logs).toContain("request-test-123");
  });
  it("does not present a test-environment attempt as a live connection", async () => {
    const { attempt } = await initiate();
    env.RAZORPAY_MODE = "live";
    await request(app()).get(`/attempts/${attempt.publicId}`).expect(404);
  });
});
