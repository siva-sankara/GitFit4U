import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { RoleAssignment } from "../models/Auth.js";
import { MemberProfile } from "../models/Member.js";
import { Advertisement, Attachment, Offer } from "../models/Business.js";
import { MembershipPlan, Payment } from "../models/Commerce.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { createSession } from "../services/tokenService.js";
import { paymentProvider } from "../integrations/payments/index.js";
import { redeemPaymentOffer } from "../services/promotionService.js";
import { env } from "../config/env.js";

// Called only by the owning isolated runner. No connection, DB deletion, real
// provider order, S3 object, ad event, or production migration is created here.
export async function checkPromotionRegressions({ assertDatabase }: { assertDatabase: () => void }) {
  assertDatabase();
  assert.match(mongoose.connection.db!.databaseName, /^gfv_[a-f0-9]{32}$/);
  const results: string[] = [];
  const [owner, member, second] = await User.create(["GYM_OWNER", "USER", "USER"].map((role, index) => ({ publicId: nanoid(), name: `Promotion fixture ${index}`, roles: [role], status: "ACTIVE" })));
  const gyms = await Gym.create([0, 1].map(index => ({ publicId: nanoid(), ownerId: owner._id, name: `Promotion gym ${index}`, slug: nanoid().toLowerCase(), location: { type: "Point", coordinates: [77, 12] }, status: "ACTIVE", verificationStatus: "VERIFIED", platformSubscriptionStatus: "ACTIVE" })));
  const gym = gyms[0];
  await RoleAssignment.create({ userId: owner._id, role: "GYM_OWNER", gymId: gym._id, permissions: OWNER_DEFAULT_PERMISSIONS, status: "ACTIVE" });
  await MemberProfile.create({ publicId: nanoid(), gymId: gym._id, userId: member._id, memberCode: nanoid(), status: "ACTIVE" });
  const tokens = await Promise.all([owner, member, second].map((user, index) => createSession({ userId: String(user._id), activeRole: index ? "USER" : "GYM_OWNER", ...(index ? {} : { activeGymId: String(gym._id) }) }).then(value => value.accessToken)));
  const plans = await MembershipPlan.create(gyms.map((value: (typeof gyms)[number]) => ({ publicId: nanoid(), gymId: value._id, code: nanoid(), name: "Promotion monthly", durationDays: 30, priceMinor: 10000, taxRateBasisPoints: 1800, status: "ACTIVE" })));
  async function api(method: "get" | "post" | "patch", path: string, body?: object, expected = 200, token = tokens[0]) {
    assertDatabase();
    const client = request(app);
    const operation = client[method]("/api/v1" + path).set("Authorization", `Bearer ${token}`).set("idempotency-key", nanoid()).set("x-csrf-protection", "1");
    const response = await (body ? operation.send(body) : operation);
    assert.equal(response.status, expected, `${method} ${path}: ${response.body?.error?.code || response.status}`);
    return response.body;
  }
  const start = new Date(Date.now() - 86400000).toISOString(), end = new Date(Date.now() + 86400000).toISOString();
  const base = { name: "Promotion checkout fixture", startsAt: start, endsAt: end, status: "ACTIVE", type: "DISCOUNT", code: `TEST${nanoid(8).toUpperCase()}`, discount: { kind: "PERCENT", percentageBasisPoints: 2500 }, applicablePlanIds: [String(plans[0]._id)], perUserLimit: 1, redemptionLimit: 1 };
  const offer = (await api("post", "/owner/offers", base, 201)).data;
  await api("patch", `/owner/offers/${offer.publicId}`, { ...base, gymId: String(gyms[1]._id) }, 403);
  await api("post", "/owner/offers", { ...base, code: nanoid(12), applicablePlanIds: [String(plans[1]._id)] }, 422);
  const quoteBody = { gymId: String(gym._id), planId: String(plans[0]._id), couponCode: base.code };
  await api("post", "/checkout/quotes", { ...quoteBody, totalMinor: 1, discountMinor: 99999 }, 422, tokens[1]);
  const quote1 = (await api("post", "/checkout/quotes", quoteBody, 201, tokens[1])).data;
  const quote2 = (await api("post", "/checkout/quotes", quoteBody, 201, tokens[2])).data;
  assert.equal(quote1.totalMinor, 8850);
  assert.equal(quote1.pricingSnapshot.offerDiscountMinor, 2500);
  assert.equal(quote1.pricingSnapshot.taxMinor, 1350);
  results.push("Offer quote applies real percentage and tax server-side, rejects injected amounts and cross-gym/plan management");
  const provider = paymentProvider.createPayment, webhook = env.RAZORPAY_WEBHOOK_SECRET;
  let providerCalls = 0;
  try {
    env.RAZORPAY_WEBHOOK_SECRET = "isolated-promotion-verification";
    paymentProvider.createPayment = async input => { assertDatabase(); providerCalls++; return { id: "order_fixture_" + nanoid(), amount: input.amountMinor, currency: input.currency, status: "created" }; };
    const responses = await Promise.all([quote1, quote2].map((quote, index) => request(app).post("/api/v1/checkout/orders").set("Authorization", `Bearer ${tokens[index + 1]}`).set("idempotency-key", nanoid()).send({ quoteId: quote.publicId })));
    assert.deepEqual(responses.map(value => value.status).sort(), [201, 409]);
    assert.equal(providerCalls, 1);
    const winnerIndex = responses.findIndex(value => value.status === 201);
    const winnerQuote = [quote1, quote2][winnerIndex], winnerToken = tokens[winnerIndex + 1];
    const winner = responses[winnerIndex].body.data;
    const replay = await api("post", "/checkout/orders", { quoteId: winnerQuote.publicId }, 201, winnerToken);
    assert.equal(replay.data.paymentId, winner.paymentId);
    assert.equal(providerCalls, 1);
    const payment = await Payment.findOne({ publicId: winner.paymentId });
    assert.equal(payment.amountMinor, 8850);
    assert.equal(payment.pricingSnapshot.offerDiscountMinor, 2500);
    await Offer.updateOne({ _id: offer._id }, { $set: { name: "Changed after purchase", discount: { kind: "FIXED", amountMinor: 100 } } });
    await mongoose.connection.transaction(async session => {
      const saved = await Payment.findById(payment._id).session(session);
      saved.status = "CAPTURED"; await saved.save({ session });
      await redeemPaymentOffer(saved, session); await redeemPaymentOffer(saved, session);
    });
    assert.equal((await Offer.findById(offer._id)).redemptionCount, 1);
    assert.equal((await Payment.findById(payment._id)).pricingSnapshot.offer.name, base.name);
    assert.equal((await Payment.findById(payment._id)).offerReservationStatus, "REDEEMED");
    results.push("Concurrent limited orders admit one payment, replay reuses it, capture increments once, and immutable discount snapshot survives offer edits");
  } finally { paymentProvider.createPayment = provider; env.RAZORPAY_WEBHOOK_SECRET = webhook; }

  const creative = await Attachment.create({ publicId: nanoid(), ownerId: owner._id, gymId: gym._id, purpose: "AD", objectKey: `isolated/${nanoid()}.png`, originalName: "ad.png", mimeType: "image/png", size: 100, storageProvider: "s3", status: "READY" });
  const adBase = { name: "Visible promotion", description: "Real placement fixture", startsAt: start, endsAt: end, status: "ACTIVE", placements: ["GYM_PROFILE"], audience: { kind: "ALL" }, ctaTarget: "PLANS", ctaLabel: "View plans", creativeAttachmentId: String(creative._id) };
  const ad = (await api("post", "/owner/ads", adBase, 201)).data;
  assert(ad.imageUrl);
  await api("patch", `/owner/ads/${ad.publicId}`, { ...adBase, gymId: String(gyms[1]._id) }, 403);
  await api("post", "/owner/ads", { ...adBase, ctaTarget: "EXTERNAL", ctaUrl: "javascript:alert(1)" }, 422);
  await Advertisement.create([
    { ...adBase, publicId: nanoid(), createdBy: owner._id, gymId: gym._id, name: "Paused", status: "PAUSED" },
    { ...adBase, publicId: nanoid(), createdBy: owner._id, gymId: gym._id, name: "Expired", endsAt: new Date(Date.now() - 1000) },
    { ...adBase, publicId: nanoid(), createdBy: owner._id, gymId: gym._id, name: "Future", startsAt: new Date(Date.now() + 3600000) },
    { ...adBase, publicId: nanoid(), createdBy: owner._id, gymId: gyms[1]._id, name: "Other gym", creativeAttachmentId: undefined },
    { ...adBase, publicId: nanoid(), createdBy: owner._id, gymId: gym._id, name: "Members only", audience: { kind: "GYM_MEMBERS" } },
  ]);
  const publicPath = `/public/promotions/ads?placement=GYM_PROFILE&gymId=${gym.publicId}`;
  const eligible = (await api("get", publicPath, undefined, 200, tokens[1])).data;
  assert.deepEqual(eligible.map((value: any) => value.name).sort(), ["Members only", "Visible promotion"]);
  assert(eligible.every((value: any) => value.href === `/gyms/${gym.slug}#gym-plans`));
  const unrelated = (await api("get", publicPath, undefined, 200, tokens[2])).data;
  assert.deepEqual(unrelated.map((value: any) => value.name), ["Visible promotion"]);
  assert.equal((await api("get", `/public/promotions/ads?placement=EXPLORE&gymId=${gym.publicId}`)).data.length, 0);
  results.push("Ads enforce dates/status/placement/gym/member audience and resolve trusted S3 creative with real plan CTA; unsafe URLs and foreign gym edits rejected");
  return results;
}
