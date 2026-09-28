import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { app } from "../app.js";
import { AccountInvitation, TransactionalEmail } from "../models/Delivery.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { AuthIdentity, RoleAssignment } from "../models/Auth.js";
import { MembershipPlan, Payment, Subscription } from "../models/Commerce.js";
import { Invoice } from "../models/Business.js";
import { Message, Conversation } from "../models/Collaboration.js";
import { Notification } from "../models/Engagement.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { createSession } from "../services/tokenService.js";
import { decryptEmail } from "../services/transactionalEmailService.js";
import { acceptMemberInvitation } from "../services/accountInvitationService.js";
import { ensurePaymentInvoice } from "../services/invoiceService.js";
function isolated() { assert.match(mongoose.connection.db!.databaseName, /^gfv_[a-f0-9]{32}$/); }
export async function fixtureInvitationToken(memberId: unknown) {
  isolated();
  const invitation = await AccountInvitation.findOne({ memberId });
  assert(invitation);
  const row = await TransactionalEmail.findOne({ entityId: invitation._id, revision: invitation.revision, kind: "INVITATION" }).select("+encryptedPayload");
  assert(row);
  const text = decryptEmail(row.encryptedPayload).text;
  const link = new URL(text.match(/https?:\/\/\S+/)![0]);
  return new URLSearchParams(link.hash.slice(1)).get("token")!;
}
export async function acceptFixtureInvitation(memberId: unknown, userId: string) {
  isolated();
  await acceptMemberInvitation({ token: await fixtureInvitationToken(memberId), userId });
}
export async function checkAccountDelivery() {
  isolated();
  const results: string[] = [];
  const owner = await User.create({ publicId: nanoid(), name: "Account verification owner", email: `${nanoid()}@verification.invalid`, roles: ["GYM_OWNER"], activeRole: "GYM_OWNER", status: "ACTIVE" });
  const gym = await Gym.create({ publicId: nanoid(), ownerId: owner._id, name: "Account delivery gym", slug: nanoid().toLowerCase(), timezone: "UTC", location: { type: "Point", coordinates: [77, 12] }, status: "ACTIVE", verificationStatus: "VERIFIED", platformSubscriptionStatus: "ACTIVE" });
  await RoleAssignment.create({ userId: owner._id, gymId: gym._id, role: "GYM_OWNER", status: "ACTIVE", permissions: OWNER_DEFAULT_PERMISSIONS });
  const ownerToken = (await createSession({ userId: String(owner._id), activeRole: "GYM_OWNER", activeGymId: String(gym._id) })).accessToken;
  const plan = await MembershipPlan.create({ publicId: nanoid(), gymId: gym._id, name: "Activation plan", code: nanoid(), durationDays: 30, priceMinor: 15000, status: "ACTIVE" });
  async function api(path: string, body: object, token?: string, expected = 200) {
    let operation = request(app).post(`/api/v1${path}`).set("x-csrf-protection", "1").set("idempotency-key", nanoid());
    if (token) operation = operation.set("Authorization", `Bearer ${token}`);
    const response = await operation.send(body);
    assert.equal(response.status, expected, `${path}: ${response.body?.error?.code || response.status}`);
    return response.body;
  }
  const makeMember = (email: string) => api("/owner/members", { name: "Gym-entered name", email, planId: plan.publicId, startsAt: new Date().toISOString().slice(0, 10), payment: { amountMinor: 15000, method: "CASH", paidAt: new Date().toISOString().slice(0, 10), reference: nanoid() } }, ownerToken, 201);
  const email = `${nanoid()}@verification.invalid`, created = (await makeMember(email)).data;
  const user = await User.findOne({ email }); assert(user);
  assert.equal(user.status, "PENDING_VERIFICATION");
  assert.equal(created.member.status, "INACTIVE");
  assert.equal(await AuthIdentity.countDocuments({ userId: user._id }), 0);
  const activationToken = await fixtureInvitationToken(created.member._id);
  // A scanner's GET cannot consume a grant.
  await request(app).get("/api/v1/auth/activate-account");
  assert.equal((await AccountInvitation.findOne({ memberId: created.member._id })).consumedAt, null, "A scanner GET must leave the persisted unused-token sentinel unchanged");
  await api("/auth/activate-account", { token: activationToken, password: "UniqueActivation123!" });
  assert.equal((await User.findById(user._id)).status, "ACTIVE");
  assert.equal((await MemberProfile.findById(created.member._id)).status, "ACTIVE");
  await api("/auth/activate-account", { token: activationToken, password: "ReplacementPassword123!" }, undefined, 400);
  const signedIn = await api("/auth/login", { identifier: email, password: "UniqueActivation123!" });
  assert(signedIn.data.accessToken);
  results.push("New owner-created account activates with one-use password token; scanner GET and replay cannot consume/reset it");

  const pending = (await makeMember(`${nanoid()}@verification.invalid`)).data;
  const originalToken = await fixtureInvitationToken(pending.member._id);
  await AccountInvitation.updateOne({ memberId: pending.member._id }, { $set: { lastQueuedAt: new Date(Date.now() - 120_000) } });
  await api(`/owner/members/${pending.member.publicId}/invitation/resend`, {}, ownerToken, 202);
  await api("/auth/activate-account", { token: originalToken, password: "UniqueActivation123!" }, undefined, 400);
  const replacedToken = await fixtureInvitationToken(pending.member._id);
  await AccountInvitation.updateOne({ memberId: pending.member._id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
  await api("/auth/activate-account", { token: replacedToken, password: "UniqueActivation123!" }, undefined, 400);
  assert.equal(await Subscription.countDocuments({ memberProfileId: pending.member._id }), 1);
  assert.equal(await Payment.countDocuments({ subscriptionId: pending.subscription._id }), 1);
  results.push("Resend replaces the activation token without duplicating membership/payment; expired tokens rejected");

  const existing = (await makeMember(owner.email)).data;
  const linkToken = await fixtureInvitationToken(existing.member._id);
  await api("/auth/accept-invitation", { token: linkToken }, signedIn.data.accessToken, 403);
  const ownerView = await request(app).get(`/api/v1/owner/members/${existing.member.publicId}`).set("Authorization", `Bearer ${ownerToken}`);
  assert.equal(ownerView.body.data.member.userId, undefined);
  for (const path of ["/workspace/records/payments", "/workspace/records/subscriptions", "/workspace/records/members", "/owner/subscriptions"]) {
    const listing = await request(app).get(`/api/v1${path}`).set("Authorization", `Bearer ${ownerToken}`);
    assert.equal(listing.status, 200, path);
    const rows = listing.body.data;
    const pendingRow = rows.find((row: any) => row.publicId === (path.includes("payments") ? existing.payment.publicId : path.includes("members") ? existing.member.publicId : existing.subscription.publicId));
    assert(pendingRow, `Pending record remains visible: ${path}`);
    assert(!JSON.stringify(pendingRow).includes(owner.name), `No global account name leaks before acceptance: ${path}`);
  }
  await api("/auth/accept-invitation", { token: linkToken }, ownerToken);
  const preserved = await User.findById(owner._id);
  assert.equal(preserved.name, owner.name); assert(preserved.roles.includes("GYM_OWNER"));
  assert.equal(await AuthIdentity.countDocuments({ userId: owner._id }), 0);
  results.push("Existing-account invitation requires the intended authenticated user and preserves identity/roles");

  const payment = await Payment.findById(created.payment._id);
  await ensurePaymentInvoice(payment); await ensurePaymentInvoice(payment);
  const invoice = await Invoice.findOne({ paymentId: payment._id }); assert(invoice);
  assert.equal(await Invoice.countDocuments({ paymentId: payment._id }), 1);
  assert.equal(await Message.countDocuments({ invoiceId: invoice._id, type: "SYSTEM" }), 1);
  assert.equal(await TransactionalEmail.countDocuments({ eventKey: `invoice:${invoice.publicId}` }), 1);
  assert.equal(await Notification.countDocuments({ userId: user._id, event: "invoice.ready", entityId: invoice.publicId }), 1);
  const unchanged = invoice.customerSnapshot.name;
  await User.updateOne({ _id: user._id }, { $set: { name: "Changed after payment" } });
  assert.equal((await ensurePaymentInvoice(payment)).customerSnapshot.name, unchanged);
  await assert.rejects(() => ensurePaymentInvoice({ ...payment.toObject(), status: "PENDING" }), (error: any) => error.code === "INVOICE_NOT_AVAILABLE");
  const pdf = await request(app).get(`/api/v1/workspace/payments/${payment.publicId}/invoice`).set("Authorization", `Bearer ${signedIn.data.accessToken}`);
  // The shared invoice route is discovered below through the actual router.
  const conversation = await Conversation.findOne({ directKey: `system:billing:${user._id}` }); assert(conversation);
  await api(`/conversations/${conversation.publicId}/messages`, { clientMessageId: nanoid(), text: "Cannot edit receipt thread" }, signedIn.data.accessToken, 403);
  assert.equal(pdf.status, 200, "Authorized invoice PDF must remain downloadable");
  results.push("Paid invoice/email/system message/notification are idempotent and immutable; receipt thread is read-only; private PDF downloads work");
  const copyKey = nanoid(), copyPath = `/api/v1/workspace/payments/${payment.publicId}/invoice/email`;
  const copy = () => request(app).post(copyPath).set("Authorization", `Bearer ${signedIn.data.accessToken}`).set("x-csrf-protection", "1").set("idempotency-key", copyKey).send({});
  const firstCopy = await copy(), replayCopy = await copy();
  assert.equal(firstCopy.status, 202); assert.equal(replayCopy.status, 202);
  assert.equal(firstCopy.body.data.invoiceId, invoice.publicId);
  assert.equal(replayCopy.body.data.invoiceId, invoice.publicId);
  assert.equal(await TransactionalEmail.countDocuments({ entityId: invoice._id, kind: "INVOICE" }), 2);
  assert.equal(await TransactionalEmail.countDocuments({ entityId: invoice._id, kind: "INVOICE", status: "QUEUED" }), 1);
  const copyStatus = await request(app).get(copyPath).set("Authorization", `Bearer ${signedIn.data.accessToken}`);
  assert.equal(copyStatus.status, 200); assert.equal(copyStatus.body.data.status, "QUEUED");
  assert.equal(copyStatus.body.data.deliveredAt, undefined);
  assert.equal(await Invoice.countDocuments({ paymentId: payment._id }), 1);
  assert.equal(await Message.countDocuments({ invoiceId: invoice._id }), 1);
  results.push("Explicit invoice email resend/status preserve invoice and message, deduplicate repeated requests and accurately report queued delivery");
  return results;
}
