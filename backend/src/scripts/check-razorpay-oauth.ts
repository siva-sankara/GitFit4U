import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { requestContext } from "../middleware/requestContext.js";
import { errorHandler } from "../middleware/errorHandler.js";
import { razorpayConnectionRoutes } from "../routes/razorpayConnectionRoutes.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { RoleAssignment } from "../models/Auth.js";
import { PaymentConnection, PaymentOAuthState } from "../models/Business.js";
import { Payment } from "../models/Commerce.js";
import { createSession } from "../services/tokenService.js";
import { decryptPaymentToken } from "../integrations/payments/paymentTokenCrypto.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";

if (!process.argv.includes("--run-isolated")) throw new Error("Use --run-isolated to create and remove a temporary verification database.");
const databaseName = `gfo_${randomUUID().replaceAll("-", "")}`;
const assertDatabase = () => { assert(/^gfo_[a-f0-9]{32}$/.test(databaseName)); assert.equal(mongoose.connection.db?.databaseName, databaseName); };
Object.assign(env, { NODE_ENV: "test", WHATSAPP_MODE: "disabled", RAZORPAY_GYM_OAUTH_ENABLED: true,
  FRONTEND_URL: "https://frontend.example.com", BACKEND_PUBLIC_URL: "https://backend.example.com",
  RAZORPAY_OAUTH_REDIRECT_URI: "https://backend.example.com/api/v1/payments/razorpay/oauth/callback",
  RAZORPAY_MODE: "test", RAZORPAY_OAUTH_CLIENT_ID: "fixture-client", RAZORPAY_OAUTH_CLIENT_SECRET: "fixture-secret",
  RAZORPAY_OAUTH_WEBHOOK_SECRET: "fixture-webhook", PAYMENT_TOKEN_ENCRYPTION_KEY: "a".repeat(64) });
