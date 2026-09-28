import "dotenv/config";
import mongoose from "mongoose";
import assert from "node:assert/strict";
import request from "supertest";
import { isolatedScriptDatabase } from "./isolatedScriptDatabase.js";
Object.assign(process.env, {
  NODE_ENV: "test",
  LOG_LEVEL: "silent",
  OBJECT_STORAGE_ENDPOINT: "https://storage.example.test",
  OBJECT_STORAGE_ACCESS_KEY: "test-key",
  OBJECT_STORAGE_SECRET_KEY: "test-secret",
});
const { app } = await import("../app.js");
const { User } = await import("../models/User.js");
const { Gym } = await import("../models/Gym.js");
const { RoleAssignment } = await import("../models/Auth.js");
const { Attachment } = await import("../models/Business.js");
const { createSession } = await import("../services/tokenService.js");
const { OWNER_DEFAULT_PERMISSIONS } = await import("../constants/domain.js");
const testDatabase = isolatedScriptDatabase("gfg");
const { databaseName } = testDatabase;
let checks = 0;
const check = (value: unknown, message: string) => {
  assert.ok(value, message);
  checks++;
};
async function call(
  method: string,
  path: string,
  token?: string,
  body?: any,
  status = 200,
) {
  const agent = request(app) as any;
  let req = agent[method]("/api/v1" + path)
    .set("idempotency-key", crypto.randomUUID());
  if (token) req = req.auth(token, { type: "bearer" });
  if (body !== undefined) req = req.send(body);
  const res = await req;
  assert.equal(
    res.status,
    status,
    `${method} ${path}: ${JSON.stringify(res.body.error || {})}`,
  );
  checks++;
  return res.body.data;
}
const originalFetch = globalThis.fetch;
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const mp4 = Buffer.from("00000014667479706d7034320000000069736f6d", "hex");
let storedMime = "image/png",
  storedSize = png.length;
