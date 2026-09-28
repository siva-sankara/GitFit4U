import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { RoleAssignment } from "../models/Auth.js";
import {
  PlatformPlan,
  PlanQuote,
  Payment,
  Subscription,
} from "../models/Commerce.js";
import { Follow, SocialStory } from "../models/Social.js";
import { ClassSession } from "../models/Engagement.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { createSession } from "../services/tokenService.js";
import {
  activatePlatformRenewal,
  platformRenewalQuote,
  validatePlatformRenewalOrder,
} from "../services/platformRenewalService.js";

// This helper runs ONLY inside the guarded temporary database smoke test.
// Payments are synthetic fixtures; no gateway or messaging provider is invoked.
export async function checkProductEnhancements() {
  assert.match(mongoose.connection.db!.databaseName, /^gfv_[a-f0-9]{32}$/);
  const results: string[] = [];
  const owner = await User.create({
    publicId: nanoid(),
    name: "Enhancement owner",
    email: `${nanoid()}@verification.invalid`,
    roles: ["GYM_OWNER"],
    activeRole: "GYM_OWNER",
    status: "ACTIVE",
  });
  const viewer = await User.create({
    publicId: nanoid(),
    name: "Enhancement viewer",
    email: `${nanoid()}@verification.invalid`,
    roles: ["USER"],
    activeRole: "USER",
    status: "ACTIVE",
  });
  const gym = await Gym.create({
    publicId: nanoid(),
    ownerId: owner._id,
    name: "Enhancement gym",
    slug: nanoid().toLowerCase(),
    location: { type: "Point", coordinates: [77, 12] },
    timezone: "Asia/Kolkata",
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    platformSubscriptionStatus: "ACTIVE",
  });
  await RoleAssignment.create({
    userId: owner._id,
    role: "GYM_OWNER",
    gymId: gym._id,
    permissions: OWNER_DEFAULT_PERMISSIONS,
    status: "ACTIVE",
  });
  const ownerSession = await createSession({
    userId: String(owner._id),
    activeRole: "GYM_OWNER",
    activeGymId: String(gym._id),
  });
  const viewerSession = await createSession({
    userId: String(viewer._id),
    activeRole: "USER",
  });
  async function api(
    method: "get" | "post" | "patch" | "delete",
    path: string,
    token: string,
    body?: object,
    expected = 200,
  ) {
    const client = request(app);
    const operation = client[method]("/api/v1" + path)
      .set("Authorization", `Bearer ${token}`)
      .set("idempotency-key", nanoid())
      .set("x-csrf-protection", "1");
    const response = await (body ? operation.send(body) : operation);
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${response.body?.error?.code || response.status}`,
    );
    return response.body.data;
  }
  const ot = ownerSession.accessToken,
    vt = viewerSession.accessToken;
  await api("patch", "/owner/gym/terms", ot, {
    text: "Stay safe.\r\nRespect other members.",
  });
  assert.equal(
    (await Gym.findById(gym._id))?.terms.text,
    "Stay safe.\nRespect other members.",
  );
  await api(
    "patch",
    "/owner/gym/terms",
    vt,
    { text: "Unauthorized edit" },
    403,
  );
  await api(
    "patch",
    "/owner/gym/terms",
    ot,
    { text: "Changed", updatedBy: viewer._id },
    422,
  );
  results.push(
    "Gym terms persist as plain text with server-side owner permission and actor protection",
  );

  const start = new Date(Date.now() + 3 * 86400000),
    end = new Date(start.getTime() + 3600000);
  const invalid = await request(app)
    .post("/api/v1/owner/classes")
    .set("Authorization", `Bearer ${ot}`)
    .send({
      name: "Safe class",
      category: "YOGA",
      startsAt: end,
      endsAt: start,
      capacity: 12,
      room: "",
      trainerId: null,
    });
  assert.equal(invalid.status, 422);
  assert(invalid.body.error.details.fieldErrors.endsAt?.length);
  const session = await api(
    "post",
    "/owner/classes",
    ot,
    {
      name: "Safe class",
      category: "YOGA",
      startsAt: start,
      endsAt: end,
      capacity: 12,
      room: "",
      trainerId: null,
    },
    201,
  );
  await api("post", `/owner/classes/${session.publicId}/cancel`, ot, {
    reason: "Verification cancellation",
  });
  assert.equal(
    (await ClassSession.findOne({ publicId: session.publicId }))?.status,
    "CANCELLED",
  );
  results.push(
    "Class API accepts blank optional fields, reports invalid times on endsAt, and cancels safely",
  );

  const privateView = await api(
    "get",
    `/social/profiles/${owner.publicId}`,
    vt,
  );
  assert.equal(privateView.canView, false);
  assert.equal(privateView.phone, undefined);
  await api(
    "get",
    `/social/profiles/${owner.publicId}/posts`,
    vt,
    undefined,
    403,
  );
  await api("patch", "/users/me", ot, {
    social: { visibility: "PUBLIC", bio: "Fitness is for everyone" },
  });
  await api("post", `/social/profiles/${owner.publicId}/follow`, vt, {}, 200);
  await api("post", `/social/profiles/${owner.publicId}/follow`, vt, {}, 200);
  assert.equal(
    await Follow.countDocuments({
      followerId: viewer._id,
      followingId: owner._id,
    }),
    1,
  );
  const post = await api(
    "post",
    "/social/posts",
    ot,
    { text: "Today's workout", attachmentIds: [] },
    201,
  );
  await api(
    "patch",
    `/social/posts/${post.publicId}`,
    vt,
    { text: "Unauthorized", attachmentIds: [] },
    404,
  );
  const story = await api(
    "post",
    "/social/stories",
    ot,
    { text: "Recovery day", attachmentIds: [] },
    201,
  );
  const storedStory = await SocialStory.findOne({ publicId: story.publicId });
  assert.equal(
    storedStory.expiresAt.getTime() - storedStory.createdAt.getTime(),
    25 * 3600000,
  );
  await SocialStory.updateOne(
    { _id: storedStory._id },
    { $set: { expiresAt: new Date(Date.now() - 1000) } },
  );
  const visibleStories = await api(
    "get",
    `/social/profiles/${owner.publicId}/stories`,
    vt,
  );
  assert.equal(visibleStories.length, 0);
  await api("delete", `/social/posts/${post.publicId}`, vt, undefined, 404);
  await api("delete", `/social/posts/${post.publicId}`, ot, undefined, 204);
  await api("delete", `/social/profiles/${owner.publicId}/follow`, vt);
  assert.equal(
    await Follow.countDocuments({
      followerId: viewer._id,
      followingId: owner._id,
    }),
    0,
  );
  await api("patch", "/users/me", ot, { phone: "+12025559999" }, 422);
  results.push(
    "Social privacy, follow idempotency, content ownership, verified-contact gate, and exact 25-hour story expiry are enforced",
  );

  const plan = await PlatformPlan.create({
    code: nanoid(),
    name: "Verification platform",
    billingPeriod: "MONTHLY",
    priceMinor: 10000,
    memberLimit: 30,
    staffLimit: 4,
    features: ["Member management"],
  });
  const previous = await Subscription.create({
    publicId: nanoid(),
    type: "PLATFORM",
    userId: owner._id,
    gymId: gym._id,
    status: "ACTIVE",
    startsAt: new Date(),
    endsAt: new Date(Date.now() + 86400000 * 5),
    planSnapshot: { name: "Existing platform", type: "PLATFORM" },
  });
  await api(
    "post",
    "/checkout/platform/quotes",
    vt,
    { renewal: true, planId: String(plan._id) },
    403,
  );
  const quote = await platformRenewalQuote(
    String(owner._id),
    String(gym._id),
    String(plan._id),
  );
  const repeated = await platformRenewalQuote(
    String(owner._id),
    String(gym._id),
    String(plan._id),
  );
  assert.equal(String(quote._id), String(repeated._id));
  await mongoose.connection.transaction((dbSession) =>
    validatePlatformRenewalOrder(quote, String(owner._id), dbSession),
  );
  const payment = await Payment.create({
    publicId: nanoid(),
    purpose: "PLATFORM_PLAN",
    payerId: owner._id,
    gymId: gym._id,
    quoteId: quote._id,
    amountMinor: quote.totalMinor,
    provider: "OFFLINE",
    status: "CAPTURED",
    capturedAt: new Date(),
    metadata: { verificationOnly: true },
  });
  const renewed = await mongoose.connection.transaction((dbSession) =>
    activatePlatformRenewal(payment, quote, dbSession),
  );
  assert.equal(
    renewed.endsAt.getTime(),
    previous.endsAt.getTime() + 30 * 86400000,
  );
  assert.equal(
    (await Subscription.findById(previous._id))?.status,
    "CANCELLED",
  );
  assert.equal(
    String((await Payment.findById(payment._id))?.subscriptionId),
    String(renewed._id),
  );
  assert.equal(
    await Subscription.countDocuments({
      gymId: gym._id,
      type: "PLATFORM",
      status: "ACTIVE",
    }),
    1,
  );
  await Gym.updateOne({ _id: gym._id }, { $set: { status: "SUSPENDED" } });
  await assert.rejects(
    platformRenewalQuote(String(owner._id), String(gym._id), String(plan._id)),
    /owner/,
  );
  assert.equal(await PlanQuote.countDocuments({ gymId: gym._id }), 1);
  results.push(
    "Platform renewal quotes are role-scoped and reused; activation preserves unused days, links payment, and retains history without overriding suspension",
  );
  return results;
}
