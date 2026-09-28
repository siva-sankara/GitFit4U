import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { isolatedScriptDatabase } from "./isolatedScriptDatabase.js";
Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  RAZORPAY_KEY_ID: "rzp_test_isolated",
  RAZORPAY_KEY_SECRET: "isolated-checkout-secret",
  RAZORPAY_WEBHOOK_SECRET: "isolated-registration-webhook",
});
for (const key of ["MSG91_AUTH_KEY", "MSG91_TEMPLATE_ID",
  "RESEND_API_KEY", "EMAIL_FROM", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID",
  "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "LOCATIONIQ_API_KEY",
  "OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_ACCESS_KEY", "OBJECT_STORAGE_SECRET_KEY", "OBJECT_STORAGE_SESSION_TOKEN",
  "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_S3_BUCKET_NAME",
  "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "CLOUDINARY_CLOUD_NAME",
])
  delete process.env[key];
// Exercise disabled document-upload routing without loading real S3 credentials.
// This suite does not upload bytes or contact this reserved .invalid endpoint.
Object.assign(process.env, {
  OBJECT_STORAGE_ENDPOINT: "https://storage.invalid",
  OBJECT_STORAGE_ACCESS_KEY: "isolated-test-access",
  OBJECT_STORAGE_SECRET_KEY: "isolated-test-secret",
});
const { app } = await import("../app.js");
const { User } = await import("../models/User.js");
const { Gym } = await import("../models/Gym.js");
const { GymRegistration } = await import("../models/GymRegistration.js");
const { Payment, Subscription, ProviderEvent } =
  await import("../models/Commerce.js");
const { createSession } = await import("../services/tokenService.js");
const { paymentProvider } = await import("../integrations/payments/index.js");
const { migratePaymentRegistrations } =
  await import("../services/registrationMigrationService.js");
const testDatabase = isolatedScriptDatabase("gfr");
const { databaseName } = testDatabase;
let checks = 0,
  orders = 0,
  failOrder = false;