logger.level = "silent";
let exchanges = 0;
// Only the OAuth provider transport is mocked. All state, unique indexes,
// session validation and connection transactions below use the temporary DB.
globalThis.fetch = async (url, init) => {
  if (url !== "https://auth.razorpay.com/token") throw new Error("External transports disabled");
  const body = JSON.parse(String(init?.body));
  assert.equal(body.redirect_uri, env.RAZORPAY_OAUTH_REDIRECT_URI);
  assert.equal(body.mode, "test");
  exchanges++;
  if (body.code === "provider-failure") return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  return new Response(JSON.stringify({ access_token: "fixture-access", refresh_token: "fixture-refresh",
    public_token: "rzp_test_oauth_fixture", razorpay_account_id: "acc_FixtureGym", expires_in: 3600 }), { status: 200 });
};
function server() {
  const app = express();
  app.use(requestContext, express.json(), cookieParser());
  app.use("/api/v1", razorpayConnectionRoutes);
  app.use(errorHandler);
  return app;
}
let ownsDatabase = false;
let stage = "database setup";
const checks: string[] = [];
try {
  await mongoose.connect(env.MONGO_URI, { dbName: databaseName, serverSelectionTimeoutMS: 15000 });
  assertDatabase(); ownsDatabase = true;
  await Promise.all(Object.values(mongoose.models).map(model => model.init()));
  const owner = await User.create({ publicId: nanoid(18), name: "OAuth fixture owner", email: "oauth@verification.invalid", roles: ["GYM_OWNER"], activeRole: "GYM_OWNER", status: "ACTIVE" });
  const gym = await Gym.create({ publicId: nanoid(18), ownerId: owner._id, name: "OAuth fixture gym", slug: nanoid(20), location: { type: "Point", coordinates: [77, 12] }, status: "ACTIVE", verificationStatus: "VERIFIED", platformSubscriptionStatus: "ACTIVE", timezone: "Asia/Kolkata" });
  await RoleAssignment.create({ userId: owner._id, gymId: gym._id, role: "GYM_OWNER", permissions: OWNER_DEFAULT_PERMISSIONS });
  const token = (await createSession({ userId: String(owner._id), activeRole: "GYM_OWNER", activeGymId: String(gym._id) })).accessToken;
  const first = server(), second = server();
  const settings = await request(first).get(`/api/v1/gyms/${gym.publicId}/payments/razorpay/status`).set("authorization", `Bearer ${token}`);
  assert.equal(settings.status, 200);
  assert.equal(settings.body.data.oauthFlowVersion, 2);
  assert.match(settings.headers["cache-control"], /no-store/);
  const startPath = `/api/v1/gyms/${gym.publicId}/payments/razorpay/connect`;
  const callbackPath = "/api/v1/payments/razorpay/oauth/callback";
  const start = (app: ReturnType<typeof server>, key = randomUUID()) => request(app).post(startPath)
    .set("authorization", `Bearer ${token}`).set("Origin", env.FRONTEND_URL!).set("idempotency-key", key).send({ browserApiOrigin: env.FRONTEND_URL });
  const parse = (response: any) => ({ state: new URL(response.body.data.authorizationUrl).searchParams.get("state")!, cookie: response.headers["set-cookie"][0].split(";")[0] });
  stage = "concurrent initiation";
  const key = randomUUID();
  const starts = await Promise.all([start(first, key), start(second, key)]);
  assert.deepEqual(starts.map(value => value.status).sort(), [201, 409]);
  assert.equal(await PaymentOAuthState.countDocuments(), 1);
  checks.push("Mongo unique index deduplicates initiation across server instances");
  const begun = parse(starts.find(value => value.status === 201));
  stage = "callback relay";
  const relayResponse = await request(second).get(callbackPath).query({ state: begun.state, code: "fixture-code" });
  assert.equal(relayResponse.status, 303);
  assert.equal(relayResponse.headers["x-getfit4u-oauth-flow"], "2");
  const relay = new URL(relayResponse.headers.location);
  assert.equal(relay.origin, env.FRONTEND_URL);
  assert.equal(exchanges, 0);
  assert.equal(relayResponse.headers["set-cookie"], undefined);
  checks.push("Backend callback returns to original browser API origin without creating a nonce");
  stage = "concurrent callbacks";
  const callbacks = await Promise.all([first, second].map(app => request(app).get(relay.pathname + relay.search).set("Cookie", begun.cookie)));
  assert(callbacks.every(value => value.status === 303));
  assert.equal(exchanges, 1);
  assert.equal(await PaymentConnection.countDocuments(), 1);
  const connection = await PaymentConnection.findOne({ gymId: gym._id }).select("+accessTokenCiphertext +refreshTokenCiphertext");
  assert.equal(String(connection.authorizedOwnerId), String(owner._id));
  assert.equal(connection.collectionEnabled, false);
  assert.equal(connection.merchantAccountId, "acc_FixtureGym");
  assert.equal(decryptPaymentToken(connection.accessTokenCiphertext, String(connection._id), "access"), "fixture-access");
  const completed = await PaymentOAuthState.findOne({ status: "COMPLETED" });
  assert.equal(String(completed.connectionId), String(connection._id));
  checks.push("Mongo atomic claim exchanges once; encrypted connection and completion commit together");
  stage = "result verification and replay";
  const result = await request(second).get(`/api/v1/payments/razorpay/oauth/attempts/${completed.publicId}`).set("authorization", `Bearer ${token}`);
  assert.equal(result.status, 200); assert.equal(result.body.data.connected, true);
  await request(first).get(relay.pathname + relay.search).set("Cookie", begun.cookie).expect(303);
  assert.equal(exchanges, 1);
  checks.push("Authenticated result verifies the stored gym connection; replay never exchanges again");
  stage = "provider failure";
  const next = parse(await start(second));
  const ciphertext = connection.accessTokenCiphertext;
  await request(first).get(callbackPath).query({ state: next.state, code: "provider-failure" }).set("Cookie", next.cookie).expect(303);
  assert.equal((await PaymentConnection.findById(connection._id).select("+accessTokenCiphertext")).accessTokenCiphertext, ciphertext);
  assert.equal(await PaymentOAuthState.countDocuments({ status: "FAILED" }), 1);
  checks.push("Failed token exchange preserves the existing encrypted merchant connection");
  stage = "verified reconnection";
  const reconnect = parse(await start(first));
  await request(second).get(callbackPath).query({ state: reconnect.state, code: "reconnect-code" }).set("Cookie", reconnect.cookie).expect(303);
  const reconnected = await PaymentConnection.findById(connection._id).select("+accessTokenCiphertext");
  assert.equal(reconnected.connectionRevision, connection.connectionRevision + 1);
  assert.equal(reconnected.documentVersion, connection.documentVersion + 1);
  assert.equal(await PaymentConnection.countDocuments(), 1);
  assert.equal(await PaymentOAuthState.countDocuments({ status: "COMPLETED" }), 2);
  checks.push("A fresh authorized reconnection updates the same gym connection atomically");
  stage = "authorization and payment isolation";
  await request(first).post(startPath).send({}).expect(401);
  await request(first).get(callbackPath).expect(303);
  assert.equal(await Payment.countDocuments(), 0);
  checks.push("Unauthenticated initiation is denied and no payment records are created");
  console.log(JSON.stringify({ passed: checks.length, checks, provider: "mocked", database: "isolated" }, null, 2));
} catch (error: any) {
  console.error(JSON.stringify({ failedStage: stage, errorType: error?.name || "Error", code: typeof error?.code === "string" && /^[A-Z_]+$/.test(error.code) ? error.code : undefined }));
  process.exitCode = 1;
} finally {
  if (ownsDatabase) { assertDatabase(); await mongoose.connection.dropDatabase(); }
  await mongoose.disconnect();
}
