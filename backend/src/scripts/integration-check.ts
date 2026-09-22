import "dotenv/config";
import mongoose from "mongoose";
import assert from "node:assert/strict";
import request from "supertest";
import { createHmac } from "node:crypto";
process.env.NODE_ENV = "test";
process.env.LOG_LEVEL = "silent";
for (const key of [
  "MSG91_AUTH_KEY",
  "MSG91_TEMPLATE_ID",
  "RAZORPAY_KEY_ID",
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "OBJECT_STORAGE_ENDPOINT",
])
  delete process.env[key];
process.env.RAZORPAY_WEBHOOK_SECRET = "isolated-integration-webhook-secret";
const { app } = await import("../app.js");
const { User } = await import("../models/User.js");
const { Gym } = await import("../models/Gym.js");
const { RoleAssignment } = await import("../models/Auth.js");
const { MemberProfile } = await import("../models/Member.js");
const { MembershipPlan, Subscription, Payment, PlanQuote } =
  await import("../models/Commerce.js");
const { Invoice } = await import("../models/Business.js");
const { ClassSession, Notification } = await import("../models/Engagement.js");
const { createSession } = await import("../services/tokenService.js");
const { OWNER_DEFAULT_PERMISSIONS } = await import("../constants/domain.js");
const { maintainRecords } = await import("../services/maintenanceService.js");
const databaseName = `getfit4u_integration_${Date.now()}`;
let checks = 0;
const ok = (condition: unknown, message: string) => {
  assert.ok(condition, message);
  checks++;
};
async function call(
  method: string,
  path: string,
  token?: string,
  body?: unknown,
  status = 200,
) {
  let query = (request(app) as any)
    [method]("/api/v1" + path)
    .set("idempotency-key", crypto.randomUUID());
  if (token) query = query.set("authorization", `Bearer ${token}`);
  if (body !== undefined) query = query.send(body);
  const response = await query;
  assert.equal(
    response.status,
    status,
    `${method} ${path}: ${JSON.stringify(response.body.error || {})}`,
  );
  checks++;
  return response.body;
}
try {
  await mongoose.connect(
    process.env.MONGO_URI || "mongodb://127.0.0.1:27017/getfit4u",
    { dbName: databaseName, serverSelectionTimeoutMS: 10000 },
  );
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
  const signup = await call(
      "post",
      "/auth/register",
      undefined,
      {
        name: "Integration Member",
        email: "member@integration.example",
        phone: "9876501234",
        password: "IntegrationPass123",
      },
      200,
    ),
    memberToken = signup.data.accessToken;
  await call(
    "post",
    "/auth/register",
    undefined,
    {
      name: "Duplicate",
      email: "MEMBER@integration.example",
      password: "IntegrationPass123",
    },
    409,
  );
  await call("post", "/auth/login", undefined, {
    identifier: "9876501234",
    password: "IntegrationPass123",
  });
  const me = await call("get", "/auth/me", memberToken);
  const user = me.data.user;
  await call("patch", "/users/me", memberToken, {
    name: "Updated Member",
    roles: ["ADMIN"],
    profile: { fitnessGoal: "Strength" },
  });
  const profile = await call("get", "/users/me", memberToken);
  ok(
    profile.data.name === "Updated Member" &&
      profile.data.roles.length === 1 &&
      profile.data.roles[0] === "USER",
    "Profile cannot escalate roles",
  );
  await call("get", "/workspace/records/payments", undefined, undefined, 401);
  await call("get", "/workspace/records/users", memberToken, undefined, 403);
  const owner = await User.create({
    publicId: "integration-owner",
    name: "Owner",
    email: "owner@integration.example",
    roles: ["GYM_OWNER"],
    activeRole: "GYM_OWNER",
    status: "ACTIVE",
  });
  const gym = await Gym.create({
    publicId: "integration-gym",
    ownerId: owner._id,
    name: "Integration Fitness",
    slug: "integration-fitness",
    location: { type: "Point", coordinates: [78.34, 17.46] },
    address: { city: "Test City" },
    facilities: ["Strength"],
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    platformSubscriptionStatus: "ACTIVE",
    profileCompleteness: 100,
  });
  const otherGym = await Gym.create({
    publicId: "other-gym",
    ownerId: owner._id,
    name: "Other Fitness",
    slug: "other-fitness",
    location: { type: "Point", coordinates: [79, 18] },
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    platformSubscriptionStatus: "ACTIVE",
    profileCompleteness: 100,
  });
  await RoleAssignment.create({
    userId: owner._id,
    role: "GYM_OWNER",
    gymId: gym._id,
    status: "ACTIVE",
    permissions: OWNER_DEFAULT_PERMISSIONS,
  });
  const ownerToken = (
    await createSession({
      userId: String(owner._id),
      activeRole: "GYM_OWNER",
      activeGymId: String(gym._id),
    })
  ).accessToken;
  const plan = await call(
    "post",
    "/owner/plans",
    ownerToken,
    {
      name: "Monthly",
      code: "MONTHLY",
      durationDays: 30,
      priceMinor: 100000,
      freezeDaysAllowed: 3,
      status: "ACTIVE",
      gymId: String(otherGym._id),
    },
    201,
  );
  ok(
    String(plan.data.gymId) === String(gym._id),
    "Tenant cannot be overridden by request body",
  );
  await call("patch", "/owner/gym", ownerToken, {
    status: "ARCHIVED",
    name: "Integration Fitness",
  });
  ok(
    (await Gym.findById(gym._id)).status === "ACTIVE",
    "Owner cannot alter approval status",
  );
  const found = await call("get", "/public/gyms?q=Integration&maxPrice=100000");
  ok(
    found.data.length === 1 && found.data[0].startingPriceMinor === 100000,
    "Discovery uses actual plans and search",
  );
  const nearby = await call(
    "get",
    "/public/gyms/nearby?lat=17.46&lng=78.34&distanceKm=5",
  );
  ok(
    nearby.data.length === 1 && nearby.meta.total === 1,
    "Geospatial search is paginated",
  );
  await call("get", "/public/gyms/nonexistent", undefined, undefined, 404);
  await call(
    "post",
    "/users/me/favorites/integration-gym",
    memberToken,
    {},
    201,
  );
  ok(
    (await call("get", "/users/me/favorites", memberToken)).data.length === 1,
    "Favorite persisted",
  );
  const member = await MemberProfile.create({
    publicId: "integration-member",
    gymId: gym._id,
    userId: user._id,
    memberCode: "TEST-001",
    status: "ACTIVE",
  });
  await MemberProfile.create({
    publicId: "foreign-member",
    gymId: otherGym._id,
    userId: user._id,
    memberCode: "OTHER-001",
    status: "ACTIVE",
  });
  const sub = await Subscription.create({
    publicId: "integration-sub",
    type: "GYM_MEMBERSHIP",
    userId: user._id,
    gymId: gym._id,
    memberProfileId: member._id,
    planSnapshot: { name: "Monthly", freezeDaysAllowed: 3 },
    status: "ACTIVE",
    startsAt: new Date(Date.now() - 86400000),
    endsAt: new Date(Date.now() + 30 * 86400000),
  });
  member.currentSubscriptionId = sub._id;
  await member.save();
  ok(
    (await call("get", "/workspace/records/members", ownerToken)).data
      .length === 1,
    "Owner list is tenant scoped",
  );
  await call(
    "get",
    "/owner/members/foreign-member",
    ownerToken,
    undefined,
    404,
  );
  const cls = await call(
    "post",
    "/owner/classes",
    ownerToken,
    {
      name: "Strength class",
      category: "STRENGTH",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
      capacity: 2,
      status: "SCHEDULED",
    },
    201,
  );
  const booking = await call(
    "post",
    `/users/classes/${cls.data.publicId}/bookings`,
    memberToken,
    {},
    201,
  );
  await call(
    "post",
    `/users/classes/${cls.data.publicId}/bookings`,
    memberToken,
    {},
    409,
  );
  await call(
    "delete",
    `/users/classes/${cls.data.publicId}/bookings/${booking.data._id}`,
    memberToken,
  );
  await call(
    "post",
    `/users/classes/${cls.data.publicId}/bookings`,
    memberToken,
    {},
    201,
  );
  ok(
    (await ClassSession.findById(cls.data._id)).bookedCount === 1,
    "Rebooking does not corrupt capacity",
  );
  const qr = await call(
    "post",
    "/users/me/attendance/qr",
    memberToken,
    { gymId: String(gym._id) },
    201,
  );
  await call(
    "post",
    "/owner/scanner/check-in",
    ownerToken,
    { qrToken: qr.data.token, source: "QR", scannerId: "web-front-desk" },
    201,
  );
  ok(
    (await call("get", "/workspace/records/attendance", memberToken)).data
      .length === 1,
    "Scanner creates real attendance",
  );
  await call(
    "post",
    "/users/me/reviews",
    memberToken,
    { gymId: gym.publicId, rating: 5, body: "Integration review" },
    201,
  );
  ok(
    (await Gym.findById(gym._id)).rating.count === 1,
    "Review updates gym rating",
  );
  const support = await call(
    "post",
    "/users/me/support-tickets",
    memberToken,
    {
      subject: "Integration support",
      message: "Please help with this integration request",
    },
    201,
  );
  await call(
    "post",
    `/workspace/support/${support.data.publicId}/replies`,
    memberToken,
    { message: "Additional information" },
  );
  await call(
    "post",
    `/workspace/support/${support.data.publicId}/replies`,
    ownerToken,
    { message: "Unauthorized" },
    404,
  );
  const campaign = await call(
    "post",
    "/owner/campaigns",
    ownerToken,
    {
      name: "Notice",
      channel: "IN_APP",
      audience: { status: "ACTIVE" },
      message: "Gym notice",
    },
    201,
  );
  await call(
    "post",
    `/workspace/campaigns/${campaign.data.publicId}/send`,
    ownerToken,
    {},
    202,
  );
  await maintainRecords();
  await maintainRecords();
  ok(
    (await Notification.countDocuments({
      userId: user._id,
      dedupeKey: `campaign:${campaign.data.publicId}`,
    })) === 1,
    "Campaign delivery is persistent and deduplicated",
  );
  await call("post", "/users/me/notifications/read-all", memberToken, {});
  const quote = await call(
    "post",
    "/checkout/quotes",
    memberToken,
    { gymId: String(gym._id), planId: plan.data._id },
    201,
  );
  ok(quote.data.totalMinor === 100000, "Checkout prices come from database");
  await call(
    "post",
    "/checkout/orders",
    memberToken,
    { quoteId: quote.data.publicId },
    503,
  );
  const pendingPayment = await Payment.findOne({ quoteId: quote.data._id });
  assert.ok(pendingPayment, "Order attempt persisted a payment record");
  pendingPayment.providerOrderId = "order_isolated_fixture";
  pendingPayment.status = "PENDING";
  await pendingPayment.save();
  await PlanQuote.deleteOne({ _id: quote.data._id });
  const payload = JSON.stringify({
    event: "payment.captured",
    payload: {
      payment: {
        entity: {
          id: "pay_isolated_fixture",
          status: "captured",
          order_id: pendingPayment.providerOrderId,
          amount: 100000,
          currency: "INR",
          method: "upi",
        },
      },
    },
  });
  const signature = createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET!)
    .update(payload)
    .digest("hex");
  for (const eventId of [
    "capture-fixture",
    "capture-fixture",
    "capture-second-event",
  ]) {
    const response = await request(app)
      .post("/api/v1/webhooks/razorpay")
      .set("content-type", "application/json")
      .set("x-razorpay-signature", signature)
      .set("x-razorpay-event-id", eventId)
      .send(payload);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    checks++;
  }
  ok(
    (await Invoice.countDocuments({ paymentId: pendingPayment._id })) === 1,
    "Repeated signed capture creates one invoice even after quote expiry",
  );
  const renewed = await Subscription.findOne({
    latestPaymentId: pendingPayment._id,
  });
  ok(
    renewed && renewed.startsAt.getTime() === sub.endsAt.getTime(),
    "Early renewal preserves paid membership time",
  );
  // First-time member join: gateway responses are simulated, with real database writes.
  const { paymentProvider } = await import("../integrations/payments/index.js");
  const priorCreate = paymentProvider.createPayment,
    priorStatus = paymentProvider.getPaymentStatus,
    priorVerify = paymentProvider.verifyCheckout;
  const newUser = await User.create({
    publicId: "first-join-user",
    name: "First Join",
    roles: ["USER"],
    status: "ACTIVE",
  });
  const firstSession = await createSession({
    userId: String(newUser._id),
    activeRole: "USER",
  });
  let gatewayStatus = "failed";
  paymentProvider.createPayment = async () =>
    ({
      id: "order_first_join",
      amount: 100000,
      currency: "INR",
      status: "created",
    }) as any;
  paymentProvider.verifyCheckout = ({ signature }) =>
    signature === "valid-signature-for-first-join-check";
  paymentProvider.getPaymentStatus = async () =>
    ({
      id: "pay_first_join",
      order_id: "order_first_join",
      amount: 100000,
      currency: "INR",
      status: gatewayStatus,
    }) as any;
  try {
    const firstQuote = await call(
      "post",
      "/checkout/quotes",
      firstSession.accessToken,
      { gymId: String(gym._id), planId: plan.data._id },
      201,
    );
    const firstOrder = await call(
      "post",
      "/checkout/orders",
      firstSession.accessToken,
      { quoteId: firstQuote.data.publicId },
      201,
    );
    ok(
      (await MemberProfile.countDocuments({ userId: newUser._id })) === 0,
      "Selecting and ordering a plan does not enroll an unpaid user",
    );
    const verifyBody = {
      paymentId: firstOrder.data.paymentId,
      providerOrderId: "order_first_join",
      providerPaymentId: "pay_first_join",
      signature: "invalid-signature-for-first-join-check",
    };
    await call(
      "post",
      "/checkout/verify",
      firstSession.accessToken,
      verifyBody,
      401,
    );
    verifyBody.signature = "valid-signature-for-first-join-check";
    await call(
      "post",
      "/checkout/verify",
      firstSession.accessToken,
      verifyBody,
    );
    ok(
      (await Subscription.countDocuments({ userId: newUser._id })) === 0,
      "Failed payment creates no membership",
    );
    const retryOrder = await call(
      "post",
      "/checkout/orders",
      firstSession.accessToken,
      { quoteId: firstQuote.data.publicId },
      201,
    );
    ok(
      retryOrder.data.paymentId === firstOrder.data.paymentId,
      "Member payment retry reuses the same order",
    );
    gatewayStatus = "captured";
    await call(
      "post",
      "/checkout/verify",
      firstSession.accessToken,
      verifyBody,
    );
    await call(
      "post",
      "/checkout/verify",
      firstSession.accessToken,
      verifyBody,
    );
    const joined = await MemberProfile.findOne({
      userId: newUser._id,
      gymId: gym._id,
    });
    const joinedSubscription = await Subscription.findOne({
      userId: newUser._id,
      gymId: gym._id,
    });
    ok(
      joined &&
        joined.status === "ACTIVE" &&
        String(joined.currentSubscriptionId) ===
          String(joinedSubscription!._id),
      "Verified payment enrolls the member in the selected gym",
    );
    ok(
      joinedSubscription!.status === "ACTIVE" &&
        (await Subscription.countDocuments({ userId: newUser._id })) === 1,
      "Duplicate verification creates exactly one active membership",
    );
    ok(
      (await Invoice.countDocuments({
        subscriptionId: joinedSubscription!._id,
      })) === 1,
      "Verified join creates one invoice",
    );
    const ownerMembers = await call("get", "/owner/members", ownerToken);
    ok(
      ownerMembers.data.some((m: any) => m.publicId === joined!.publicId),
      "The new member appears in the owner's member list",
    );
    const memberSubscriptions = await call(
      "get",
      "/workspace/records/subscriptions",
      firstSession.accessToken,
    );
    ok(
      memberSubscriptions.data.some(
        (v: any) => v.publicId === joinedSubscription!.publicId,
      ),
      "The paid membership appears in the user's subscriptions",
    );
    await Gym.updateOne(
      { _id: gym._id },
      { $set: { platformSubscriptionStatus: "NONE" } },
    );
    await call("get", `/public/gyms/${gym.slug}`, undefined, undefined, 404);
    await call(
      "post",
      "/checkout/quotes",
      firstSession.accessToken,
      { gymId: String(gym._id), planId: plan.data._id },
      404,
    );
    await Gym.updateOne(
      { _id: gym._id },
      { $set: { platformSubscriptionStatus: "ACTIVE" } },
    );
  } finally {
    paymentProvider.createPayment = priorCreate;
    paymentProvider.getPaymentStatus = priorStatus;
    paymentProvider.verifyCheckout = priorVerify;
  }
  const signupOwner = await call(
    "post",
    "/owner/registrations",
    memberToken,
    { name: "New Gym", coordinates: [78, 17], address: { city: "Test" } },
    201,
  );
  ok(!!signupOwner.data.registration, "Members can start owner onboarding");
  await call(
    "post",
    `/owner/registrations/${signupOwner.data.registration.publicId}/submit`,
    memberToken,
    {},
    422,
  );
  await call("post", "/auth/switch-role", memberToken, { role: "ADMIN" }, 403);
  const admin = await User.create({
    publicId: "test-admin",
    roles: ["ADMIN"],
    activeRole: "ADMIN",
    status: "ACTIVE",
  });
  const adminToken = (
    await createSession({ userId: String(admin._id), activeRole: "ADMIN" })
  ).accessToken;
  await call("get", "/admin/dashboard", adminToken);
  await call("get", "/workspace/records/users", adminToken);
  await call("get", "/admin/monitoring/health", adminToken);
  await call(
    "post",
    `/admin/registrations/${signupOwner.data.registration.publicId}/review`,
    adminToken,
    { decision: "APPROVED", notes: "Obsolete route cannot bypass payment" },
    404,
  );
  const trainerSignup = await call("post", "/auth/register", undefined, {
    name: "Test Trainer",
    email: "trainer@integration.example",
    password: "IntegrationPass123",
  });
  const trainer = await call(
    "post",
    "/owner/trainers",
    ownerToken,
    {
      name: "Test Trainer",
      email: "trainer@integration.example",
      status: "ACTIVE",
    },
    201,
  );
  const switched = await call(
    "post",
    "/auth/switch-role",
    trainerSignup.data.accessToken,
    { role: "TRAINER", gymId: String(gym._id) },
  );
  const trainerToken = switched.data.accessToken;
  await call("patch", "/workspace/members/integration-member", ownerToken, {
    assignedTrainerId: trainer.data._id,
  });
  const assignedClients = await call(
    "get",
    "/workspace/records/members",
    trainerToken,
  );
  ok(
    assignedClients.data.length === 1 &&
      !assignedClients.data[0].currentSubscriptionId?.planSnapshot,
    "Trainer sees assigned clients without financial snapshots",
  );
  await call(
    "get",
    "/workspace/records/payments",
    trainerToken,
    undefined,
    403,
  );
  const workout = await call(
    "post",
    "/trainer/workout-plans",
    trainerToken,
    {
      name: "Strength basics",
      status: "ACTIVE",
      exercises: [{ name: "Bodyweight squat", sets: 3, reps: "8" }],
    },
    201,
  );
  await call(
    "post",
    "/trainer/clients/integration-member/workout-assignments",
    trainerToken,
    {
      workoutPlanId: workout.data.publicId,
      startsAt: new Date().toISOString(),
    },
    201,
  );
  await call(
    "post",
    "/trainer/clients/integration-member/progress",
    trainerToken,
    { weightKg: 70, notes: "Test progress" },
    201,
  );
  await call(
    "post",
    "/trainer/clients/foreign-member/progress",
    trainerToken,
    { weightKg: 70 },
    404,
  );
  ok(
    (await call("get", "/workspace/records/progress", memberToken)).data
      .length === 1,
    "Member progress comes from trainer records",
  );
  const otp = await call(
    "post",
    "/auth/otp/request",
    undefined,
    { phone: "9876509999", purpose: "LOGIN" },
    202,
  );
  await call("post", "/auth/otp/verify", undefined, {
    challengeId: otp.data.challengeId,
    code: otp.data.devOtp,
  });
  await call(
    "post",
    "/auth/otp/verify",
    undefined,
    { challengeId: otp.data.challengeId, code: otp.data.devOtp },
    400,
  );
  const notices = await call(
    "get",
    "/users/me/notifications?page=1&limit=1",
    memberToken,
  );
  ok(
    notices.data.length === 1 && notices.meta.total >= 3,
    "Notifications paginate beyond one page without dedupe collisions",
  );
  ok(
    (
      await call(
        "get",
        "/workspace/records/favorites?q=Integration",
        memberToken,
      )
    ).data.length === 1,
    "Search resolves referenced gym names",
  );
  ok(
    (await call("get", "/workspace/records/members?q=Updated", ownerToken)).data
      .length === 1,
    "Member search remains tenant scoped",
  );
  console.log(
    `PASS: ${checks} integration checks against an isolated MongoDB database.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Integration failed");
  process.exitCode = 1;
} finally {
  if (
    mongoose.connection.readyState === 1 &&
    mongoose.connection.name === databaseName &&
    /^getfit4u_integration_\d+$/.test(databaseName)
  ) {
    await mongoose.connection.dropDatabase();
    console.log("Temporary integration database removed.");
  }
  await mongoose.disconnect();
}
