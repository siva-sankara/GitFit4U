import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { Attachment } from "../models/Business.js";
import { Review } from "../models/Engagement.js";
import { createSession } from "../services/tokenService.js";
import { presignedObjectUrl } from "../integrations/storage/s3ObjectStore.js";

// Metadata-only fixtures inside the owning verifier's temporary database. No S3
// network upload/download/delete or notification-provider delivery is performed.
export async function checkReviewMediaRegressions({
  assertDatabase,
}: {
  assertDatabase: () => void;
}) {
  assertDatabase();
  assert.match(mongoose.connection.db!.databaseName, /^gfv_[a-f0-9]{32}$/);
  const [author, foreign] = await User.insertMany([
    {
      publicId: nanoid(),
      name: "Review photo author",
      roles: ["USER"],
      status: "ACTIVE",
    },
    {
      publicId: nanoid(),
      name: "Other review author",
      roles: ["USER"],
      status: "ACTIVE",
    },
  ]);
  const gym = await Gym.create({
    publicId: nanoid(),
    ownerId: foreign._id,
    name: "Review media test gym",
    slug: nanoid().toLowerCase(),
    location: { type: "Point", coordinates: [77, 12] },
    status: "ACTIVE",
    verificationStatus: "VERIFIED",
    platformSubscriptionStatus: "ACTIVE",
  });
  await MemberProfile.insertMany(
    [author, foreign].map((user) => ({
      publicId: nanoid(),
      gymId: gym._id,
      userId: user._id,
      memberCode: nanoid(),
      status: "ACTIVE",
    })),
  );
  const token = (
    await createSession({ userId: String(author._id), activeRole: "USER" })
  ).accessToken;
  const otherToken = (
    await createSession({ userId: String(foreign._id), activeRole: "USER" })
  ).accessToken;
  async function api(
    method: "get" | "post" | "patch" | "delete",
    path: string,
    body?: object,
    expected = 200,
    auth = token,
  ) {
    assertDatabase();
    const client = request(app);
    const operation = client[method]("/api/v1" + path)
      .set("Authorization", `Bearer ${auth}`)
      .set("idempotency-key", nanoid());
    const response = await (body ? operation.send(body) : operation);
    assert.equal(
      response.status,
      expected,
      `${method} ${path}: ${response.body?.error?.code || response.status}`,
    );
    return response.body;
  }
  const descriptors = [
    {
      ownerId: author._id,
      purpose: "REVIEW",
      status: "READY",
      storageProvider: "s3",
    },
    {
      ownerId: author._id,
      purpose: "REVIEW",
      status: "READY",
      storageProvider: "s3",
    },
    {
      ownerId: foreign._id,
      purpose: "REVIEW",
      status: "READY",
      storageProvider: "s3",
    },
    {
      ownerId: author._id,
      purpose: "AVATAR",
      status: "READY",
      storageProvider: "s3",
    },
    {
      ownerId: author._id,
      purpose: "REVIEW",
      status: "PENDING",
      storageProvider: "s3",
    },
    {
      ownerId: author._id,
      purpose: "REVIEW",
      status: "READY",
      storageProvider: "cloudinary",
    },
    {
      ownerId: author._id,
      purpose: "REVIEW",
      status: "READY",
      storageProvider: "s3",
      deletedAt: new Date(),
    },
  ];
  const files = await Attachment.insertMany(
    descriptors.map((descriptor) => {
      const publicId = nanoid();
      return {
        ...descriptor,
        publicId,
        objectKey: `users/${descriptor.ownerId}/review/${publicId}.png`,
        thumbnailObjectKey: `users/${descriptor.ownerId}/review/${publicId}.png.thumb.webp`,
        mimeType: "image/png",
        size: 100,
      };
    }),
  );
  const base = { gymId: gym.publicId, rating: 5, body: "Test review" };
  for (const file of files.slice(2)) {
    const rejected = await api(
      "post",
      "/users/me/reviews",
      { ...base, attachmentIds: [String(file._id)] },
      422,
    );
    assert.equal(rejected.error.code, "REVIEW_IMAGE_UNAVAILABLE");
    assert.equal(
      await Review.countDocuments({ gymId: gym._id, userId: author._id }),
      0,
    );
  }
  await api(
    "post",
    "/users/me/reviews",
    { ...base, photoUrls: ["https://untrusted.invalid/image.png"] },
    422,
  );
  await api(
    "post",
    "/users/me/reviews",
    { ...base, attachmentIds: [String(files[0]._id), String(files[0]._id)] },
    422,
  );
  const created = (
    await api(
      "post",
      "/users/me/reviews",
      { ...base, attachmentIds: [String(files[0]._id)] },
      201,
    )
  ).data;
  assert.equal(created.images.length, 1);
  assert.equal(created.images[0].id, String(files[0]._id));
  assert.ok(
    created.images[0].url && created.images[0].thumbnailUrl,
    "Authorized image URLs and thumbnails must be resolved.",
  );
  const own = (await api("get", `/users/me/reviews?gymId=${gym.publicId}`))
    .data;
  assert.equal(own.images[0].id, String(files[0]._id));
  const visible = (
    await api("get", `/public/gyms/${gym.slug}/reviews`)
  ).data.find((review: any) => review.publicId === created.publicId);
  assert.equal(
    visible?.images?.[0]?.id,
    String(files[0]._id),
    "Public review projection must preserve attachmentIds for authorized media resolution.",
  );
  const detail = (
    await api("get", `/public/gyms/${gym.slug}`)
  ).data.reviews.find((review: any) => review.publicId === created.publicId);
  assert.equal(
    detail?.images?.[0]?.id,
    String(files[0]._id),
    "Gym detail review projection must also include media references.",
  );

  await api(
    "patch",
    `/users/me/reviews/${created.publicId}`,
    { rating: 3, body: "Unauthorized edit" },
    404,
    otherToken,
  );
  for (const file of files.slice(2))
    await api(
      "patch",
      `/users/me/reviews/${created.publicId}`,
      { rating: 5, attachmentIds: [String(file._id)] },
      422,
    );
  assert.deepEqual(
    (
      await Review.findOne({ publicId: created.publicId }).lean()
    ).attachmentIds.map(String),
    [String(files[0]._id)],
  );
  await api(
    "patch",
    `/users/me/reviews/${created.publicId}`,
    { rating: 4, gymId: gym.publicId },
    422,
  );

  const legacyPhoto = "https://legacy.invalid/existing-review.png";
  await Review.updateOne(
    { publicId: created.publicId },
    { $set: { photoUrls: [legacyPhoto] } },
  );
  await api("patch", `/users/me/reviews/${created.publicId}`, {
    rating: 4,
    body: "Text-only change",
  });
  let persisted = await Review.findOne({ publicId: created.publicId }).lean();
  assert.deepEqual(persisted.photoUrls, [legacyPhoto]);
  assert.deepEqual(persisted.attachmentIds.map(String), [String(files[0]._id)]);
  const edited = (
    await api("patch", `/users/me/reviews/${created.publicId}`, {
      rating: 4,
      attachmentIds: [String(files[1]._id)],
      removeLegacyPhotos: false,
    })
  ).data;
  assert.equal(edited.images[0].id, String(files[1]._id));
  assert.deepEqual(edited.photoUrls, [legacyPhoto]);
  // Deleting an in-use attachment must fail before the provider delete path.
  const originalFetch = globalThis.fetch;
  let attemptedProviderCall = false;
  try {
    globalThis.fetch = async () => {
      attemptedProviderCall = true;
      throw new Error(
        "External provider calls are forbidden in the review regression check.",
      );
    };
    const inUse = await api(
      "delete",
      `/uploads/${files[1].publicId}`,
      undefined,
      409,
    );
    assert.equal(inUse.error.code, "MEDIA_IN_USE");
    assert.equal(attemptedProviderCall, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
  const removed = (
    await api("patch", `/users/me/reviews/${created.publicId}`, {
      rating: 4,
      attachmentIds: [],
      removeLegacyPhotos: true,
    })
  ).data;
  assert.deepEqual(removed.images, []);
  assert.deepEqual(removed.photoUrls, []);
  persisted = await Review.findOne({ publicId: created.publicId }).lean();
  assert.deepEqual(persisted.attachmentIds, []);
  assert.equal(
    await Attachment.countDocuments({
      _id: { $in: files.slice(0, 2).map((file) => file._id) },
      status: "READY",
      deletedAt: null,
    }),
    2,
    "Removing review references must not destructively delete stored media.",
  );

  // Synthetic metadata only: no object with these fresh keys is ever uploaded.
  // The stub forbids ALL network calls except simulated deletion of those exact
  // fixture keys; it never delegates to the real fetch implementation.
  assertDatabase();
  const raceFiles = await Attachment.insertMany(Array.from({ length: 8 }, (_, index) => {
    const publicId = nanoid();
    const objectKey = `users/${author._id}/review/race-${publicId}.png`;
    return {
      publicId, ownerId: author._id, purpose: "REVIEW", storageProvider: "s3",
      status: index === 1 ? "UPLOADED" : "READY", mimeType: "image/png", size: 100,
      objectKey, thumbnailObjectKey: `${objectKey}.thumb.webp`,
    };
  }));
  const permittedDeletes = new Map(raceFiles.flatMap((file) =>
    [file.objectKey, file.thumbnailObjectKey].map((key) => {
      const url = new URL(presignedObjectUrl("DELETE", key, 120));
      return [url.origin + url.pathname, key] as const;
    }),
  ));
  const beforeRaceFetch = globalThis.fetch;
  const providerCalls: string[] = [];
  try {
    globalThis.fetch = async (input, init) => {
      assertDatabase();
      const url = new URL(input instanceof Request ? input.url : String(input));
      const method = init?.method || (input instanceof Request ? input.method : "GET");
      const key = permittedDeletes.get(url.origin + url.pathname);
      assert.equal(method, "DELETE", "Only simulated fixture deletion is allowed in this check");
      assert.ok(key, "Refusing a provider operation outside the exact synthetic fixture keys");
      providerCalls.push(key);
      return new Response(null, { status: 204 });
    };
    const callsBeforeBusy = providerCalls.length;
    await api("delete", `/uploads/${raceFiles[1].publicId}`, undefined, 409);
    assert.equal(providerCalls.length, callsBeforeBusy, "An in-progress upload must never reach provider deletion");
    const uploading = await Attachment.findById(raceFiles[1]._id).lean();
    assert.equal(uploading.status, "UPLOADED");
    assert.equal(uploading.deletedAt, undefined);

    await api("patch", `/users/me/reviews/${created.publicId}`, {
      rating: 4, attachmentIds: [String(raceFiles[0]._id)],
    });
    const callsBeforeInUse = providerCalls.length;
    const inUse = await api("delete", `/uploads/${raceFiles[0].publicId}`, undefined, 409);
    assert.equal(inUse.error.code, "MEDIA_IN_USE");
    assert.equal(providerCalls.length, callsBeforeInUse);
    assert.deepEqual((await Review.findOne({ publicId: created.publicId }).lean()).attachmentIds.map(String), [String(raceFiles[0]._id)]);
    assert.equal((await Attachment.findById(raceFiles[0]._id).lean()).status, "READY");
    await api("patch", `/users/me/reviews/${created.publicId}`, { rating: 4, attachmentIds: [] });

    for (const file of raceFiles.slice(2)) {
      assertDatabase();
      const callsBeforeRace = providerCalls.length;
      const patch = request(app).patch(`/api/v1/users/me/reviews/${created.publicId}`)
        .set("Authorization", `Bearer ${token}`).set("idempotency-key", nanoid())
        .set("x-csrf-protection", "1")
        .send({ rating: 4, attachmentIds: [String(file._id)] });
      const deletion = request(app).delete(`/api/v1/uploads/${file.publicId}`)
        .set("Authorization", `Bearer ${token}`).set("idempotency-key", nanoid())
        .set("x-csrf-protection", "1");
      const [attached, deleted] = await Promise.all([patch, deletion]);
      const [review, storedFile] = await Promise.all([
        Review.findOne({ publicId: created.publicId }).lean(),
        Attachment.findById(file._id).lean(),
      ]);
      const referencesFile = review.attachmentIds.some((id: unknown) => String(id) === String(file._id));
      assert.ok(storedFile, "The attachment audit record must be retained");
      if (attached.status === 200) {
        assert.equal(deleted.status, 409, "Deletion must lose if a review committed its attachment reference");
        assert.equal(referencesFile, true);
        assert.equal(storedFile.status, "READY");
        assert.ok(!storedFile.deletedAt);
        assert.equal(providerCalls.length, callsBeforeRace, "An attached image cannot reach the provider deletion path");
        await api("patch", `/users/me/reviews/${created.publicId}`, { rating: 4, attachmentIds: [] });
      } else {
        assert.equal(deleted.status, 204, "One transaction must win the attach/delete race");
        assert.ok([422, 409].includes(attached.status), `Deleted image attachment must be rejected, got ${attached.status}`);
        assert.equal(referencesFile, false);
        assert.equal(storedFile.status, "DELETED");
        assert.ok(storedFile.deletedAt);
        assert.deepEqual(providerCalls.slice(callsBeforeRace).sort(), [file.objectKey, file.thumbnailObjectKey].sort());
      }
    }
  } finally {
    globalThis.fetch = beforeRaceFetch;
  }
  return [
    "review S3 attachment ownership, purpose/status/provider checks and strict create/edit payloads",
    "review public/private media projection, safe replacement/removal and legacy preservation",
    "review attach/delete races retain valid references; in-use and uploading files never reach provider deletion",
  ];
}