globalThis.fetch = async (url, init) => {
  if (
    String(url).startsWith("https://storage.example.test") &&
    init?.method === "HEAD"
  )
    return new Response(null, {
      status: 200,
      headers: {
        "content-type": storedMime,
        "content-length": String(storedSize),
      },
    });
  if (String(url).startsWith("https://storage.example.test") && (!init?.method || init.method === "GET")) {
    return new Response(new Uint8Array(storedMime === "video/mp4" ? mp4 : png), { status: 200, headers: { "content-type": storedMime } });
  }
  return originalFetch(url, init);
};
try {
  await mongoose.connect(process.env.MONGO_URI!, {
    dbName: databaseName,
    serverSelectionTimeoutMS: 15000,
    autoCreate: false,
    autoIndex: false,
  });
  await testDatabase.initialize();
  async function owner(n: number) {
    const user = await User.create({
      publicId: `profile-owner-${n}`,
      name: `Owner ${n}`,
      roles: ["USER", "GYM_OWNER"],
      status: "ACTIVE",
    });
    const gym = await Gym.create({
      publicId: `profile-gym-${n}`,
      ownerId: user._id,
      slug: `profile-gym-${n}`,
      name: `Profile Gym ${n}`,
      status: "ACTIVE",
      platformSubscriptionStatus: "ACTIVE",
      location: { coordinates: [78.4, 17.4] },
      address: {
        line1: "Original street",
        city: "Hyderabad",
        state: "Telangana",
        postalCode: "500001",
      },
      contact: { phone: "9876543210", email: "gym@example.test" },
    });
    await RoleAssignment.create({
      userId: user._id,
      gymId: gym._id,
      role: "GYM_OWNER",
      permissions: OWNER_DEFAULT_PERMISSIONS,
    });
    const session = await createSession({
      userId: String(user._id),
      activeRole: "GYM_OWNER",
      activeGymId: String(gym._id),
    });
    return { user, gym, token: session.accessToken };
  }
  const one = await owner(1),
    two = await owner(2);
  const member = await createSession({
    userId: String(one.user._id),
    activeRole: "USER",
  });
  await call(
    "post",
    "/uploads",
    member.accessToken,
    {
      purpose: "GYM_GALLERY",
      name: "photo.png",
      mimeType: "image/png",
      size: png.length,
    },
    403,
  );
  await call(
    "post",
    "/uploads",
    one.token,
    {
      purpose: "GYM_GALLERY",
      name: "file.pdf",
      mimeType: "application/pdf",
      size: 20,
    },
    422,
  );
  const photo = await call(
    "post",
    "/uploads",
    one.token,
    {
      purpose: "GYM_GALLERY",
      name: "photo.png",
      mimeType: "image/png",
      size: png.length,
    },
    201,
  );
  await call(
    "patch",
    "/owner/gym",
    one.token,
    { mediaAttachmentIds: [photo.attachment._id] },
    422,
  );
  storedSize = png.length - 1;
  await call(
    "post",
    `/uploads/${photo.attachment.publicId}/complete`,
    one.token,
    {},
    409,
  );
  storedSize = png.length;
  await call(
    "post",
    `/uploads/${photo.attachment.publicId}/complete`,
    two.token,
    {},
    404,
  );
  await call(
    "post",
    `/uploads/${photo.attachment.publicId}/complete`,
    one.token,
    {},
  );
  await call(
    "patch",
    "/owner/gym",
    two.token,
    { mediaAttachmentIds: [photo.attachment._id] },
    422,
  );
  const video = await call(
    "post",
    "/uploads",
    one.token,
    {
      purpose: "GYM_GALLERY",
      name: "tour.mp4",
      mimeType: "video/mp4",
      size: 20,
    },
    201,
  );
  storedMime = "video/mp4";
  storedSize = mp4.length;
  await call(
    "post",
    `/uploads/${video.attachment.publicId}/complete`,
    one.token,
    {},
  );
  const mediaAttachmentIds = [photo.attachment._id, video.attachment._id];
  await call(
    "patch",
    "/owner/gym",
    one.token,
    { mediaAttachmentIds, coverAttachmentId: video.attachment._id },
    422,
  );
  await call("patch", "/owner/gym", one.token, {
    mediaAttachmentIds,
    coverAttachmentId: photo.attachment._id,
    benefits: ["Free induction", "Personal coaching"],
    amenities: ["Showers"],
    openingHours: [
      { day: 0, closed: true },
      { day: 1, closed: false, opensAt: "22:00", closesAt: "05:00" },
    ],
  });
  await call(
    "patch",
    "/owner/gym",
    one.token,
    {
      openingHours: [
        { day: 1, closed: false, opensAt: "25:00", closesAt: "05:00" },
      ],
    },
    422,
  );
  await call(
    "patch",
    "/owner/gym",
    one.token,
    {
      openingHours: [
        { day: 1, closed: true },
        { day: 1, closed: true },
      ],
    },
    422,
  );
  await call(
    "patch",
    "/owner/gym",
    one.token,
    { openingHours: [{ day: 1, closed: false }] },
    422,
  );
  await call("patch", "/owner/gym", one.token, {
    location: { coordinates: [78.42, 17.42] },
    address: { line1: "New entrance" },
  });
  const ownerView = await call("get", "/owner/gym", one.token);
  check(
    ownerView.address.city === "Hyderabad" &&
      ownerView.contact.email === "gym@example.test",
    "Location updates preserve other profile fields",
  );
  check(
    ownerView.media.length === 2 && ownerView.media[1].mimeType === "video/mp4",
    "Owner can view completed photo and video uploads",
  );
  const publicView = await call("get", "/public/gyms/profile-gym-1");
  check(
    publicView.gym.benefits.length === 2 &&
      publicView.gym.openingHours.length === 2,
    "Public gym has saved benefits and hours",
  );
  check(
    publicView.gym.media.length === 2 &&
      publicView.gym.coverImageUrl.includes("X-Amz-Signature"),
    "Public gallery and cover use fresh signed links",
  );
  const saved = await Gym.findById(one.gym._id).lean();
  check(
    !saved!.coverImageUrl &&
      String(saved!.mediaAttachmentIds[0]) === photo.attachment._id,
    "Database stores attachment references instead of expiring URLs",
  );
  const listed = await call("get", "/public/gyms?q=Profile%20Gym%201");
  check(
    listed[0].coverImageUrl.includes("X-Amz-Signature"),
    "Gym search shows the chosen cover",
  );
  const nearby = await call("get", "/public/gyms/nearby?lat=17.42&lng=78.42");
  check(
    nearby.some((g: any) => g.publicId === one.gym.publicId && g.coverImageUrl),
    "Nearby search uses the updated location and cover",
  );
  await call(
    "post",
    "/owner/classes",
    one.token,
    {
      name: "Morning yoga",
      category: "YOGA",
      startsAt: new Date(Date.now() + 86400000).toISOString(),
      endsAt: new Date(Date.now() + 90000000).toISOString(),
      capacity: 12,
    },
    201,
  );
  check(
    (await call("get", "/public/gyms/profile-gym-1")).classes[0].name ===
      "Morning yoga",
    "Created class appears in public gym details",
  );
  await call("patch", "/owner/gym", one.token, {
    mediaAttachmentIds: [video.attachment._id],
    coverAttachmentId: null,
    benefits: [],
  });
  const removed = await call("get", "/public/gyms/profile-gym-1");
  check(
    removed.gym.media.length === 1 &&
      !removed.gym.coverImageUrl &&
      removed.gym.benefits.length === 0,
    "Removing cover and clearing benefits updates the public profile",
  );
  const memberPlan = await call(
    "post",
    "/owner/plans",
    one.token,
    {
      name: "Monthly membership",
      code: "MONTHLY",
      durationDays: 30,
      priceMinor: 150000,
      benefits: ["Gym access"],
      status: "DRAFT",
    },
    201,
  );
  await call(
    "post",
    "/owner/plans",
    two.token,
    {
      name: "Other gym membership",
      code: "MONTHLY",
      durationDays: 30,
      priceMinor: 200000,
      status: "ACTIVE",
    },
    201,
  );
  check(
    (await call("get", "/public/gyms/profile-gym-1")).plans.length === 0,
    "Drafts and another gym's memberships are hidden",
  );
  await call("patch", `/owner/plans/${memberPlan.publicId}`, one.token, {
    status: "ACTIVE",
  });
  const published = await call("get", "/public/gyms/profile-gym-1");
  check(
    published.plans.length === 1 &&
      published.plans[0]._id === memberPlan._id &&
      published.plans[0].priceMinor === 150000,
    "Published membership and database price appear on the selected gym",
  );
  await call(
    "patch",
    `/owner/plans/${memberPlan.publicId}`,
    two.token,
    { priceMinor: 1 },
    404,
  );
  await call("patch", `/owner/plans/${memberPlan.publicId}`, one.token, {
    status: "INACTIVE",
  });
  check(
    (await call("get", "/public/gyms/profile-gym-1")).plans.length === 0,
    "Unpublished memberships disappear from member details",
  );
  await Gym.updateOne({ _id: one.gym._id }, { status: "INACTIVE" });
  await call("get", "/public/gyms/profile-gym-1", undefined, undefined, 404);
  check(
    (await Attachment.countDocuments()) === 2,
    "Unpublishing media preserves stored uploads",
  );
  console.log(
    `PASS: ${checks} gym profile checks; cloud storage responses simulated.`,
  );
} finally {
  globalThis.fetch = originalFetch;
  try {
    if (await testDatabase.cleanup())
      console.log("Temporary profile database removed.");
  } finally {
    await mongoose.disconnect();
  }
}
