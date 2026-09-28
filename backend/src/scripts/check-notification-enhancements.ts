import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Express } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import request from "supertest";
import { env } from "../config/env.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { MembershipPlan, Subscription } from "../models/Commerce.js";
import { Notification } from "../models/Engagement.js";
import { DeviceToken } from "../models/Collaboration.js";
import { Session } from "../models/Auth.js";
import { AuditLog } from "../models/Operations.js";
import { createSession } from "../services/tokenService.js";
import { sha256 } from "../utils/crypto.js";
import {
  localDateKey,
  reminderStillCurrent,
  scheduleMembershipReminders,
} from "../services/membershipReminderService.js";

/** Database/API checks only. Never starts workers or invokes a push provider. */
export async function checkNotificationEnhancements(input: {
  app: Express;
  owner: any;
  gym: any;
  member: any;
  ownerToken: string;
  memberToken: string;
}): Promise<string[]> {
  assert.match(
    mongoose.connection.db?.databaseName || "",
    /^gfv_[a-f0-9]{32}$/,
    "Notification verification requires the caller's disposable verification database.",
  );
  const { app, owner, gym, member, ownerToken, memberToken } = input;
  assert.equal(String(gym.ownerId), String(owner._id));
  const results: string[] = [];
  const now = new Date();
  const day = 86_400_000;
  const at = (offset: number) => new Date(now.getTime() + offset * day);
  const newGym = (name: string, status = "ACTIVE") =>
    Gym.create({
      publicId: nanoid(18),
      ownerId: owner._id,
      name,
      slug: nanoid(20).toLowerCase(),
      location: { type: "Point", coordinates: [77.5946, 12.9716] },
      status,
      verificationStatus: "VERIFIED",
      platformSubscriptionStatus: status === "ACTIVE" ? "ACTIVE" : "EXPIRED",
      timezone: "Asia/Kolkata",
    });
  const reminderGym = await newGym("Notification verification gym");
  const profile = await MemberProfile.create({
    publicId: nanoid(18),
    gymId: reminderGym._id,
    userId: member._id,
    memberCode: nanoid(12),
    status: "ACTIVE",
  });
  const plan = await MembershipPlan.create({
    publicId: nanoid(18),
    gymId: reminderGym._id,
    code: nanoid(12),
    name: "Verified renewal plan",
    durationDays: 30,
    priceMinor: 250000,
    benefits: ["Gym access"],
    status: "ACTIVE",
  });
  const subscription = await Subscription.create({
    publicId: nanoid(18),
    type: "GYM_MEMBERSHIP",
    userId: member._id,
    gymId: reminderGym._id,
    memberProfileId: profile._id,
    planSnapshot: { name: plan.name, benefits: plan.benefits },
    startsAt: at(-25),
    endsAt: at(5),
    status: "ACTIVE",
  });
  await MemberProfile.updateOne(
    { _id: profile._id },
    { $set: { currentSubscriptionId: subscription._id } },
  );
  const platformGym = await newGym("Expired platform verification gym", "INACTIVE");
  const platformSubscription = await Subscription.create({
    publicId: nanoid(18),
    type: "PLATFORM",
    userId: owner._id,
    gymId: platformGym._id,
    planSnapshot: { name: "Platform subscription" },
    startsAt: at(-33),
    endsAt: at(-3),
    status: "EXPIRED",
  });
  const memberFilter = {
    userId: member._id,
    event: "membership.renewal_reminder",
    entityId: subscription.publicId,
  };
  const platformFilter = {
    userId: owner._id,
    event: "platform.expiring",
    entityId: platformSubscription.publicId,
  };

  await scheduleMembershipReminders(now);
  await scheduleMembershipReminders(now);
  assert.equal(await Notification.countDocuments(memberFilter), 1);
  assert.equal(
    await AuditLog.countDocuments({
      action: "notification.reminder.scheduled",
      entityId: subscription.publicId,
    }),
    1,
  );
  const reminder = await Notification.findOne(memberFilter).lean();
  assert(reminder);
  assert.equal(reminder.metadata.timeZone, reminderGym.timezone);
  assert.equal(reminder.metadata.daysRemaining, 5);
  assert.equal(reminder.metadata.gymName, reminderGym.name);
  assert.equal(reminder.metadata.availablePlans[0].publicId, plan.publicId);
  assert(reminder.dedupeKey.endsWith(localDateKey(now, reminderGym.timezone)));
  assert.equal(await reminderStillCurrent(reminder), true);
  await scheduleMembershipReminders(at(1));
  assert.equal(await Notification.countDocuments(memberFilter), 2);
  results.push("Renewal reminders: one per gym-local day, repeat-job deduplication and audit persistence.");

  const renewal = await Subscription.create({
    publicId: nanoid(18),
    type: "GYM_MEMBERSHIP",
    userId: member._id,
    gymId: reminderGym._id,
    memberProfileId: profile._id,
    planSnapshot: { name: plan.name },
    startsAt: now,
    endsAt: at(35),
    status: "ACTIVE",
  });
  await MemberProfile.updateOne(
    { _id: profile._id },
    { $set: { currentSubscriptionId: renewal._id } },
  );
  assert.equal(await reminderStillCurrent(reminder), false);
  await scheduleMembershipReminders(at(2));
  assert.equal(await Notification.countDocuments(memberFilter), 2);
  await MemberProfile.updateOne(
    { _id: profile._id },
    { $set: { currentSubscriptionId: subscription._id, status: "INACTIVE" } },
  );
  await scheduleMembershipReminders(at(3));
  assert.equal(await Notification.countDocuments(memberFilter), 2);
  assert.equal(await reminderStillCurrent(reminder), false);
  results.push("Renewal/deactivation suppresses old-cycle scheduling and queued delivery eligibility.");

  const platformReminder = await Notification.findOne(platformFilter).lean();
  assert(platformReminder, "An inactive gym still needs platform renewal reminders.");
  assert.equal(platformReminder.actionUrl, `/platform-renewal?gym=${encodeURIComponent(platformGym.publicId)}`);
  assert.equal(await reminderStillCurrent(platformReminder), true);
  const beforeDayEight = await Notification.countDocuments(platformFilter);
  await scheduleMembershipReminders(at(5));
  assert.equal(await Notification.countDocuments(platformFilter), beforeDayEight);
  await Subscription.create({
    publicId: nanoid(18),
    type: "PLATFORM",
    userId: owner._id,
    gymId: platformGym._id,
    planSnapshot: { name: "Renewed platform subscription" },
    startsAt: now,
    endsAt: at(30),
    status: "ACTIVE",
  });
  assert.equal(await reminderStillCurrent(platformReminder), false);
  results.push("Expired platform reminders survive gym inactivity, stop after day seven and reject superseded cycles.");

  const pending = await Notification.create({
    userId: member._id,
    category: "SYSTEM",
    title: "Verification-only notification",
    message: "Disposable database fixture; no push worker is started.",
    channels: ["IN_APP", "PUSH"],
    pushStatus: "QUEUED",
    pushLeaseId: randomUUID(),
    pushLeaseUntil: at(1),
    dedupeKey: `verification:${nanoid(20)}`,
  });
  const pendingPath = `/api/v1/users/me/notifications/${pending._id}`;
  const forbiddenRead = await request(app).get(pendingPath).auth(ownerToken, { type: "bearer" });
  assert.equal(forbiddenRead.status, 404);
  const foreignDelete = await request(app).delete(pendingPath).auth(ownerToken, { type: "bearer" });
  assert.equal(foreignDelete.status, 200);
  assert.equal(foreignDelete.body.data.deleted, 0);
  assert.equal((await Notification.findById(pending._id).lean())?.pushStatus, "QUEUED");
  const ownDelete = await request(app).delete(pendingPath).auth(memberToken, { type: "bearer" });
  assert.equal(ownDelete.status, 200);
  assert.equal(ownDelete.body.data.deleted, 1);
  const deleted = await Notification.findById(pending._id).lean();
  assert(deleted?.archivedAt, "Deleting must retain the notification for audit.");
  assert.equal(deleted.pushStatus, "SKIPPED");
  assert.equal(deleted.pushLeaseId, undefined);
  assert.equal(deleted.pushLeaseUntil, undefined);
  assert.equal((await request(app).get(pendingPath).auth(memberToken, { type: "bearer" })).status, 404);
  results.push("Notification deletion is owner-scoped, soft-deletes history and cancels queued push leases.");

  const firstSession = await createSession({ userId: String(member._id), activeRole: "USER" });
  const secondSession = await createSession({ userId: String(member._id), activeRole: "USER" });
  const deviceFixtures = [];
  for (const session of [firstSession, secondSession]) {
    const fakeToken = `verification-only-not-a-firebase-token-${nanoid(48)}`;
    deviceFixtures.push(await DeviceToken.create({
      userId: member._id,
      sessionId: session.sessionId,
      deviceId: randomUUID(),
      token: fakeToken,
      tokenHash: sha256(fakeToken),
      platform: "WEB",
      permission: "GRANTED",
    }));
  }
  const logout = (refresh: string) => request(app)
    .post("/api/v1/auth/logout")
    .set("x-csrf-protection", "1")
    .set("origin", env.CLIENT_ORIGIN.split(",")[0].trim())
    .set("Cookie", `gfu_refresh=${refresh}`);
  assert.equal((await logout(`${firstSession.sessionId}.forged`)).status, 204);
  assert.equal(await Session.countDocuments({ publicId: firstSession.sessionId, revokedAt: null }), 1);
  assert.equal(await DeviceToken.countDocuments({ _id: deviceFixtures[0]._id, revokedAt: null }), 1);
  assert.equal((await logout(firstSession.refreshToken)).status, 204);
  assert.equal(await Session.countDocuments({ publicId: firstSession.sessionId, revokedAt: null }), 0);
  assert.equal(await DeviceToken.countDocuments({ _id: deviceFixtures[0]._id, revokedAt: null }), 0);
  assert.equal(await Session.countDocuments({ publicId: secondSession.sessionId, revokedAt: null }), 1);
  assert.equal(await DeviceToken.countDocuments({ _id: deviceFixtures[1]._id, revokedAt: null }), 1);
  // Keep the disposable fixtures inert if the caller later tests the delivery worker.
  await logout(secondSession.refreshToken);
  await Notification.updateMany(
    { gymId: { $in: [reminderGym._id, platformGym._id] } },
    { $set: { pushStatus: "SKIPPED" } },
  );
  results.push("Forged refresh tokens cannot revoke sessions/devices; valid logout revokes only its own device session.");
  return results;
}
