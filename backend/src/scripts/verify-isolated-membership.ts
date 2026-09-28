import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { env } from "../config/env.js";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { RoleAssignment, Session } from "../models/Auth.js";
import { MemberProfile } from "../models/Member.js";
import { MembershipPlan, Payment, Subscription } from "../models/Commerce.js";
import { AttendanceEvent } from "../models/Attendance.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { createSession } from "../services/tokenService.js";
import { Attachment, Refund } from "../models/Business.js";
import {
  Campaign,
  Notification,
  Review,
  SupportTicket,
} from "../models/Engagement.js";
import { Conversation, Message } from "../models/Collaboration.js";
import { deliverCampaignBatch } from "../services/campaignDeliveryService.js";
import { logger } from "../config/logger.js";
import { checkProductEnhancements } from "./check-product-enhancements.js";
import { checkSocialProfileRegressions } from "./check-social-profile-regressions.js";
import { checkOwnerRegressions } from "./check-owner-regressions.js";
import { checkReviewMediaRegressions } from "./check-review-media-regressions.js";
import { checkNotificationEnhancements } from "./check-notification-enhancements.js";
import { checkMembershipStreakEnhancements } from "./check-membership-streak-enhancements.js";
import { checkPromotionRegressions } from "./check-promotion-regressions.js";
import { prepareImage } from "../services/imageProcessingService.js";
import { attachmentUrl } from "../integrations/storage/mediaStore.js";

logger.level = "warn";
mongoose.set("strictQuery", true);

if (!process.argv.includes("--run-isolated"))
  throw new Error(
    "Explicit --run-isolated is required. This check creates and removes a temporary verification database.",
  );
const runId = randomUUID().replaceAll("-", "");
const databaseName = `gfv_${runId}`;
const databasePattern = /^gfv_[a-f0-9]{32}$/;
const verifyMedia = process.argv.includes("--verify-media");
type VerificationMedia = {
  publicId: string;
  attachmentId: string;
  objectKey: string;
  gymId: string;
  ownerId: string;
  ownerToken: string;
  provider: string;
  removed: boolean;
};
const createdMedia: VerificationMedia[] = [];
let ownsDatabase = false;
const results: string[] = [];
function assertDatabase() {
  assert(databasePattern.test(databaseName));
  assert.equal(
    mongoose.connection.db?.databaseName,
    databaseName,
    "Refusing to use any database except the newly generated verification database.",
  );
}
async function createUser(
  name: string,
  role: "USER" | "GYM_OWNER" | "ADMIN" = "USER",
  phone?: string,
) {
  return User.create({
    publicId: nanoid(18),
    name,
    email: `${nanoid(10)}@verification.invalid`,
    ...(phone ? { phone } : {}),
    roles: [role],
    activeRole: role,
    status: "ACTIVE",
  });
}
async function createGym(owner: any, name: string) {
  const gym = await Gym.create({
    publicId: nanoid(18),
    ownerId: owner._id,
    name,
    slug: nanoid(20).toLowerCase(),
    location: { type: "Point", coordinates: [77.5946, 12.9716] },
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    platformSubscriptionStatus: "ACTIVE",
    timezone: "Asia/Kolkata",
  });
  await RoleAssignment.create({
    userId: owner._id,
    gymId: gym._id,
    role: "GYM_OWNER",
    permissions: OWNER_DEFAULT_PERMISSIONS,
    status: "ACTIVE",
  });
  return gym;
}
async function token(
  user: any,
  role: "USER" | "GYM_OWNER" | "ADMIN",
  gym?: any,
) {
  return (
    await createSession({
      userId: String(user._id),
      activeRole: role,
      activeGymId: gym ? String(gym._id) : undefined,
    })
  ).accessToken;
}
async function call(
  method: "get" | "post" | "patch" | "delete",
  path: string,
  auth: string,
  body?: object,
) {
  const agent = request(app);
  const operation = agent[method](path)
    .set("authorization", `Bearer ${auth}`)
    .set("idempotency-key", randomUUID())
    .set("x-csrf-protection", "1");
  return body ? operation.send(body) : operation;
}
function status(response: { status: number; body: any }, expected: number) {
  assert.equal(
    response.status,
    expected,
    `Expected ${expected}; got ${response.status}: ${response.body?.error?.code || "unknown"} ${response.body?.error?.message || ""}`,
  );
}