let fetched: Record<string, unknown> = {};
paymentProvider.createPayment = async (input: any) => {
  if (failOrder) throw new Error("Simulated gateway outage");
  orders++;
  return {
    id: `order_test_${orders}`,
    amount: input.amountMinor,
    currency: input.currency,
    status: "created",
  } as any;
};
let gatewayChecks = 0;
paymentProvider.getPaymentStatus = async () => {
  gatewayChecks++;
  return fetched;
};
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks++;
};
async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  status = 200,
) {
  const agent = request(app) as any;
  let r = agent[method]("/api/v1" + path)
    .set("idempotency-key", crypto.randomUUID())
    .set("x-csrf-protection", "1");
  if (token) r = r.auth(token, { type: "bearer" });
  if (body !== undefined) r = r.send(body);
  const result = await r;
  assert.equal(
    result.status,
    status,
    `${method} ${path}: ${JSON.stringify(result.body.error || {})}`,
  );
  checks++;
  return result.body;
}
async function webhook(
  event: string,
  entity: any,
  key = crypto.randomUUID(),
  expected = 200,
  valid = true,
) {
  const raw = JSON.stringify({ event, payload: { payment: { entity } } });
  const signature = valid
    ? createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
        .update(raw)
        .digest("hex")
    : "0".repeat(64);
  const r = await request(app)
    .post("/api/v1/webhooks/razorpay")
    .set("content-type", "application/json")
    .set("x-razorpay-signature", signature)
    .set("x-razorpay-event-id", key)
    .send(raw);
  assert.equal(r.status, expected, JSON.stringify(r.body));
  checks++;
  return r;
}
const details = {
  name: "Payment Flow Gym",
  coordinates: [78.34, 17.46],
  contact: { phone: "9876501234", email: "gym@example.test" },
  address: {
    line1: "12 Test Street",
    city: "Hyderabad",
    state: "Telangana",
    postalCode: "500001",
    country: "IN",
  },
};
try {
  await mongoose.connect(process.env.MONGO_URI!, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 15000,
    autoCreate: false,
    autoIndex: false,
  });
  await testDatabase.initialize();
  const owner = await call("post", "/auth/register", undefined, {
    name: "Gym applicant",
    email: "owner@registration.example",
    phone: "9876501201",
    role: "GYM_OWNER",
    password: "RegistrationPass123",
  });
  const token = owner.data.accessToken;
  const other = await call("post", "/auth/register", undefined, {
    name: "Other applicant",
    email: "other@registration.example",
    phone: "9876501202",
    role: "GYM_OWNER",
    password: "RegistrationPass123",
  });
  const admin = await User.create({
    publicId: "registration-admin",
    roles: ["ADMIN"],
    activeRole: "ADMIN",
    status: "ACTIVE",
  });
  const adminToken = (
    await createSession({ userId: String(admin._id), activeRole: "ADMIN" })
  ).accessToken;
  const plan = (
    await call(
      "post",
      "/admin/platform-plans",
      adminToken,
      {
        code: "REG",
        name: "Registration plan",
        billingPeriod: "MONTHLY",
        priceMinor: 10000,
        active: true,
      },
      201,
    )
  ).data;
  await call(
    "post",
    "/admin/platform-plans",
    adminToken,
    {
      code: "FREE",
      name: "Invalid plan",
      billingPeriod: "MONTHLY",
      priceMinor: 0,
    },
    422,
  );
  check(
    (await call("get", "/workspace/platform-plans", token)).data[0]
      .priceMinor === 10000,
    "Owners get admin-configured prices",
  );
  await call("post", "/owner/registrations", undefined, details, 401);
  await call(
    "post",
    "/owner/registrations",
    token,
    { ...details, coordinates: [200, 91] },
    422,
  );
  const creationKey = crypto.randomUUID();
  const created = await Promise.all([
    request(app)
      .post("/api/v1/owner/registrations")
      .auth(token, { type: "bearer" })
      .set("idempotency-key", creationKey)
      .send(details),
    request(app)
      .post("/api/v1/owner/registrations")
      .auth(token, { type: "bearer" })
      .set("idempotency-key", creationKey)
      .send(details),
  ]);
  check(
    created
      .map((r) => r.status)
      .sort()
      .join(",") === "200,201",
    "Concurrent creation creates exactly one registration",
  );
  const registration = created[0].body.data.registration,
    gym = created[0].body.data.gym;
  check(
    created[1].body.data.registration.publicId === registration.publicId &&
      (await Gym.countDocuments({ ownerId: gym.ownerId })) === 1,
    "No duplicate gym or registration",
  );
  async function hidden(target = gym) {
    check(
      !(
        await call("get", "/public/gyms?q=" + encodeURIComponent(target.name))
      ).data.some((g: any) => g.publicId === target.publicId),
      "Unpaid gym excluded from listing",
    );
    check(
      !(await call("get", "/public/gyms/nearby?lat=17.46&lng=78.34")).data.some(
        (g: any) => g.publicId === target.publicId,
      ),
      "Unpaid gym excluded from nearby search",
    );
    await call("get", "/public/gyms/" + target.slug, undefined, undefined, 404);
  }
  await hidden();
  await call(
    "post",
    `/admin/registrations/${registration.publicId}/review`,
    adminToken,
    { decision: "APPROVED", notes: "Obsolete" },
    404,
  );
  await call(
    "post",
    `/admin/gyms/${gym.publicId}/activate`,
    adminToken,
    { reason: "Cannot bypass payment" },
    409,
  );
  await call(
    "post",
    "/uploads",
    token,
    {
      registrationId: registration.publicId,
      name: "proof.pdf",
      mimeType: "application/pdf",
      size: 20,
      purpose: "DOCUMENT",
    },
    410,
  );
  await call(
    "patch",
    `/owner/registrations/${registration.publicId}`,
    other.data.accessToken,
    { gym: { name: "Tampered" } },
    404,
  );
  await call(
    "post",
    "/checkout/platform/quotes",
    other.data.accessToken,
    { registrationId: registration.publicId, planId: plan._id },
    409,
  );
  await call("patch", `/owner/registrations/${registration.publicId}`, token, {
    gym: { address: { line1: "Updated street" } },
  });
  const saved = (
    await call("get", `/owner/registrations/${registration.publicId}`, token)
  ).data;
  check(
    saved.gymId.address.state === "Telangana",
    "Partial profile edits preserve unrelated fields",
  );
  check(
    (
      await call(
        "post",
        `/owner/registrations/${registration.publicId}/submit`,
        token,
        {},
      )
    ).data.status === "DRAFT",
    "No document or approval required to select a plan",
  );
  await call("post", "/checkout/platform/quotes", token, {
    registrationId: registration.publicId,
    planId: plan._id,
    priceMinor: 1,
  }, 422);
  const quote = (
    await call(
      "post",
      "/checkout/platform/quotes",
      token,
      {
        registrationId: registration.publicId,
        planId: plan._id,
      },
      201,
    )
  ).data;
  check(quote.totalMinor === 10000, "Price always comes from backend plan");
  failOrder = true;
  await call(
    "post",
    "/checkout/platform/orders",
    token,
    { quoteId: quote.publicId },
    500,
  );
  check(
    (await GymRegistration.findById(registration._id))!.status ===
      "PAYMENT_FAILED",
    "Gateway order failure is retryable",
  );
  failOrder = false;
  const order = (
    await call(
      "post",
      "/checkout/platform/orders",
      token,
      { quoteId: quote.publicId, amountMinor: 1 },
      201,
    )
  ).data;
  check(
    order.amountMinor === 10000 && orders === 1,
    "Gateway receives server price",
  );
  await call(
    "patch",
    `/owner/registrations/${registration.publicId}`,
    token,
    { gym: { name: "Edit during payment" } },
    409,
  );
  check(
    (
      await call(
        "post",
        "/checkout/platform/orders",
        token,
        { quoteId: quote.publicId },
        201,
      )
    ).data.providerOrderId === order.providerOrderId,
    "Duplicate order requests reuse the gateway order",
  );
  const entity = {
    id: "pay_test_one",
    order_id: order.providerOrderId,
    amount: 10000,
    currency: "INR",
    status: "captured",
    method: "upi",
  };
  await webhook("payment.captured", entity, undefined, 401, false);
  await webhook("payment.captured", { ...entity, amount: 1 }, undefined, 503);
  await webhook(
    "payment.captured",
    { ...entity, currency: "USD" },
    undefined,
    503,
  );
  await hidden();
  await webhook("payment.failed", {
    ...entity,
    status: "failed",
    error_description: "Declined",
  });
  check(
    (await GymRegistration.findById(registration._id))!.status ===
      "PAYMENT_FAILED",
    "Verified failure leaves a retryable registration",
  );
  await hidden();
  const retryQuote = (
    await call(
      "post",
      "/checkout/platform/quotes",
      token,
      { registrationId: registration.publicId, planId: plan._id },
      201,
    )
  ).data;
  check(
    retryQuote.publicId === quote.publicId,
    "Retry retains the quoted plan and price",
  );
  check(
    (
      await call(
        "post",
        "/checkout/platform/orders",
        token,
        { quoteId: retryQuote.publicId },
        201,
      )
    ).data.paymentId === order.paymentId,
    "Failed attempts reuse the same payment order",
  );
  await call(
    "post",
    `/checkout/payments/${order.paymentId}/cancel`,
    other.data.accessToken,
    {},
    404,
  );
  await call("post", `/checkout/payments/${order.paymentId}/cancel`, token, {});
  check(
    (await GymRegistration.findById(registration._id))!.status ===
      "PAYMENT_CANCELLED",
    "Closed checkout remains inactive and retryable",
  );
  await hidden();
  await call(
    "post",
    "/checkout/platform/orders",
    token,
    { quoteId: retryQuote.publicId },
    201,
  );
  const signature = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET!)
    .update(`${order.providerOrderId}|${entity.id}`)
    .digest("hex");
  const verify = {
    paymentId: order.paymentId,
    providerOrderId: order.providerOrderId,
    providerPaymentId: entity.id,
    signature,
  };
  await call(
    "post",
    "/checkout/verify",
    token,
    { ...verify, signature: "0".repeat(64) },
    401,
  );
  fetched = { ...entity, order_id: "order_unrelated" };
  await call("post", "/checkout/verify", token, verify, 409);
  fetched = { ...entity, status: "authorized" };
  check(
    (await call("post", "/checkout/verify", token, verify)).data.status !==
      "CAPTURED",
    "A signed frontend callback without gateway capture does not activate",
  );
  await hidden();
  const statusPath = `/checkout/payments/${order.paymentId}`;
  const beforeUnauthorized = gatewayChecks;
  await call("get", statusPath, other.data.accessToken, undefined, 404);
  check(
    gatewayChecks === beforeUnauthorized,
    "Other owners cannot trigger gateway reconciliation",
  );
  fetched = { ...entity, amount: 1 };
  await call("get", statusPath, token, undefined, 409);
  await hidden();
  fetched = { ...entity, status: "authorized" };
  await Payment.updateOne(
    { publicId: order.paymentId },
    { $unset: { lastGatewayCheckAt: 1 } },
  );
  await call("get", statusPath, token);
  const beforeCooldown = gatewayChecks;
  await call("get", statusPath, token);
  check(
    gatewayChecks === beforeCooldown,
    "Status polling respects the gateway cooldown",
  );
  fetched = entity;
  await Payment.updateOne(
    { publicId: order.paymentId },
    { $unset: { lastGatewayCheckAt: 1 } },
  );
  check(
    (await call("get", statusPath, token)).data.status === "CAPTURED",
    "Status polling recovers delayed capture without another callback or webhook",
  );
  const afterCapture = gatewayChecks;
  const replay = await request(app).post("/api/v1/owner/registrations")
    .auth(token, { type: "bearer" }).set("idempotency-key", creationKey).send(details);
  check(replay.status === 200 && replay.body.data.registration.publicId === registration.publicId,
    "A creation retry after payment activation reuses the original gym");
  check((await Gym.countDocuments({ ownerId: gym.ownerId })) === 1,
    "An activated registration is not duplicated by a lost-response retry");
  check((await call("get", "/auth/me", token)).data.user.onboarding.state === "ACTIVE",
    "Fresh account state observes completed owner onboarding");
  await call("post", "/checkout/verify", token, verify);
  check(
    gatewayChecks === afterCapture,
    "Duplicate verified callback needs no additional gateway call",
  );
  const activated = await Gym.findById(gym._id);
  check(
    activated!.status === "ACTIVE" &&
      activated!.verificationStatus === "UNVERIFIED" &&
      activated!.profileCompleteness === 25,
    "Verified payment alone activates without approval or fake profile completeness",
  );
  check(
    (await GymRegistration.findById(registration._id))!.status === "ACTIVE",
    "Registration becomes active atomically",
  );
  check(
    (await call("get", "/public/gyms?q=Payment%20Flow")).data.some(
      (g: any) => g.publicId === gym.publicId,
    ),
    "Captured payment publishes gym in listings",
  );
  check(
    (await call("get", "/public/gyms/nearby?lat=17.46&lng=78.34")).data.some(
      (g: any) => g.publicId === gym.publicId,
    ),
    "Captured payment publishes gym in nearby search",
  );
  await call("get", "/public/gyms/" + gym.slug);
  const activationTime = activated!.publishedAt.getTime(),
    eventId = crypto.randomUUID();
  await Promise.all([
    webhook("payment.captured", entity, eventId),
    webhook("payment.captured", entity, eventId),
    webhook("order.paid", entity),
  ]);
  await call("post", "/checkout/verify", token, verify);
  check(
    (await Subscription.countDocuments({
      gymId: gym._id,
      type: "PLATFORM",
    })) === 1 &&
      (await Gym.findById(gym._id))!.publishedAt.getTime() === activationTime,
    "Duplicate callbacks create no duplicate subscription or activation",
  );
  await webhook("payment.failed", { ...entity, status: "failed" });
  await call("post", `/checkout/payments/${order.paymentId}/cancel`, token, {});
  check(
    (await Payment.findOne({ publicId: order.paymentId }))!.status ===
      "CAPTURED" && (await Gym.findById(gym._id))!.status === "ACTIVE",
    "Late failure or cancellation cannot undo verified capture",
  );
  check(orders === 1, "Retries do not create additional gateway orders");
  const ownerSession = (
    await call("post", "/auth/switch-role", token, {
      role: "GYM_OWNER",
      gymId: gym._id,
    })
  ).data.accessToken;
  check(
    (await call("get", "/owner/dashboard", ownerSession)).data.gymStatus ===
      "ACTIVE",
    "Owner dashboard reflects activation",
  );
  check(
    (
      await call(
        "get",
        `/admin/registrations/${registration.publicId}`,
        adminToken,
      )
    ).data.payments.some((p: any) => p.status === "CAPTURED"),
    "Admin sees payment records instead of review controls",
  );
  const second = (
    await call(
      "post",
      "/owner/registrations",
      token,
      { ...details, name: "Second Gym" },
      201,
    )
  ).data;
  const q2 = (
    await call(
      "post",
      "/checkout/platform/quotes",
      token,
      { registrationId: second.registration.publicId, planId: plan._id },
      201,
    )
  ).data;
  const o2 = (
    await call(
      "post",
      "/checkout/platform/orders",
      token,
      { quoteId: q2.publicId },
      201,
    )
  ).data;
  await call("post", `/admin/gyms/${second.gym.publicId}/suspend`, adminToken, {
    reason: "Moderation hold",
  });
  await webhook("payment.captured", {
    ...entity,
    id: "pay_second",
    order_id: o2.providerOrderId,
  });
  check(
    (await Gym.findById(second.gym._id))!.status === "SUSPENDED",
    "A delayed payment cannot bypass moderation",
  );
  await hidden(second.gym);
  // Conservative legacy migration: paid evidence is required, active gyms are untouched.
  const legacyGym = await Gym.create({
    ...details,
    publicId: "legacy-paid",
    ownerId: gym.ownerId,
    slug: "legacy-paid",
    location: { type: "Point", coordinates: details.coordinates },
    status: "INACTIVE",
  });
  const legacy = await GymRegistration.create({
    publicId: "legacy-registration",
    gymId: legacyGym._id,
    ownerId: gym.ownerId,
    status: "FINAL_APPROVAL",
  });
  const p = await Payment.create({
    publicId: "legacy-payment",
    purpose: "PLATFORM_PLAN",
    gymId: legacyGym._id,
    payerId: gym.ownerId,
    amountMinor: 10000,
    currency: "INR",
    status: "CAPTURED",
    capturedAt: new Date(),
    providerOrderId: "order_legacy",
    providerPaymentId: "pay_legacy",
    metadata: {
      quoteSnapshot: {
        gymId: String(legacyGym._id),
        purchaserId: gym.ownerId,
        totalMinor: 10000,
        currency: "INR",
        planSnapshot: { registrationId: legacy.publicId },
      },
    },
  });
  const sub = await Subscription.create({
    publicId: "legacy-sub",
    type: "PLATFORM",
    userId: gym.ownerId,
    gymId: legacyGym._id,
    status: "ACTIVE",
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 86400000),
    latestPaymentId: p._id,
    planSnapshot: { registrationId: legacy.publicId },
  });
  p.subscriptionId = sub._id;
  await p.save();
  legacy.latestPaymentId = p._id;
  await legacy.save();
  await ProviderEvent.create({
    provider: "RAZORPAY",
    eventKey: "legacy-evidence",
    eventType: "payment.captured",
    payloadHash: "test",
    status: "PROCESSED",
    payload: {
      payload: {
        payment: {
          entity: {
            id: "pay_legacy",
            order_id: "order_legacy",
            amount: 10000,
            currency: "INR",
          },
        },
      },
    },
  });
  const unpaidGym = await Gym.create({
    ...details,
    publicId: "legacy-unpaid",
    ownerId: gym.ownerId,
    slug: "legacy-unpaid",
    location: { type: "Point", coordinates: details.coordinates },
    status: "INACTIVE",
  });
  const unpaid = await GymRegistration.create({
    publicId: "unpaid-registration",
    ownerId: gym.ownerId,
    gymId: unpaidGym._id,
    status: "PAYMENT_SUCCESSFUL",
  });
  const before = (await Gym.findById(gym._id).lean())!;
  const dry = await migratePaymentRegistrations(false);
  check(
    dry.paidActivated === 1 &&
      (await Gym.findById(legacyGym._id))!.status === "INACTIVE",
    "Migration dry run makes no changes",
  );
  const migrated = await migratePaymentRegistrations(true);
  check(
    migrated.paidActivated === 1 &&
      (await Gym.findById(legacyGym._id))!.status === "ACTIVE",
    "Only legacy payments with matching verified evidence activate",
  );
  check(
    (await Gym.findById(unpaidGym._id))!.status === "INACTIVE" &&
      (await GymRegistration.findById(unpaid._id))!.status === "DRAFT",
    "Legacy success label alone never activates an unpaid gym",
  );
  assert.deepEqual(await Gym.findById(gym._id).lean(), before);
  checks++;
  const again = await migratePaymentRegistrations(true);
  check(
    again.paidActivated === 0 && again.unpaidNormalized === 0,
    "Migration is repeatable without duplicate activations",
  );
  console.log(
    `PASS: ${checks} payment registration checks; ${orders} simulated gateway orders; no real charges.`,
  );
} finally {
  try {
    if (await testDatabase.cleanup())
      console.log("Temporary registration database removed.");
  } finally {
    await mongoose.disconnect();
  }
}
