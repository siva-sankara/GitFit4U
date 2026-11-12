import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { GymRegistration } from "../models/GymRegistration.js";
import { PlatformPlan, Subscription, Payment } from "../models/Commerce.js";
import { Invoice } from "../models/Business.js";
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
async function gym(owner: any) {
  const row = await Gym.create({ publicId: nanoid(18), ownerId: owner._id, name: "Isolated test gym", slug: nanoid(20).toLowerCase(),
    status: "INACTIVE", verificationStatus: "VERIFIED", platformSubscriptionStatus: "NONE", timezone: "Asia/Kolkata",
    contact: { email: owner.email, phone: "+919999999999" }, address: { line1: "Test street", city: "Bengaluru", state: "Karnataka", postalCode: "560001", country: "IN" }, location: { type: "Point", coordinates: [77.59, 12.97] } });
  await GymRegistration.create({ publicId: nanoid(20), ownerId: owner._id, gymId: row._id, status: "PAYMENT_PENDING", currentStep: "PAYMENT" });
  await RoleAssignment.create({ userId: owner._id, gymId: row._id, role: "GYM_OWNER", status: "ACTIVE", permissions: OWNER_DEFAULT_PERMISSIONS });
  return row;
}
try {
  await mongoose.connect(env.MONGO_URI, { dbName: databaseName, autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 15000 });
  boundary(); assert.equal((await mongoose.connection.db!.listCollections({}, { nameOnly: true }).toArray()).length, 0);
  await mongoose.connection.db!.collection("verification_run").insertOne({ createdAt: new Date() }); ownsDatabase = true;
  for (const model of Object.values(mongoose.models)) await model.createIndexes();
  const admin = await user("ADMIN"), owner = await user("GYM_OWNER"), member = await user("USER"), stranger = await user("USER");
  const adminToken = await token(admin), memberToken = await token(member), strangerToken = await token(stranger);
  const plan = await PlatformPlan.create({ name: "Bounded test plan", code: nanoid(10), billingPeriod: "MONTHLY", priceMinor: 100000, currency: "INR", memberLimit: 1, staffLimit: 0, active: true });
  const pendingGym = await gym(owner), ownerToken = await token(owner, pendingGym);
  const now = Date.now(), term = { planId: String(plan._id), startsAt: new Date(now - 60000).toISOString(), endsAt: new Date(now + 29 * 86400000).toISOString(), reason: "Authorized collection at front desk" };
  const pendingInput = { ...term, mode: "PAYMENT_PENDING", dueAt: new Date(now + 86400000).toISOString() };
  status(await call("post", `/admin/gyms/${pendingGym.publicId}/authorization`, ownerToken, pendingInput), 403);
  const key = randomUUID();
  const duplicates = await Promise.all([call("post", `/admin/gyms/${pendingGym.publicId}/authorization`, adminToken, pendingInput, key), call("post", `/admin/gyms/${pendingGym.publicId}/authorization`, adminToken, pendingInput, key)]);
  duplicates.forEach(result => status(result));
  const authorized = duplicates[0].body.data;
  assert.equal(await Subscription.countDocuments({ gymId: pendingGym._id }), 1);
  assert.equal(await Payment.countDocuments({ gymId: pendingGym._id }), 1);
  assert.equal(await Payment.countDocuments({ gymId: pendingGym._id, status: "CAPTURED" }), 0);
  assert.equal(await Invoice.countDocuments({ gymId: pendingGym._id }), 0);
  assert.equal(await Notification.countDocuments({ gymId: pendingGym._id, event: { $in: ["payment.successful", "payment.offline", "invoice.ready"] } }), 0);
  assert.equal(await Notification.countDocuments({ gymId: pendingGym._id, event: "gym.activated" }), 1);
  const registration = await GymRegistration.findOne({ gymId: pendingGym._id });
  assert(await registrationActivationEligibility(registration)); await maintainRecords();
  assert.equal((await Gym.findById(pendingGym._id))!.platformSubscriptionStatus, "ACTIVE");
  const payment = { method: "CASH", amountMinor: plan.priceMinor, currency: "INR", paidAt: new Date(now - 1000).toISOString(), confirmedReceived: true, notes: "Actual test receipt" };
  for (let n = 0; n < 2; n++) status(await call("post", `/admin/platform-payments/${authorized.payment.publicId}/collect`, adminToken, payment));
  status(await call("post", `/admin/platform-payments/${authorized.payment.publicId}/collect`, adminToken, { ...payment, notes: "Conflicting collection details" }), 409);
  assert.equal(await Subscription.countDocuments({ gymId: pendingGym._id }), 1);
  assert.equal(await Invoice.countDocuments({ gymId: pendingGym._id }), 1);
  assert.equal(await Notification.countDocuments({ gymId: pendingGym._id, event: "payment.offline" }), 1);
  for (const method of ["CASH", "UPI"]) {
    const target = await gym(owner);
    status(await call("post", `/admin/gyms/${target.publicId}/authorization`, adminToken, { ...term, mode: "OFFLINE_PAYMENT", payment: { ...payment, method, ...(method === "UPI" ? { reference: "TEST-UTR-000001" } : {}) } }));
    assert.equal(await Invoice.countDocuments({ gymId: target._id }), 1);
    assert.equal((await Payment.findOne({ gymId: target._id }))!.provider, "OFFLINE");
  }
  // A gateway order opened before the admin authorization must settle this
  // term rather than granting a second subscription when its capture arrives.
  const gatewayGym = await gym(owner);
  const gatewayAuthorization = status(await call("post", `/admin/gyms/${gatewayGym.publicId}/authorization`, adminToken, pendingInput));
  const gatewayRegistration = await GymRegistration.findOne({ gymId: gatewayGym._id });
  const captured = await Payment.create({ publicId: nanoid(24), purpose: "PLATFORM_PLAN", payerId: owner._id, gymId: gatewayGym._id,
    provider: "RAZORPAY", status: "CAPTURED", amountMinor: plan.priceMinor, currency: "INR", capturedAt: new Date(), metadata: {} });
  await mongoose.connection.transaction(async session => {
    await Gym.updateOne({ _id: gatewayGym._id }, { $inc: { version: 1 } }, { session });
    assert(await settleAuthorizedGatewayPayment(gatewayRegistration, captured, { planId: plan._id, subtotalMinor: plan.priceMinor, discountMinor: 0, taxMinor: 0 }, session));
  });
  assert.equal(await Subscription.countDocuments({ gymId: gatewayGym._id }), 1);
  assert.equal((await Payment.findById(gatewayAuthorization.payment._id))!.status, "CANCELLED");
  assert.equal((await Subscription.findById(gatewayAuthorization.subscription._id))!.adminAuthorization.paymentStatus, "PAID_ONLINE");
  assert.equal(await Invoice.countDocuments({ paymentId: captured._id }), 1);
  await mongoose.connection.transaction(async session => { await MemberProfile.create([{ publicId: nanoid(18), gymId: pendingGym._id, userId: member._id, memberCode: nanoid(10), status: "ACTIVE", directAccess: true }], { session }); });
  await assert.rejects(mongoose.connection.transaction(async session => { await MemberProfile.create([{ publicId: nanoid(18), gymId: pendingGym._id, userId: stranger._id, memberCode: nanoid(10), status: "ACTIVE" }], { session }); }), (error: any) => error.code === "PLATFORM_CAPACITY_REACHED");
  console.log("PASS activation: cash, confirmed UPI, pending/no revenue or receipt, concurrent retries, offline/late-gateway settlement, eligibility and capacity");

  const supportInput = { subject: "Private platform complaint", message: "Please help privately with this test account", category: "ACCOUNT", gymId: String(pendingGym._id) };
  const supportKey = randomUUID();
  const created = status(await call("post", "/users/me/support-tickets", memberToken, supportInput, supportKey), 201);
  status(await call("post", "/users/me/support-tickets", memberToken, supportInput, supportKey), 201);
  assert.equal(await SupportTicket.countDocuments({ requesterId: member._id }), 1);
  const path = `/conversations/${created.conversationId}`;
  status(await call("get", path, ownerToken), 404); status(await call("get", path, strangerToken), 404);
  status(await call("get", path + "/support-management", memberToken), 403);
  status(await call("patch", path + "/support-management", memberToken, { assignedTo: String(admin._id) }), 403);
  status(await call("patch", path + "/support-management", adminToken, { assignedTo: String(admin._id), priority: "HIGH", status: "IN_PROGRESS" }));
  const privateText = "Internal test note never sent to requester";
  status(await call("post", path + "/internal-notes", adminToken, { key: randomUUID(), body: privateText }));
  const publicDetail = status(await call("get", path, memberToken));
  assert(!JSON.stringify(publicDetail).includes(privateText)); assert(!Object.hasOwn(publicDetail.supportTicketId, "internalNotes"));
  const reply = { text: "We are reviewing your request", type: "TEXT", clientMessageId: randomUUID() };
  status(await call("post", path + "/messages", adminToken, reply), 201); status(await call("post", path + "/messages", adminToken, reply));
  const beforeFailedReply = await SupportTicket.findById(publicDetail.supportTicketId._id);
  const beforeFailedNotices = await Notification.countDocuments({ event: "support.updated", userId: admin._id });
  status(await call("post", path + "/messages", memberToken, { text: "Forged private attachment", type: "FILE", clientMessageId: randomUUID(), attachments: [{ key: nanoid(20) }] }), 422);
  const afterFailedReply = await SupportTicket.findById(publicDetail.supportTicketId._id);
  assert.equal(afterFailedReply!.revision, beforeFailedReply!.revision);
  assert.equal(afterFailedReply!.status, beforeFailedReply!.status);
  assert.equal(await Notification.countDocuments({ event: "support.updated", userId: admin._id }), beforeFailedNotices);
  status(await call("patch", path + "/support-management", adminToken, { status: "RESOLVED" }));
  status(await call("patch", path + "/support-management", memberToken, { status: "OPEN" }));
  const ownList = status(await call("get", "/conversations?type=SUPPORT&category=ACCOUNT&status=OPEN", memberToken)); assert.equal(ownList.length, 1);
  const ownerList = status(await call("get", "/conversations?type=SUPPORT", ownerToken)); assert.equal(ownerList.length, 0);
  const notification = await Notification.findOne({ userId: member._id, event: "support.updated" }); assert(notification);
  const destination = status(await call("post", `/users/me/notifications/${notification._id}/open`, memberToken)); assert.equal(destination.path, `/app/support?ticket=${created.conversationId}`);
  status(await call("post", `/users/me/notifications/${notification._id}/open`, strangerToken), 404);
  assert((await Notification.findById(notification._id))!.openedAt);
  const gymNotice = await Notification.findOne({ gymId: pendingGym._id, userId: owner._id, event: "gym.activated" });
  assert(gymNotice);
  const gymDestination = status(await call("post", `/users/me/notifications/${gymNotice._id}/open`, ownerToken));
  assert.equal(gymDestination.path, `/platform-renewal?gym=${pendingGym.publicId}`);
  const memberWorkspaceNotice = await Notification.create({ userId: owner._id, event: "attendance.checked_in", entityId: nanoid(20), title: "Attendance update", message: "Review your attendance", category: "ATTENDANCE" });
  const roleDestination = status(await call("post", `/users/me/notifications/${memberWorkspaceNotice._id}/open`, ownerToken));
  assert.equal(roleDestination.available, false);
  assert.match(roleDestination.explanation, /member workspace/);
  await Subscription.updateOne({ _id: authorized.subscription._id }, { $set: { endsAt: new Date(now - 1000) } });
  await maintainRecords(); assert.equal((await Gym.findById(pendingGym._id))!.platformSubscriptionStatus, "EXPIRED");
  status(await call("get", path, memberToken));
  console.log("PASS support: private scope, search/filters, assignment/status/reopen, internal notes, retry-safe replies, exact authorized notification click and expired-gym support access");
} finally {
  if (ownsDatabase) { boundary(); await mongoose.connection.db!.dropDatabase(); console.log("Isolated verification database removed"); }
  await mongoose.disconnect();
}
