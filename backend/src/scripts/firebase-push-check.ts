import "dotenv/config";
import mongoose from "mongoose";
import assert from "node:assert/strict";
import request from "supertest";
Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  FIREBASE_PROJECT_ID: "test-project",
  FIREBASE_CLIENT_EMAIL: "test@example.test",
  FIREBASE_PRIVATE_KEY: "test-key",
});
const { app } = await import("../app.js");
const { User } = await import("../models/User.js");
const { Session } = await import("../models/Auth.js");
const { Notification } = await import("../models/Engagement.js");
const { DeviceToken } = await import("../models/Collaboration.js");
const { createSession } = await import("../services/tokenService.js");
const { FirebaseProvider, PushDeliveryError } =
  await import("../integrations/notifications/firebaseProvider.js");
const { deliverPush } = await import("../services/notificationService.js");
const databaseName = `gfu_push_${Date.now()}`;
let checks = 0;
function check(value: unknown, message: string) {
  assert.ok(value, message);
  checks++;
}
let sent: string[] = [],
  fail = "";
FirebaseProvider.prototype.send = async (message) => {
  sent.push(message.token);
  if (message.token.includes("invalid"))
    throw new PushDeliveryError("UNREGISTERED", false);
  if (message.token === fail) throw new PushDeliveryError("UNAVAILABLE", true);
  return { providerMessageId: "test-message" };
};
async function call(
  method: string,
  path: string,
  token?: string,
  body?: any,
  status = 200,
) {
  let req = (request(app) as any)[method]("/api/v1" + path);
  if (token) req = req.auth(token, { type: "bearer" });
  if (body) req = req.send(body);
  const res = await req;
  assert.equal(res.status, status, JSON.stringify(res.body.error || {}));
  checks++;
  return res.body.data;
}
try {
  await mongoose.connect(process.env.MONGO_URI!, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 15000,
  });
  await Promise.all(
    Object.values(mongoose.models).map((model) => model.init()),
  );
  const user = await User.create({
    publicId: "push-user",
    name: "Push user",
    roles: ["USER"],
    status: "ACTIVE",
  });
  const other = await User.create({
    publicId: "other-push-user",
    name: "Other user",
    roles: ["USER"],
    status: "ACTIVE",
  });
  const session = await createSession({
    userId: String(user._id),
    activeRole: "USER",
  });
  const otherSession = await createSession({
    userId: String(other._id),
    activeRole: "USER",
  });
  const device = "web-device-token-123456789",
    retryDevice = "web-retry-token-123456789";
  await call(
    "post",
    "/devices",
    undefined,
    { token: device, platform: "WEB" },
    401,
  );
  const registered = await call(
    "post",
    "/devices",
    session.accessToken,
    { token: device, platform: "WEB" },
    201,
  );
  check(!registered.token, "Token is not returned to clients");
  await call(
    "post",
    "/devices",
    session.accessToken,
    { token: device, platform: "WEB" },
    201,
  );
  check(
    (await DeviceToken.countDocuments()) === 1,
    "Registration is idempotent",
  );
  await call(
    "delete",
    "/devices",
    otherSession.accessToken,
    { token: device },
    204,
  );
  check(
    (await DeviceToken.countDocuments({ revokedAt: null })) === 1,
    "Another user cannot revoke the device",
  );
  const make = () =>
    Notification.create({
      userId: user._id,
      category: "SYSTEM",
      title: "Test update",
      message: "Test notification",
    });
  const first = await make();
  await Promise.all([
    deliverPush(String(first._id)),
    deliverPush(String(first._id)),
  ]);
  check(sent.length === 1, "Concurrent workers claim a notification only once");
  check(
    (await Notification.findById(first._id))!.pushStatus === "SENT",
    "Provider acceptance is recorded",
  );
  await deliverPush(String(first._id));
  check(sent.length === 1, "Delivered notifications are not sent again");
  await call(
    "post",
    "/devices",
    session.accessToken,
    { token: retryDevice, platform: "WEB" },
    201,
  );
  fail = retryDevice;
  sent = [];
  const retried = await make();
  await deliverPush(String(retried._id));
  check(
    (await Notification.findById(retried._id))!.pushStatus === "QUEUED",
    "Transient failures are queued for retry",
  );
  fail = "";
  sent = [];
  await Notification.updateOne(
    { _id: retried._id },
    { $set: { pushNextAttemptAt: new Date(0) } },
  );
  await deliverPush(String(retried._id));
  check(
    sent.length === 1 && sent[0] === retryDevice,
    "Successful devices are excluded from retries",
  );
  const invalid = "invalid-device-token-123456";
  await call(
    "post",
    "/devices",
    session.accessToken,
    { token: invalid, platform: "WEB" },
    201,
  );
  await deliverPush(String((await make())._id));
  check(
    Boolean((await DeviceToken.findOne({ token: invalid }))!.revokedAt),
    "FCM unregistered tokens are revoked",
  );
  await call(
    "post",
    "/devices",
    otherSession.accessToken,
    { token: device, platform: "WEB" },
    201,
  );
  check(
    String((await DeviceToken.findOne({ token: device }))!.userId) ===
      String(other._id),
    "Shared browser token transfers to its current authenticated user",
  );
  await call("post", "/auth/logout-all", session.accessToken, {}, 204);
  check(
    (await DeviceToken.countDocuments({
      userId: user._id,
      revokedAt: null,
    })) === 0,
    "Logging out revokes this user's devices",
  );
  sent = [];
  const skipped = await make();
  await deliverPush(String(skipped._id));
  check(
    sent.length === 0 &&
      (await Notification.findById(skipped._id))!.pushStatus === "SKIPPED",
    "No active devices is not reported as delivered",
  );
  await Session.updateMany(
    { userId: other._id },
    { $set: { expiresAt: new Date(0) } },
  );
  const expired = await Notification.create({
    userId: other._id,
    category: "SYSTEM",
    title: "Expired",
    message: "Expired session",
  });
  await deliverPush(String(expired._id));
  check(sent.length === 0, "Expired sessions receive no pushes");
  console.log(
    `PASS: ${checks} Firebase push checks; all provider delivery simulated.`,
  );
} finally {
  if (
    mongoose.connection.name === databaseName &&
    /^gfu_push_\d+$/.test(databaseName)
  ) {
    await mongoose.connection.dropDatabase();
    console.log("Temporary push database removed.");
  }
  await mongoose.disconnect();
}