async function removeCreatedMedia(media: VerificationMedia) {
  assertDatabase();
  assert(
    createdMedia.includes(media),
    "Refusing to delete media not initiated by this verification run.",
  );
  assert.equal(
    media.objectKey,
    `gyms/${media.gymId}/gym_logo/${media.publicId}.png`,
  );
  const attachment = await Attachment.findOne({
    publicId: media.publicId,
    _id: media.attachmentId,
    ownerId: media.ownerId,
    gymId: media.gymId,
    objectKey: media.objectKey,
  });
  assert(
    attachment,
    "Refusing media cleanup without its exact run-owned attachment record.",
  );
  if (attachment.status === "DELETED") {
    media.removed = true;
    return;
  }
  const response = await call(
    "delete",
    `/api/v1/uploads/${media.publicId}`,
    media.ownerToken,
  );
  status(response, 204);
  media.removed = true;
}

async function verifyGymMedia(
  gym: any,
  owner: any,
  ownerToken: string,
  otherToken: string,
) {
  // CRC-checked valid 1x1 PNG; no local user media is read or uploaded.
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const processed = await prepareImage(png, "image/png");
  async function upload(name: string) {
    assertDatabase();
    const initiated = await call("post", "/api/v1/uploads", ownerToken, {
      name,
      mimeType: "image/png",
      size: png.length,
      purpose: "GYM_LOGO",
    });
    status(initiated, 201);
    const file = initiated.body.data.attachment;
    assert.equal(String(file.gymId), String(gym._id));
    assert.equal(String(file.ownerId), String(owner._id));
    assert.equal(
      file.objectKey,
      `gyms/${gym._id}/gym_logo/${file.publicId}.png`,
    );
    assert.equal(
      initiated.body.data.uploadUrl,
      `/api/v1/uploads/${file.publicId}/bytes`,
    );
    const media: VerificationMedia = {
      publicId: file.publicId,
      attachmentId: String(file._id),
      objectKey: file.objectKey,
      gymId: String(gym._id),
      ownerId: String(owner._id),
      ownerToken,
      provider: file.storageProvider,
      removed: false,
    };
    createdMedia.push(media);
    const uploaded = await request(app)
      .put(initiated.body.data.uploadUrl)
      .set("authorization", `Bearer ${ownerToken}`)
      .set("Content-Type", "image/png")
      .send(png);
    status(uploaded, 200);
    const completed = await call(
      "post",
      `/api/v1/uploads/${file.publicId}/complete`,
      ownerToken,
      {},
    );
    status(completed, 200);
    assert.equal(completed.body.data.status, "READY");
    assert.equal(completed.body.data._id, file._id);
    const ready = await Attachment.findById(file._id).lean();
    assert.equal(ready.thumbnailObjectKey, `${file.objectKey}.thumb.webp`);
    const thumbnail = await fetch(attachmentUrl(ready, true), { signal: AbortSignal.timeout(20000) });
    assert.equal(thumbnail.status, 200);
    assert(Buffer.from(await thumbnail.arrayBuffer()).equals(processed.thumbnail));
    assert.equal(
      (await Attachment.findById(file._id))?.objectKey,
      file.objectKey,
    );
    return media;
  }
  async function verifyLogoRead(media: VerificationMedia) {
    const ownerRead = await call("get", "/api/v1/owner/gym", ownerToken);
    status(ownerRead, 200);
    const publicRead = await request(app).get(
      `/api/v1/public/gyms/${gym.slug}`,
    );
    status(publicRead, 200);
    for (const data of [ownerRead.body.data, publicRead.body.data.gym]) {
      assert.equal(String(data.logoAttachmentId), media.attachmentId);
      assert.equal(data.logo?.attachmentId, media.attachmentId);
      assert.equal(new URL(data.logoUrl).protocol, "https:");
      const image = await fetch(data.logoUrl, {
        signal: AbortSignal.timeout(20000),
      });
      assert.equal(
        image.status,
        200,
        "The resolved logo URL must return the uploaded image.",
      );
      assert.equal(
        image.headers.get("content-type")?.split(";")[0],
        "image/png",
      );
      const received = Buffer.from(await image.arrayBuffer());
      assert(
        received.subarray(0, 8).equals(png.subarray(0, 8)),
        "Resolved image must retain a valid PNG signature.",
      );
      if (media.provider === "s3")
        assert(
          received.equals(processed.original),
          "S3 download bytes must match the validated, metadata-stripped image.",
        );
    }
  }
  const first = await upload("isolated-verification-logo.png");
  status(
    await call("patch", "/api/v1/owner/gym", ownerToken, {
      logoAttachmentId: first.attachmentId,
    }),
    200,
  );
  await verifyLogoRead(first);
  status(
    await call("patch", "/api/v1/owner/gym", otherToken, {
      logoAttachmentId: first.attachmentId,
    }),
    422,
  );
  status(
    await call("delete", `/api/v1/uploads/${first.publicId}`, otherToken),
    404,
  );
  status(
    await call("delete", `/api/v1/uploads/${first.publicId}`, ownerToken),
    409,
  );
  const replacement = await upload(
    "isolated-verification-logo-replacement.png",
  );
  status(
    await call("patch", "/api/v1/owner/gym", ownerToken, {
      logoAttachmentId: replacement.attachmentId,
    }),
    200,
  );
  await verifyLogoRead(replacement);
  await removeCreatedMedia(first);
  status(
    await call("patch", "/api/v1/owner/gym", ownerToken, {
      logoAttachmentId: null,
    }),
    200,
  );
  const cleared = await call("get", "/api/v1/owner/gym", ownerToken);
  status(cleared, 200);
  assert.equal(cleared.body.data.logoUrl, null);
  assert.equal(cleared.body.data.logo, null);
  await removeCreatedMedia(replacement);
  results.push(
    `Real ${first.provider} logo upload, byte validation, persistence, owner/public image reads, replacement, tenant rejection and removal verified`,
  );
}
try {
  // dbName overrides the URI's database without altering the configured URI.
  // Disable automatic collection creation until emptiness is checked.
  await mongoose.connect(env.MONGO_URI, {
    dbName: databaseName,
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 15000,
  });
  assertDatabase();
  const collections = await mongoose.connection
    .db!.listCollections({}, { nameOnly: true })
    .toArray();
  assert.equal(
    collections.length,
    0,
    "The generated database must be empty before verification.",
  );
  await mongoose.connection
    .db!.collection("verification_run")
    .insertOne({ runId, createdAt: new Date() });
  ownsDatabase = true;
  for (const model of Object.values(mongoose.models))
    await model.createIndexes();

  const owner = await createUser("Verification Owner", "GYM_OWNER");
  const otherOwner = await createUser("Other Verification Owner", "GYM_OWNER");
  const admin = await createUser("Verification Administrator", "ADMIN");
  const member = await createUser(
    "Verification Member",
    "USER",
    "+12025550191",
  );
  const joiner = await createUser(
    "Verification Joiner",
    "USER",
    "+12025550192",
  );
  const gym = await createGym(owner, "Verification Gym");
  const otherGym = await createGym(otherOwner, "Other Verification Gym");
  const freeGym = await createGym(owner, "Plan-free Verification Gym");
  const ownerToken = await token(owner, "GYM_OWNER", gym);
  const otherToken = await token(otherOwner, "GYM_OWNER", otherGym);
  const freeOwnerToken = await token(owner, "GYM_OWNER", freeGym);
  const memberToken = await token(member, "USER");
  const joinerToken = await token(joiner, "USER");
  const adminToken = await token(admin, "ADMIN");
  if (verifyMedia) await verifyGymMedia(gym, owner, ownerToken, otherToken);
  const plan = await MembershipPlan.create({
    publicId: nanoid(18),
    gymId: gym._id,
    code: "VERIFY_MONTH",
    name: "Verification Monthly",
    durationDays: 30,
    priceMinor: 100000,
    discountMinor: 10000,
    taxRateBasisPoints: 1800,
    freezeDaysAllowed: 10,
    status: "ACTIVE",
  });
  const startsAt = new Date(Date.now() - 86400000),
    paidAt = new Date(Date.now() - 60000);
  const body = {
    name: member.name,
    email: member.email,
    phone: member.phone,
    planId: plan.publicId,
    startsAt,
    payment: {
      amountMinor: 106200,
      method: "CASH",
      paidAt,
      reference: "ISOLATED-VERIFICATION",
    },
  };
  const mismatch = await call("post", "/api/v1/owner/members", ownerToken, {
    ...body,
    payment: { ...body.payment, amountMinor: 1 },
  });
  status(mismatch, 409);
  assert.equal(
    await MemberProfile.countDocuments({ gymId: gym._id, userId: member._id }),
    0,
  );
  assert.equal(await Payment.countDocuments({ gymId: gym._id }), 0);
  results.push("Invalid payment leaves no partial membership or payment");

  const created = await call("post", "/api/v1/owner/members", ownerToken, body);
  status(created, 201);
  const memberId = created.body.data.member.publicId,
    subscriptionId = created.body.data.subscription.publicId;
  assert.equal(created.body.data.payment.provider, "OFFLINE");
  assert.equal(created.body.data.payment.status, "CAPTURED");
  assert.equal(created.body.data.payment.amountMinor, 106200);
  assert.equal(await Payment.countDocuments({ gymId: gym._id }), 1);
  const initialEnd = Date.parse(created.body.data.subscription.endsAt);
  assert.equal(initialEnd, startsAt.getTime() + 30 * 86400000);
  results.push(
    "Offline member, plan subscription and captured payment are linked correctly",
  );

  status(
    await call("get", `/api/v1/owner/members/${memberId}`, otherToken),
    404,
  );
  status(
    await call("patch", `/api/v1/owner/members/${memberId}`, otherToken, {
      name: "Forbidden edit",
    }),
    404,
  );
  assert.notEqual(
    (await MemberProfile.findOne({ publicId: memberId }))?.contact?.name,
    "Forbidden edit",
  );
  results.push("Cross-tenant member read and update are denied");

  const qr = await call("get", "/api/v1/owner/attendance/qr", ownerToken);
  status(qr, 200);
  const repeatedQr = await call(
    "get",
    "/api/v1/owner/attendance/qr",
    ownerToken,
  );
  assert.equal(repeatedQr.body.data.token, qr.body.data.token);
  const freeze = await call(
    "post",
    `/api/v1/users/me/subscriptions/${subscriptionId}/freeze`,
    memberToken,
    {
      endsAt: new Date(Date.now() + 3 * 86400000),
      reason: "Verification freeze",
    },
  );
  status(freeze, 200);
  assert.equal(freeze.body.data.status, "FROZEN");
  assert.equal(Date.parse(freeze.body.data.endsAt), initialEnd + 3 * 86400000);
  status(
    await call("post", "/api/v1/users/me/attendance/check-in", memberToken, {
      qrToken: qr.body.data.token,
    }),
    409,
  );
  const resumed = await call(
    "post",
    `/api/v1/users/me/subscriptions/${subscriptionId}/reactivate`,
    memberToken,
    { reason: "Verification resume" },
  );
  status(resumed, 200);
  assert.equal(resumed.body.data.status, "ACTIVE");
  assert(Date.parse(resumed.body.data.endsAt) <= initialEnd + 86400000);
  assert(Date.parse(resumed.body.data.endsAt) >= initialEnd);
  results.push(
    "Freeze blocks attendance and reactivation returns unused freeze days",
  );

  const concurrent = await Promise.all([
    call("post", "/api/v1/users/me/attendance/check-in", memberToken, {
      qrToken: qr.body.data.token,
    }),
    call("post", "/api/v1/users/me/attendance/check-in", memberToken, {
      qrToken: qr.body.data.token,
    }),
  ]);
  assert(
    concurrent.every((response) => [200, 201].includes(response.status)),
    JSON.stringify(
      concurrent.map((response) => ({
        status: response.status,
        error: response.body.error,
      })),
    ),
  );
  assert.equal(
    concurrent.filter((response) => response.body.data.duplicate === false)
      .length,
    1,
  );
  assert.equal(
    await AttendanceEvent.countDocuments({
      gymId: gym._id,
      userId: member._id,
      type: "CHECK_IN",
    }),
    1,
  );
  status(
    await call("post", "/api/v1/users/me/attendance/check-in", joinerToken, {
      qrToken: qr.body.data.token,
      memberIdentifier: memberId,
    }),
    403,
  );
  const rotated = await call(
    "post",
    "/api/v1/owner/attendance/qr/rotate",
    ownerToken,
    {},
  );
  status(rotated, 200);
  status(
    await call("post", "/api/v1/users/me/attendance/check-in", memberToken, {
      qrToken: qr.body.data.token,
    }),
    410,
  );
  status(
    await call("post", "/api/v1/users/me/attendance/qr", memberToken, {
      gymId: String(gym._id),
    }),
    410,
  );
  results.push(
    "Persistent gym QR, authenticated ownership, concurrent duplicate prevention and QR revocation verified",
  );

  const joined = await call(
    "post",
    "/api/v1/users/me/gym-join-requests",
    joinerToken,
    { gymId: freeGym.publicId },
  );
  status(joined, 201);
  assert.equal(joined.body.data.status, "JOIN_REQUESTED");
  const approved = await call(
    "post",
    `/api/v1/owner/members/${joined.body.data.publicId}/join/approve`,
    freeOwnerToken,
    {},
  );
  status(approved, 200);
  assert.equal(approved.body.data.directAccess, true);
  const freeQr = await call(
    "get",
    "/api/v1/owner/attendance/qr",
    freeOwnerToken,
  );
  status(freeQr, 200);
  status(
    await call("post", "/api/v1/users/me/attendance/check-in", joinerToken, {
      qrToken: freeQr.body.data.token,
    }),
    201,
  );
  assert.equal(await Subscription.countDocuments({ gymId: freeGym._id }), 0);
  assert.equal(await Payment.countDocuments({ gymId: freeGym._id }), 0);
  results.push(
    "Plan-free join approval grants attendance without inventing a paid plan or transaction",
  );

  // These are ledger fixtures only. No payment provider or refund API is called.
  await Payment.create({
    publicId: nanoid(24),
    purpose: "PLATFORM_PLAN",
    payerId: owner._id,
    gymId: gym._id,
    amountMinor: 900000,
    provider: "RAZORPAY",
    status: "CAPTURED",
    capturedAt: paidAt,
  });
  const refundedPayment = await Payment.create({
    publicId: nanoid(24),
    purpose: "MEMBERSHIP",
    payerId: member._id,
    gymId: gym._id,
    amountMinor: 40000,
    provider: "RAZORPAY",
    status: "REFUNDED",
    capturedAt: paidAt,
  });
  await Refund.create({
    publicId: nanoid(24),
    paymentId: refundedPayment._id,
    requestedBy: admin._id,
    amountMinor: 40000,
    currency: "INR",
    reason: "Isolated fully refunded ledger fixture",
    status: "PROCESSED",
    processedAt: new Date(),
  });
  await Payment.create({
    publicId: nanoid(24),
    purpose: "MEMBERSHIP",
    payerId: member._id,
    gymId: gym._id,
    amountMinor: 12300,
    provider: "RAZORPAY",
    status: "PENDING",
  });
  const revenue = await call("get", "/api/v1/owner/revenue", ownerToken);
  status(revenue, 200);
  assert.equal(
    revenue.body.data.grossMinor,
    146200,
    "Membership gross must include the refunded principal but exclude platform fees.",
  );
  assert.equal(revenue.body.data.refundMinor, 40000);
  assert.equal(
    revenue.body.data.netMinor,
    106200,
    "A fully refunded receipt contributes zero to net revenue.",
  );
  assert.equal(revenue.body.data.offlineMinor, 106200);
  assert.equal(revenue.body.data.onlineMinor, 0);
  assert.equal(revenue.body.data.pendingMinor, 12300);
  assert.equal(
    revenue.body.data.series.reduce(
      (sum: number, point: any) => sum + point.amountMinor,
      0,
    ),
    106200,
  );
  results.push(
    "Gym revenue excludes platform fees and reconciles fully refunded principal, channel totals and pending payments",
  );

  const review = await call("post", "/api/v1/users/me/reviews", memberToken, {
    gymId: gym.publicId,
    rating: 4,
    title: "Verification review",
    body: "A real membership review fixture.",
  });
  status(review, 201);
  const reviewId = review.body.data.publicId;
  const editedReview = await call(
    "patch",
    `/api/v1/users/me/reviews/${reviewId}`,
    memberToken,
    {
      rating: 5,
      title: "Edited verification review",
      body: "Updated only by its authenticated author.",
    },
  );
  status(editedReview, 200);
  assert(editedReview.body.data.editedAt);
  status(
    await call("patch", `/api/v1/users/me/reviews/${reviewId}`, joinerToken, {
      rating: 1,
      body: "Unauthorized replacement",
    }),
    404,
  );
  status(
    await call("post", "/api/v1/users/me/reviews", memberToken, {
      gymId: gym.publicId,
      rating: 3,
      body: "Duplicate review",
    }),
    409,
  );
  assert.equal(
    await Review.countDocuments({ gymId: gym._id, userId: member._id }),
    1,
  );
  assert.equal((await Review.findOne({ publicId: reviewId }))?.rating, 5);
  results.push(
    "Review creation and editing enforce membership, author ownership and one review per gym",
  );

  const legacyTicket = await SupportTicket.create({
    publicId: nanoid(20),
    requesterId: member._id,
    gymId: gym._id,
    subject: "Historical verification support",
    status: "OPEN",
    messages: [
      {
        authorId: member._id,
        body: "Historical member question",
        createdAt: new Date(Date.now() - 120000),
      },
      {
        authorId: admin._id,
        body: "Historical administrator reply",
        createdAt: new Date(Date.now() - 60000),
      },
    ],
  });
  const threads = await call(
    "get",
    "/api/v1/conversations?type=SUPPORT",
    memberToken,
  );
  status(threads, 200);
  const conversation = await Conversation.findOne({
    supportTicketId: legacyTicket._id,
  });
  assert(conversation);
  assert(
    threads.body.data.some(
      (thread: any) => thread.publicId === conversation.publicId,
    ),
  );
  status(
    await call("get", "/api/v1/conversations?type=SUPPORT", memberToken),
    200,
  );
  assert.equal(
    await Message.countDocuments({ conversationId: conversation._id }),
    2,
    "Repeated support migration must not duplicate history.",
  );
  const history = await call(
    "get",
    `/api/v1/conversations/${conversation.publicId}/messages`,
    memberToken,
  );
  status(history, 200);
  assert.deepEqual(
    history.body.data.map((message: any) => message.text),
    ["Historical member question", "Historical administrator reply"],
  );
  status(
    await call(
      "post",
      `/api/v1/conversations/${conversation.publicId}/messages`,
      joinerToken,
      { clientMessageId: nanoid(20), text: "Forbidden support reply" },
    ),
    404,
  );
  const supportReply = await call(
    "post",
    `/api/v1/conversations/${conversation.publicId}/messages`,
    adminToken,
    { clientMessageId: nanoid(20), text: "Authorized administrator follow-up" },
  );
  status(supportReply, 201);
  assert.equal(
    (await SupportTicket.findById(legacyTicket._id))?.status,
    "WAITING_FOR_USER",
  );
  status(
    await call(
      "patch",
      `/api/v1/conversations/${conversation.publicId}/support-status`,
      memberToken,
      { status: "CLOSED" },
    ),
    403,
  );
  status(
    await call(
      "post",
      `/api/v1/conversations/${conversation.publicId}/messages`,
      memberToken,
      {
        clientMessageId: nanoid(20),
        text: "Member follow-up in the same conversation",
      },
    ),
    201,
  );
  assert.equal(
    (await SupportTicket.findById(legacyTicket._id))?.messages.length,
    2,
    "Historical ticket data must remain intact.",
  );
  assert.equal(
    await Message.countDocuments({ conversationId: conversation._id }),
    4,
  );
  results.push(
    "Legacy support history migrates once and permits only requester or administrator replies",
  );

  // An account with two selected roles must still receive only one announcement.
  await User.updateOne({ _id: owner._id }, { $addToSet: { roles: "USER" } });
  const broadcastBody = {
    name: "Verification announcement",
    message: "Isolated inbox delivery verification only.",
    roles: ["USER", "GYM_OWNER"],
    idempotencyKey: randomUUID(),
  };
  status(
    await call(
      "post",
      "/api/v1/conversations/broadcasts",
      memberToken,
      broadcastBody,
    ),
    403,
  );
  const broadcast = await call(
    "post",
    "/api/v1/conversations/broadcasts",
    adminToken,
    broadcastBody,
  );
  status(broadcast, 202);
  const replayBroadcast = await call(
    "post",
    "/api/v1/conversations/broadcasts",
    adminToken,
    broadcastBody,
  );
  status(replayBroadcast, 200);
  assert.equal(
    replayBroadcast.body.data.publicId,
    broadcast.body.data.publicId,
  );
  const campaignId = broadcast.body.data.publicId,
    dedupeKey = `campaign:${campaignId}`;
  assert.equal(
    await Notification.countDocuments({ dedupeKey }),
    0,
    "Broadcast creation must queue, not synchronously fan out.",
  );
  assert.equal(await deliverCampaignBatch(), true);
  const expectedRecipients = await User.countDocuments({
    status: "ACTIVE",
    roles: { $in: ["USER", "GYM_OWNER"] },
  });
  assert.equal(
    await Notification.countDocuments({ dedupeKey }),
    expectedRecipients,
  );
  await Campaign.updateOne(
    { publicId: campaignId },
    {
      $set: { status: "QUEUED" },
      $unset: { deliveryCursor: 1, leaseId: 1, leaseUntil: 1 },
    },
  );
  await deliverCampaignBatch();
  await deliverCampaignBatch();
  assert.equal(
    await Notification.countDocuments({ dedupeKey }),
    expectedRecipients,
    "Replaying a delivered batch must not duplicate inbox rows.",
  );
  assert.equal(
    await Notification.countDocuments({ dedupeKey, userId: owner._id }),
    1,
  );
  assert.equal(
    (await Campaign.findOne({ publicId: campaignId }))?.status,
    "COMPLETED",
  );
  results.push(
    "Administrator broadcasts queue delivery and remain duplicate-free across request and worker retries",
  );

  // Record synthetic cash reversals against only the isolated OFFLINE receipt.
  // The OFFLINE branch never submits a transfer to a payment provider.
  const offlinePayment = await Payment.findOne({
    publicId: created.body.data.payment.publicId,
    gymId: gym._id,
    provider: "OFFLINE",
  });
  assert(offlinePayment);
  const refundPath = `/api/v1/admin/payments/${offlinePayment.publicId}/refunds`;
  const refundKey = randomUUID();
  const refundBody = {
    amountMinor: 10000,
    reason: "Isolated offline cash reversal verification",
    offlineConfirmed: true,
    offlineReference: `verification-${runId}`,
  };
  async function refundWithKey(key: string, body: typeof refundBody) {
    return request(app)
      .post(refundPath)
      .set("authorization", `Bearer ${adminToken}`)
      .set("idempotency-key", key)
      .send(body);
  }
  status(await call("post", refundPath, ownerToken, refundBody), 403);
  const refundRecorded = await refundWithKey(refundKey, refundBody);
  status(refundRecorded, 200);
  assert.equal(refundRecorded.body.data.status, "PROCESSED");
  assert.equal(refundRecorded.body.data.provider, "OFFLINE");
  assert.equal(
    refundRecorded.body.data.offlineReference,
    refundBody.offlineReference,
  );
  const refundReplayed = await refundWithKey(refundKey, refundBody);
  status(refundReplayed, 200);
  assert.equal(
    refundReplayed.body.data.publicId,
    refundRecorded.body.data.publicId,
  );
  assert.equal(
    await Refund.countDocuments({ paymentId: offlinePayment._id }),
    1,
  );
  const concurrentRefunds = await Promise.all(
    [0, 1].map((index) =>
      refundWithKey(randomUUID(), {
        ...refundBody,
        amountMinor: 60000,
        offlineReference: `verification-${runId}-${index}`,
      }),
    ),
  );
  assert.deepEqual(
    concurrentRefunds.map((response) => response.status).sort(),
    [200, 409],
  );
  const recordedRefunds = await Refund.find({
    paymentId: offlinePayment._id,
    status: "PROCESSED",
  });
  assert.equal(recordedRefunds.length, 2);
  assert.equal(
    recordedRefunds.reduce((sum, refund) => sum + refund.amountMinor, 0),
    70000,
  );
  assert.equal(
    (await Payment.findById(offlinePayment._id))?.status,
    "PARTIALLY_REFUNDED",
  );
  results.push(
    "Offline refund recording enforces administrator access, idempotent replay and concurrent remaining-balance limits without external transfers",
  );

  const paymentCountBeforeArchive = await Payment.countDocuments({
    gymId: gym._id,
  });

  status(
    await call("patch", `/api/v1/admin/members/${memberId}`, adminToken, {
      status: "ARCHIVED",
      note: "Verification archive",
    }),
    200,
  );
  assert.equal(
    (await Subscription.findOne({ publicId: subscriptionId }))?.status,
    "CANCELLED",
  );
  assert.equal(
    await Payment.countDocuments({ gymId: gym._id }),
    paymentCountBeforeArchive,
  );
  assert.equal(await AttendanceEvent.countDocuments({ gymId: gym._id }), 1);
  results.push(
    "Administrator member archival cancels access while preserving financial and attendance records",
  );
  const trainerUser = await createUser("Concurrent Verification Trainer");
  const trainerProfiles = await Promise.all(
    [ownerToken, otherToken].map((auth) =>
      call("post", "/api/v1/owner/trainers", auth, {
        name: trainerUser.name,
        email: trainerUser.email,
        status: "ACTIVE",
        specializations: ["Strength"],
        experienceYears: 2,
      }),
    ),
  );
  trainerProfiles.forEach((response) => status(response, 201));
  await User.updateOne(
    { _id: trainerUser._id },
    { $set: { activeRole: "TRAINER" } },
  );
  for (const tenant of [gym, otherGym])
    await createSession({
      userId: String(trainerUser._id),
      activeRole: "TRAINER",
      activeGymId: String(tenant._id),
    });
  const trainerUpdates = await Promise.all(
    trainerProfiles.map((response, index) =>
      call(
        "patch",
        `/api/v1/owner/trainers/${response.body.data.publicId}`,
        [ownerToken, otherToken][index],
        { status: "INACTIVE" },
      ),
    ),
  );
  trainerUpdates.forEach((response) => status(response, 200));
  const finalTrainerUser = await User.findById(trainerUser._id);
  assert(!finalTrainerUser?.roles.includes("TRAINER"));
  assert.equal(finalTrainerUser?.activeRole, "USER");
  assert.equal(
    await RoleAssignment.countDocuments({
      userId: trainerUser._id,
      role: "TRAINER",
      status: "ACTIVE",
    }),
    0,
  );
  assert.equal(
    await Session.countDocuments({
      userId: trainerUser._id,
      activeRole: "TRAINER",
      revokedAt: { $ne: null },
    }),
    2,
  );
  results.push(
    "Concurrent multi-gym trainer deactivation removes the final global role and revokes only the affected trainer sessions atomically",
  );
  status(
    await call(
      "post",
      `/api/v1/admin/gyms/${gym.publicId}/status`,
      adminToken,
      {
        action: "suspend",
        reason: "Isolated verification suspension",
      },
    ),
    200,
  );
  status(await call("get", "/api/v1/owner/gym", ownerToken), 200);
  status(
    await call("patch", "/api/v1/owner/gym", ownerToken, {
      description: "This suspended tenant write must be rejected",
    }),
    403,
  );
  const switchedOwnerToken = await token(owner, "GYM_OWNER", gym);
  status(
    await call("patch", "/api/v1/owner/gym", switchedOwnerToken, {
      description: "A newly issued tenant session must not bypass suspension",
    }),
    403,
  );
  status(
    await call(
      "post",
      `/api/v1/admin/gyms/${gym.publicId}/status`,
      adminToken,
      {
        action: "activate",
        reason: "Isolated verification recovery",
      },
    ),
    409,
  );
  status(
    await call("patch", `/api/v1/admin/gyms/${gym.publicId}`, adminToken, {
      description: "Authorized administrator management remains available",
    }),
    200,
  );
  results.push(
    "Suspended gyms reject writes through existing or newly issued owner sessions while preserving reads and authorized admin management; unpaid activation remains blocked",
  );
  results.push(...await checkProductEnhancements());
  results.push(...await checkSocialProfileRegressions({ assertDatabase }));
  results.push(...await checkOwnerRegressions());
  results.push(...await checkReviewMediaRegressions({ assertDatabase }));
  results.push(...await checkNotificationEnhancements({ app, owner, gym, member, ownerToken, memberToken }));
  results.push(...await checkMembershipStreakEnhancements({ assertDatabase }));
  results.push(...await checkPromotionRegressions({ assertDatabase }));
  console.log(JSON.stringify({ success: true, checks: results }, null, 2));
} catch (error) {
  console.error(
    "Isolated membership verification failed:",
    error instanceof Error ? error.message : "Unknown failure",
  );
  process.exitCode = 1;
} finally {
  if (ownsDatabase && mongoose.connection.readyState === 1) {
    assertDatabase();
    // Delete only the exact object identities returned by this run's initiate
    // requests, before removing the temporary database and its attachment rows.
    for (const media of createdMedia.filter((file) => !file.removed)) {
      try {
        const gym = await Gym.findOne({
          _id: media.gymId,
          ownerId: media.ownerId,
        });
        assert(gym, "Media cleanup requires this run's fixture gym.");
        if (String(gym.logoAttachmentId || "") === media.attachmentId)
          status(
            await call("patch", "/api/v1/owner/gym", media.ownerToken, {
              logoAttachmentId: null,
            }),
            200,
          );
        await removeCreatedMedia(media);
      } catch (error) {
        process.exitCode = 1;
        console.error(
          "Media cleanup failed; manual cleanup may be required:",
          JSON.stringify({
            provider: media.provider,
            objectKey: media.objectKey,
            attachmentPublicId: media.publicId,
            error:
              error instanceof Error
                ? error.message
                : "Unknown cleanup failure",
          }),
        );
      }
    }
    if (createdMedia.length && createdMedia.every((file) => file.removed))
      console.log(
        `Removed all ${createdMedia.length} test media objects created by this run.`,
      );
    const marker = await mongoose.connection
      .db!.collection("verification_run")
      .findOne({ runId });
    assert.equal(
      marker?.runId,
      runId,
      "Refusing cleanup without this run's ownership marker.",
    );
    await mongoose.connection.db!.dropDatabase();
    console.log(
      "Removed only the isolated verification database created by this run.",
    );
  }
  await mongoose.disconnect();
}
