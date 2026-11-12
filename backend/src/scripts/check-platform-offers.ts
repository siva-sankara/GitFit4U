import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { PlatformPlan, MembershipPlan, PlanQuote, Subscription, Payment } from "../models/Commerce.js";
import { Invoice, Offer, Advertisement } from "../models/Business.js";
import { Notification, SupportTicket } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { RoleAssignment } from "../models/Auth.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { createSession } from "../services/tokenService.js";
import { registrationActivationEligibility, settleAuthorizedGatewayPayment } from "../services/gymActivationService.js";
import { maintainRecords } from "../services/maintenanceService.js";

if (!process.argv.includes("--run-isolated")) throw new Error("Explicit --run-isolated is required.");
logger.level = "silent";
env.WHATSAPP_MODE = "disabled";
for (const key of ["RESEND_API_KEY", "EMAIL_FROM", "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID", "FIREBASE_PROJECT_ID", "FIREBASE_CLIENT_EMAIL", "FIREBASE_PRIVATE_KEY", "OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_ACCESS_KEY", "OBJECT_STORAGE_SECRET_KEY", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET"] as const) env[key] = undefined;
globalThis.fetch = async () => { throw new Error("External delivery is disabled during isolated verification."); };
const databaseName = `gfv_${randomUUID().replaceAll("-", "")}`;
let ownsDatabase = false;
function boundary() { assert(/^gfv_[a-f0-9]{32}$/.test(databaseName)); assert.equal(mongoose.connection.db?.databaseName, databaseName); }
async function user(role: "ADMIN" | "USER" | "GYM_OWNER") {
  return User.create({ publicId: nanoid(18), name: `Test ${role}`, email: `${nanoid(12)}@verification.invalid`, roles: [role], activeRole: role, status: "ACTIVE" });
}
async function token(account: any, gym?: any) { return (await createSession({ userId: String(account._id), activeRole: account.activeRole, activeGymId: gym && String(gym._id) })).accessToken; }
function call(method: "get" | "post" | "patch", path: string, auth: string, body?: object, key = randomUUID()) {
  const operation = request(app)[method]("/api/v1" + path).set("authorization", `Bearer ${auth}`).set("idempotency-key", key).set("x-csrf-protection", "1");
  return body ? operation.send(body) : operation;
}
function status(response: any, expected = 200) { assert.equal(response.status, expected, `${response.status}: ${response.body?.error?.code || ""}`); return response.body.data; }
async function gym(owner: any, active = false) {
  const row = await Gym.create({ publicId: nanoid(18), ownerId: owner._id, name: "Isolated test gym", slug: nanoid(20).toLowerCase(),
    status: "INACTIVE", verificationStatus: "VERIFIED", platformSubscriptionStatus: "NONE", timezone: "Asia/Kolkata",
    contact: { email: owner.email, phone: "+919999999999" }, address: { line1: "Test street", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" }, location: { type: "Point", coordinates: [77.59, 12.97] } });
  if (!active) await GymRegistration.create({ publicId: nanoid(20), ownerId: owner._id, gymId: row._id, status: "PAYMENT_PENDING", currentStep: "PAYMENT" });
  await RoleAssignment.create({ userId: owner._id, gymId: row._id, role: "GYM_OWNER", status: "ACTIVE", permissions: OWNER_DEFAULT_PERMISSIONS });
  if (active) { row.status = "ACTIVE"; row.platformSubscriptionStatus = "ACTIVE"; await row.save(); }
  return row;
}
import { paymentProvider } from "../integrations/payments/index.js";
import { migratePromotionScopes } from "../services/promotionScopeMigration.js";

try {
  await mongoose.connect(env.MONGO_URI, { dbName: databaseName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  boundary(); assert.equal((await mongoose.connection.db!.listCollections({}, { nameOnly: true }).toArray()).length, 0);
  await mongoose.connection.db!.collection("verification_run").insertOne({ createdAt: new Date() }); ownsDatabase = true;
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const admin = await user("ADMIN"), ownerA = await user("GYM_OWNER"), ownerB = await user("GYM_OWNER"), member = await user("USER");
  const gymA = await gym(ownerA, true), gymB = await gym(ownerB, true);
  const adminToken = await token(admin), tokenA = await token(ownerA, gymA), tokenB = await token(ownerB, gymB), memberToken = await token(member);
  const platformPlan = await PlatformPlan.create({ name: "Test platform", code: nanoid(10), billingPeriod: "MONTHLY", priceMinor: 10000, currency: "INR", active: true });
  const otherPlan = await PlatformPlan.create({ name: "Other test platform", code: nanoid(10), billingPeriod: "YEARLY", priceMinor: 100000, currency: "INR", active: true });
  const memberPlan = await MembershipPlan.create({ publicId: nanoid(20), gymId: gymA._id, code: nanoid(10), name: "Test membership", durationDays: 30, priceMinor: 10000, status: "ACTIVE" });
  const now = Date.now();
  const base = { name: "Scope verification", startsAt: new Date(now - 60000).toISOString(), endsAt: new Date(now + 86400000).toISOString(), status: "ACTIVE", discount: { kind: "PERCENT", percentageBasisPoints: 2000 }, perUserLimit: 1 };
  const gymOfferA = status(await call("post", "/owner/offers", tokenA, { ...base, name: "Gym A offer", type: "DISCOUNT", code: "GYMONLY" }), 201);
  const gymOfferB = status(await call("post", "/owner/offers", tokenB, { ...base, name: "Gym B offer", type: "DISCOUNT" }), 201);
  for (const [auth, name] of [[tokenA, "Gym A ad"], [tokenB, "Gym B ad"]]) status(await call("post", "/owner/ads", auth, { ...base, discount: undefined, perUserLimit: undefined, name, ctaTarget: "GYM" }), 201);
  assert.equal(status(await call("get", "/admin/promotions/offers", adminToken)).length, 2);
  assert.equal(status(await call("get", "/admin/promotions/ads", adminToken)).length, 2);
  assert.equal(status(await call("get", `/owner/offers?gymId=${gymB._id}`, tokenA))[0].publicId, gymOfferA.publicId);
  status(await call("patch", `/owner/offers/${gymOfferB.publicId}`, tokenA, { ...base, type: "DISCOUNT" }), 404);
  status(await call("get", "/admin/promotions/offers", tokenA), 403);
  await Offer.updateOne({ _id: gymOfferB._id }, { $set: { status: "ARCHIVED" } });
  assert.equal(status(await call("get", "/admin/promotions/offers?status=ARCHIVED", adminToken))[0].publicId, gymOfferB.publicId);
  assert.equal(status(await call("get", "/admin/promotions/offers?q=Gym%20A%20offer", adminToken)).length, 1);

  const restrictedInput = { ...base, name: "Selected owner platform offer", code: "PLATFORMONLY", purchaseKinds: ["NEW"], billingPeriods: ["MONTHLY"], platformPlanIds: [String(platformPlan._id)], ownerAudienceIds: [String(ownerA._id)] };
  const restricted = status(await call("post", "/admin/promotions/platform-offers", adminToken, restrictedInput), 201);
  assert.equal(restricted.scope, "PLATFORM_SUBSCRIPTION"); assert.equal(restricted.application, "ONE_TIME");
  status(await call("post", "/admin/promotions/platform-offers", tokenA, restrictedInput), 403);
  status(await call("post", "/admin/promotions/platform-offers", adminToken, { ...restrictedInput, scope: "GYM_MEMBERSHIP" }), 422);
  assert.equal(status(await call("get", "/admin/promotions/offers", adminToken)).length, 2);
  const publicOffers = await request(app).get(`/api/v1/public/promotions/offers?gymId=${gymA._id}`);
  assert.equal(publicOffers.status, 200); assert(!JSON.stringify(publicOffers.body).includes("PLATFORMONLY"));
  status(await call("post", "/checkout/quotes", memberToken, { gymId: String(gymA._id), planId: String(memberPlan._id), couponCode: "PLATFORMONLY" }), 422);

  const newGymA = await gym(ownerA), newGymB = await gym(ownerB);
  const registrationA = await GymRegistration.findOne({ gymId: newGymA._id }), registrationB = await GymRegistration.findOne({ gymId: newGymB._id });
  const purchaseA = { registrationId: registrationA!.publicId, planId: String(platformPlan._id) }, purchaseB = { registrationId: registrationB!.publicId, planId: String(platformPlan._id) };
  const eligible = status(await call("get", `/checkout/platform/offers?registrationId=${purchaseA.registrationId}&planId=${platformPlan._id}`, tokenA));
  assert(eligible.some((offer: any) => offer.publicId === restricted.publicId));
  assert.equal(status(await call("get", `/checkout/platform/offers?registrationId=${purchaseB.registrationId}&planId=${platformPlan._id}`, tokenB)).length, 0);
  status(await call("get", `/checkout/platform/offers?registrationId=${purchaseA.registrationId}&planId=${platformPlan._id}`, tokenB), 403);
  const discounted = status(await call("post", "/checkout/platform/quotes", tokenA, { ...purchaseA, couponCode: "PLATFORMONLY" }), 201);
  assert.equal(discounted.totalMinor, 8000); assert.equal(discounted.taxMinor, 0); assert.equal(discounted.pricingSnapshot.offer.version, 1);
  for (const [auth, purchase, extra] of [
    [tokenB, purchaseB, { couponCode: "PLATFORMONLY" }],
    [tokenA, { ...purchaseA, planId: String(otherPlan._id) }, { couponCode: "PLATFORMONLY" }],
    [tokenA, purchaseA, { couponCode: "GYMONLY" }],
    [tokenA, purchaseA, { couponCode: "PLATFORMONLY", totalMinor: 1 }],
  ] as const) status(await call("post", "/checkout/platform/quotes", auth, { ...purchase, ...extra }), 422);
  for (const statusValue of ["PAUSED", "EXPIRED"]) {
    await Offer.updateOne({ _id: restricted._id }, { $set: { status: statusValue } });
    status(await call("post", "/checkout/platform/quotes", tokenA, { ...purchaseA, couponCode: "PLATFORMONLY" }), 422);
  }
  console.log("PASS scopes: admin across gyms, private owner management, status/search, targeted visibility, coupon/plan/audience boundaries and server prices");

  const limited = status(await call("post", "/admin/promotions/platform-offers", adminToken, { ...base, name: "Last available redemption", code: "FINALUSE", purchaseKinds: ["NEW"], billingPeriods: ["MONTHLY"], redemptionLimit: 1 }), 201);
  const quotes = [status(await call("post", "/checkout/platform/quotes", tokenA, { ...purchaseA, couponCode: "FINALUSE" }), 201), status(await call("post", "/checkout/platform/quotes", tokenB, { ...purchaseB, couponCode: "FINALUSE" }), 201)];
  env.RAZORPAY_WEBHOOK_SECRET = "isolated-offer-webhook";
  let providerCalls = 0;
  paymentProvider.createPayment = async input => { boundary(); providerCalls++; return { id: `order_test_${nanoid()}`, amount: input.amountMinor, currency: input.currency, status: "created" }; };
  const results = await Promise.all(quotes.map((quote, i) => call("post", "/checkout/platform/orders", i ? tokenB : tokenA, { quoteId: quote.publicId })));
  assert.deepEqual(results.map(result => result.status).sort(), [201, 409]); assert.equal(providerCalls, 1);
  const winner = results.findIndex(result => result.status === 201), order = results[winner].body.data, auth = winner ? tokenB : tokenA;
  const replay = status(await call("post", "/checkout/platform/orders", auth, { quoteId: quotes[winner].publicId }), 201);
  assert.equal(replay.paymentId, order.paymentId); assert.equal(providerCalls, 1);
  const reserved = await Payment.findOne({ publicId: order.paymentId }); assert.equal(reserved!.status, "PENDING");
  assert.equal(await Invoice.countDocuments({ paymentId: reserved!._id }), 0);
  await Offer.updateOne({ _id: limited._id }, { $set: { status: "EXPIRED", discount: { kind: "FIXED", amountMinor: 1 }, endsAt: new Date(now - 1) }, $inc: { version: 1 } });
  const resumed = status(await call("post", "/checkout/platform/quotes", auth, winner ? purchaseB : purchaseA), 201);
  assert.equal(resumed.totalMinor, 8000);
  const payload = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: `pay_test_${nanoid()}`, order_id: order.providerOrderId, status: "captured", amount: 8000, currency: "INR", method: "upi" } } } });
  const signature = createHmac("sha256", env.RAZORPAY_WEBHOOK_SECRET).update(payload).digest("hex");
  for (const eventId of ["event-fixture-one", "event-fixture-one", "event-fixture-two"])
    status(await request(app).post("/api/v1/webhooks/razorpay").set("content-type", "application/json").set("x-razorpay-signature", signature).set("x-razorpay-event-id", eventId).send(payload));
  const captured = await Payment.findById(reserved!._id); assert.equal(captured!.status, "CAPTURED"); assert.equal(captured!.amountMinor, 8000);
  assert.equal((await Offer.findById(limited._id))!.redemptionCount, 1);
  const invoice = await Invoice.findOne({ paymentId: reserved!._id }); assert(invoice); assert.equal(invoice.totalMinor, 8000); assert.equal(invoice.discountMinor, 2000); assert.equal(invoice.pricingSnapshot.offer.version, 1);
  assert.equal(await Invoice.countDocuments({ paymentId: reserved!._id }), 1);
  console.log("PASS committed prices: concurrent final use, pending without invoice, replayed order, signed delayed capture after expiry/edit, one redemption and immutable invoice");

  const winningGym = winner ? newGymB : newGymA, winningOwner = winner ? ownerB : ownerA;
  const renewalToken = await token(winningOwner, winningGym);
  const renewalOffer = status(await call("post", "/admin/promotions/platform-offers", adminToken, { ...base, name: "Renewal only", code: "RENEWONLY", purchaseKinds: ["RENEWAL"], billingPeriods: ["MONTHLY"] }), 201);
  const renewalBody = { renewal: true, planId: String(platformPlan._id), expectedGymId: String(winningGym._id) };
  const renewalQuote = status(await call("post", "/checkout/platform/quotes", renewalToken, { ...renewalBody, couponCode: "RENEWONLY" }), 201);
  assert.equal(renewalQuote.totalMinor, 8000);
  const regularRenewal = status(await call("post", "/checkout/platform/quotes", renewalToken, renewalBody), 201);
  assert.equal(regularRenewal.totalMinor, 10000); assert.equal(regularRenewal.discountMinor, 0);
  const unpurchased = winner ? purchaseA : purchaseB, otherOwnerToken = winner ? tokenA : tokenB;
  status(await call("post", "/checkout/platform/quotes", otherOwnerToken, { ...unpurchased, couponCode: "RENEWONLY" }), 422);
  status(await call("patch", `/admin/promotions/platform-offers/${renewalOffer.publicId}`, adminToken, { ...base, name: "Renewal paused", code: "RENEWONLY", purchaseKinds: ["RENEWAL"], billingPeriods: ["MONTHLY"], status: "PAUSED" }));
  status(await call("post", "/checkout/platform/orders", renewalToken, { quoteId: renewalQuote.publicId }), 422);
  assert.equal(await Payment.countDocuments({ quoteId: renewalQuote._id }), 0);
  assert.equal((await Offer.findById(renewalOffer._id))!.version, 2);
  console.log("PASS renewal: eligibility, current-cycle discount only, undiscounted future purchase, admin edit/version and paused-quote rejection before payment");

  const legacy = await Offer.create({ ...base, publicId: nanoid(20), type: "DISCOUNT", gymId: gymA._id, createdBy: admin._id });
  const ambiguous = await Offer.create({ ...base, publicId: nanoid(20), type: "DISCOUNT", createdBy: admin._id });
  const dry = await migratePromotionScopes(); assert.equal(dry.updated, 0);
  const migrated = await migratePromotionScopes(true); assert.equal(migrated.gymMembership, 1); assert.equal(migrated.reviewRequired, 1);
  assert.equal((await Offer.findById(legacy._id))!.scope, "GYM_MEMBERSHIP"); assert.equal((await Offer.findById(ambiguous._id))!.scope, "REVIEW_REQUIRED");
  assert.equal((await Invoice.findById(invoice._id))!.totalMinor, 8000);
  console.log("PASS migration: additive classification, administrator-created gym offer preserved, unbound offer flagged, financial history unchanged");
} finally {
  if (ownsDatabase) { boundary(); await mongoose.connection.db!.dropDatabase(); console.log("Isolated verification database removed"); }
  await mongoose.disconnect();
}
