import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Follow, SocialStory } from "../models/Social.js";
import { StreakProjection } from "../models/Attendance.js";
import { createSession } from "../services/tokenService.js";
import { globalStreak, STORY_DURATION_MS } from "../services/socialService.js";
import { cleanupOrphanedFollows } from "../services/socialRelationshipService.js";

// Called only by the owning disposable-DB verifier. No connect, provider calls,
// production migrations, collection drops or application-data cleanup occur here.
export async function checkSocialProfileRegressions({
  assertDatabase,
}: {
  assertDatabase: () => void;
}) {
  assertDatabase();
  assert.match(mongoose.connection.db!.databaseName, /^gfv_[a-f0-9]{32}$/);
  const user = await User.create({
    publicId: nanoid(),
    name: "Social regression member",
    roles: ["USER"],
    status: "ACTIVE",
    social: { visibility: "PUBLIC", timezone: "UTC" },
    profile: {
      gender: "FEMALE",
      dateOfBirth: new Date("1990-01-01"),
      heightCm: 165,
      weightKg: 60,
      fitnessGoal: "Keep this unchanged",
      emergencyContact: {
        name: "Friend",
        phone: "+919876543210",
        relationship: "Friend",
      },
    },
  });
  const targets = await User.insertMany(
    Array.from({ length: 14 }, (_, index) => ({
      publicId: nanoid(),
      name: `Social target ${index}`,
      roles: ["USER"],
      status: index >= 12 ? "DISABLED" : "ACTIVE",
      social: { visibility: "PUBLIC" },
    })),
  );
  const token = (
    await createSession({ userId: String(user._id), activeRole: "USER" })
  ).accessToken;
  async function api(
    method: "get" | "post" | "patch" | "delete",
    path: string,
    body?: object,
    expected = 200,
  ) {
    assertDatabase();
    const client = request(app);
    const operation = client[method]("/api/v1" + path)
      .set("Authorization", `Bearer ${token}`)
      .set("idempotency-key", nanoid());
    const response = await (body ? operation.send(body) : operation);
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${response.body?.error?.code || response.status}`,
    );
    return response.body;
  }

  await api("patch", "/users/me", {
    profile: {
      gender: null,
      dateOfBirth: null,
      heightCm: null,
      weightKg: null,
    },
  });
  const persisted = await User.findById(user._id).lean();
  for (const key of ["gender", "dateOfBirth", "heightCm", "weightKg"])
    assert.equal(persisted.profile[key], undefined);
  assert.equal(persisted.profile.fitnessGoal, "Keep this unchanged");
  assert.equal(persisted.profile.emergencyContact.name, "Friend");
  await api("patch", "/users/me", { profile: { heightCm: 170 } });
  assert.equal((await User.findById(user._id).lean()).profile.heightCm, 170);
  for (const invalid of [
    { roles: ["ADMIN"] },
    { email: "unverified@example.invalid" },
  ]) {
    const rejected = await api("patch", "/users/me", invalid, 422);
    assert.equal(rejected.error.code, "VALIDATION_ERROR");
  }
  // Dotted keys are rejected before schema validation by the global input guard.
  const unsafe = await api("patch", "/users/me", { "profile.gender": null }, 400);
  assert.equal(unsafe.error.code, "UNSAFE_INPUT");

  await Promise.all(
    Array.from({ length: 6 }, () =>
      api("post", `/social/profiles/${targets[0].publicId}/follow`, {}),
    ),
  );
  assert.equal(
    await Follow.countDocuments({
      followerId: user._id,
      followingId: targets[0]._id,
    }),
    1,
  );
  const missingUserId = new mongoose.Types.ObjectId();
  const edges = await Follow.insertMany([
    ...targets.slice(1).map((target, index) => ({
      followerId: user._id,
      followingId: target._id,
      createdAt: new Date(Date.now() + index * 1000),
    })),
    {
      followerId: user._id,
      followingId: missingUserId,
      createdAt: new Date(Date.now() + 90000),
    },
    { followerId: missingUserId, followingId: user._id },
    { followerId: targets[0]._id, followingId: user._id },
    { followerId: targets[12]._id, followingId: user._id },
  ]);
  const initial = await api("get", "/social/profiles/me");
  assert.equal(initial.data.counts.following, 12);
  assert.equal(initial.data.counts.followers, 1);
  const people: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const result = await api(
      "get",
      `/social/profiles/me/following?page=${page}&limit=5`,
    );
    assert.equal(result.meta.total, 12);
    assert.equal(result.meta.pages, 3);
    assert.equal(result.data.length, page < 3 ? 5 : 2);
    assert(
      result.data.every(
        (person: any) => !person.email && !person.phone && !person.profile,
      ),
    );
    people.push(...result.data.map((person: any) => person.publicId));
  }
  assert.equal(new Set(people).size, 12);
  assert(!people.includes(targets[12].publicId));
  await User.updateOne({ _id: targets[1]._id }, { status: "DISABLED" });
  const afterDisable = await api(
    "get",
    "/social/profiles/me/following?limit=5",
  );
  assert.equal(afterDisable.meta.total, 11);
  assert.equal(
    (await api("get", "/social/profiles/me")).data.counts.following,
    11,
  );
  await api("delete", `/social/profiles/${targets[1].publicId}/follow`);
  assert.equal(
    await Follow.countDocuments({
      followerId: user._id,
      followingId: targets[1]._id,
    }),
    0,
  );
  await api("delete", `/social/profiles/${nanoid()}/follow`);
  // Walk every bounded batch; do not delete edges to temporarily disabled users.
  let cursor: string | undefined;
  do {
    const batch = await cleanupOrphanedFollows({ after: cursor, limit: 5 });
    assert(batch.scanned <= 5);
    cursor = batch.nextCursor;
  } while (cursor);
  assert.equal(
    await Follow.countDocuments({
      $or: [{ followingId: missingUserId }, { followerId: missingUserId }],
    }),
    0,
  );
  assert.equal(
    await Follow.countDocuments({
      followerId: user._id,
      followingId: targets[12]._id,
    }),
    1,
  );
  assert(edges.length > 0);

  const now = Date.now();
  const stories = await SocialStory.insertMany(
    Array.from({ length: 25 }, (_, index) => ({
      publicId: nanoid(),
      authorId: user._id,
      text: `Story ${index}`,
      createdAt: new Date(now - index * 1000),
      expiresAt: new Date(now - index * 1000 + STORY_DURATION_MS),
    })),
  );
  const expired = await SocialStory.create({
    publicId: nanoid(),
    authorId: user._id,
    text: "Expired",
    createdAt: new Date(now - STORY_DURATION_MS - 1),
    expiresAt: new Date(now - 1),
  });
  const first = await api("get", "/social/profiles/me/stories?page=1&limit=20");
  const second = await api(
    "get",
    "/social/profiles/me/stories?page=2&limit=20",
  );
  assert.equal(first.meta.total, 25);
  assert.equal(first.data.length, 20);
  assert.equal(second.data.length, 5);
  assert.equal(
    new Set([...first.data, ...second.data].map((story) => story.publicId))
      .size,
    25,
  );
  assert(
    ![...first.data, ...second.data].some(
      (story) => story.publicId === expired.publicId,
    ),
  );
  await api(
    "delete",
    `/social/stories/${stories[24].publicId}`,
    undefined,
    204,
  );
  assert((await SocialStory.findById(stories[24]._id)).deletedAt);
  const added = await api(
    "post",
    "/social/stories",
    { text: "Exactly 25 hours" },
    201,
  );
  const savedStory = await SocialStory.findOne({
    publicId: added.data.publicId,
  }).lean();
  assert.equal(
    savedStory.expiresAt.getTime() - savedStory.createdAt.getTime(),
    STORY_DURATION_MS,
  );

  const raceUser = await User.create({
    publicId: nanoid(),
    name: "Streak race",
    status: "ACTIVE",
  });
  const raced = await Promise.all(
    Array.from({ length: 6 }, () => globalStreak(String(raceUser._id), "UTC")),
  );
  assert(
    raced.every(
      (projection) =>
        projection && String(projection.userId) === String(raceUser._id),
    ),
  );
  assert.equal(
    await StreakProjection.countDocuments({
      scope: "USER",
      userId: raceUser._id,
    }),
    1,
  );
  const probeUsers = await User.insertMany([
    { publicId: nanoid(), name: "Index probe one" },
    { publicId: nanoid(), name: "Index probe two" },
  ]);
  const probeIndex = `social_regression_legacy_${nanoid(8)}`;
  // Reproduce the legacy (null gym, null member) uniqueness collision, limited to
  // these fixture projections' uncommon timezone. Never drop a pre-existing index.
  const probeTimezone = "Etc/GMT+12";
  assert.equal(
    await StreakProjection.countDocuments({
      scope: "USER",
      timezone: probeTimezone,
    }),
    0,
  );
  assertDatabase();
  await StreakProjection.collection.createIndex(
    { gymId: 1, memberProfileId: 1 },
    {
      name: probeIndex,
      unique: true,
      partialFilterExpression: { scope: "USER", timezone: probeTimezone },
    },
  );
  try {
    await globalStreak(String(probeUsers[0]._id), probeTimezone);
    const uncached = await globalStreak(String(probeUsers[1]._id), probeTimezone);
    assert.equal(uncached.currentStreak, 0);
    assert.equal(uncached.totalVisits, 0);
    assert.equal(String(uncached.userId), String(probeUsers[1]._id));
    assert.equal(
      await StreakProjection.countDocuments({
        scope: "USER",
        userId: probeUsers[1]._id,
      }),
      0,
    );
  } finally {
    assertDatabase();
    await StreakProjection.collection.dropIndex(probeIndex);
  }
  assert(await globalStreak(String(probeUsers[1]._id), probeTimezone));
  return [
    "social nullable persistence and patch authorization",
    "social active-only pagination, suspended unfollow and bounded orphan cleanup",
    "social concurrent follows, story pagination and exact expiry",
    "social concurrent streak projection and real-data fallback without modifying a legacy index",
  ];
}
