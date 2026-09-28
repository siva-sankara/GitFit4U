import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { RoleAssignment } from "../models/Auth.js";
import { MemberProfile } from "../models/Member.js";
import { Subscription } from "../models/Commerce.js";
import { Attachment } from "../models/Business.js";
import { ClassBooking, ClassSession, Notification, Trainer } from "../models/Engagement.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { createSession } from "../services/tokenService.js";
import { scheduleClassReminders } from "../services/classReminderService.js";
import { checkIn } from "../services/attendanceService.js";
import { AttendanceEvent } from "../models/Attendance.js";
import { claimUnusedClassImage } from "../services/classMediaCleanupService.js";
import { saveGymClass } from "../services/classManagementService.js";

// Fixture media never leaves the temporary database; provider uploads are tested separately.
export async function checkClassBookingEnhancements({ assertDatabase }: { assertDatabase: () => void }) {
  assertDatabase();
  assert.match(mongoose.connection.db!.databaseName, /^gfv_[a-f0-9]{32}$/);
  const account = (role = "USER") => User.create({ publicId: nanoid(), name: "Class verification", email: `${nanoid()}@verification.invalid`, roles: [role], activeRole: role, status: "ACTIVE" });
  const owner = await account("GYM_OWNER"), users = await Promise.all([account(), account()]);
  const gym = await Gym.create({ publicId: nanoid(), ownerId: owner._id, name: "Class verification gym", slug: nanoid().toLowerCase(), location: { type: "Point", coordinates: [77, 12] }, status: "ACTIVE", verificationStatus: "VERIFIED", platformSubscriptionStatus: "ACTIVE" });
  await RoleAssignment.create({ userId: owner._id, role: "GYM_OWNER", gymId: gym._id, permissions: OWNER_DEFAULT_PERMISSIONS, status: "ACTIVE" });
  const ownerSession = await createSession({ userId: String(owner._id), activeRole: "GYM_OWNER", activeGymId: String(gym._id) });
  const members = await MemberProfile.create(users.map((user) => ({ publicId: nanoid(), memberCode: nanoid(), gymId: gym._id, userId: user._id, status: "ACTIVE" })));
  const subscriptions = await Subscription.create(users.map((user, index) => ({ publicId: nanoid(), type: "GYM_MEMBERSHIP", userId: user._id, gymId: gym._id, memberProfileId: members[index]._id, planSnapshot: { name: "Verification membership" }, status: "ACTIVE", startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000) })));
  const userSessions = await Promise.all(users.map((user) => createSession({ userId: String(user._id), activeRole: "USER" })));
  const api = (method: "get" | "post" | "patch" | "delete", path: string, token: string, body?: object) => {
    const call = request(app)[method]("/api/v1" + path).set("Authorization", `Bearer ${token}`).set("idempotency-key", nanoid()).set("x-csrf-protection", "1");
    return body ? call.send(body) : call;
  };
  const now = new Date();
  const body = { name: "One final place", category: "YOGA", startsAt: new Date(now.getTime() + 1800000).toISOString(), endsAt: new Date(now.getTime() + 3600000).toISOString(), capacity: 1, trainerId: null, room: "", description: "" };
  const create = await api("post", "/owner/classes", ownerSession.accessToken, body);
  assert.equal(create.status, 201, create.body.error?.code);
  const classId = create.body.data.publicId;
  const competing = await Promise.all(userSessions.map((session) => api("post", `/users/classes/${classId}/bookings`, session.accessToken, {})));
  assert.deepEqual(competing.map((row) => row.status).sort(), [201, 409]);
  const winner = competing.findIndex((row) => row.status === 201), loser = 1 - winner;
  const booking = competing[winner].body.data;
  assert.equal((await ClassSession.findById(create.body.data._id)).bookedCount, 1);
  assert.equal(await ClassBooking.countDocuments({ sessionId: create.body.data._id, status: "BOOKED" }), 1);
  assert.equal(await Notification.countDocuments({ gymId: gym._id, event: "class.booked" }), 1);
  const notification = await Notification.findOne({ entityId: booking._id, event: "class.booked" });
  assert.equal(notification.actionUrl, `/app/classes?booking=${booking._id}`);
  assert.equal(notification.pushStatus, "QUEUED");
  assert.equal((await api("get", `/users/classes/bookings/${booking._id}`, userSessions[winner].accessToken)).status, 200);
  assert.equal((await api("get", `/users/classes/bookings/${booking._id}`, userSessions[loser].accessToken)).status, 404);

  const open = await api("post", "/owner/classes", ownerSession.accessToken, { ...body, name: "Membership eligibility", capacity: 2 });
  await Subscription.updateOne({ _id: subscriptions[loser]._id }, { $set: { status: "FROZEN" } });
  assert.equal((await api("post", `/users/classes/${open.body.data.publicId}/bookings`, userSessions[loser].accessToken, {})).status, 403);
  assert.equal((await ClassSession.findById(open.body.data._id)).bookedCount, 0);
  assert.equal(await Notification.countDocuments({ userId: users[loser]._id, gymId: gym._id, event: "class.booked" }), 0);
  await Subscription.updateOne({ _id: subscriptions[loser]._id }, { $set: { status: "ACTIVE" } });
  const booked = await api("post", `/users/classes/${open.body.data.publicId}/bookings`, userSessions[loser].accessToken, {});
  assert.equal(booked.status, 201);
  const duplicate = await api("post", `/users/classes/${open.body.data.publicId}/bookings`, userSessions[loser].accessToken, {});
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, "ALREADY_BOOKED");
  assert.equal((await ClassSession.findById(open.body.data._id)).bookedCount, 1);

  await scheduleClassReminders(now); await scheduleClassReminders(now);
  assert.equal(await Notification.countDocuments({ gymId: gym._id, event: "class.reminder" }), 2);
  const rescheduled = { ...body, startsAt: new Date(now.getTime() + 2100000).toISOString(), endsAt: new Date(now.getTime() + 3900000).toISOString() };
  assert.equal((await api("patch", `/workspace/classes/${classId}`, ownerSession.accessToken, rescheduled)).status, 200);
  assert.equal(await Notification.countDocuments({ entityId: booking._id, event: "class.updated" }), 1);
  await scheduleClassReminders(now);
  assert.equal(await Notification.countDocuments({ entityId: booking._id, event: "class.reminder" }), 2, "A new scheduled start receives one new reminder cycle");
  const trainer = await Trainer.create({ publicId: nanoid(), gymId: gym._id, name: "Replacement trainer", status: "ACTIVE" });
  assert.equal((await api("patch", `/workspace/classes/${classId}`, ownerSession.accessToken, { ...rescheduled, trainerId: String(trainer._id) })).status, 200);
  assert.equal(await Notification.countDocuments({ entityId: booking._id, event: "class.trainer_changed" }), 1);
  assert.equal((await api("post", `/owner/classes/${classId}/cancel`, ownerSession.accessToken, { reason: "Fixture cancellation" })).status, 200);
  await scheduleClassReminders(now);
  assert.equal(await Notification.countDocuments({ entityId: booking._id, event: "class.reminder" }), 2);
  assert.equal((await ClassBooking.findById(booking._id)).status, "CANCELLED");
  assert.equal(await Notification.countDocuments({ entityId: booking._id, event: "class.cancelled" }), 1);
  const settings = await api("patch", "/owner/gym", ownerSession.accessToken, { classReminders: { enabled: false, leadMinutes: 30 } });
  assert.equal(settings.status, 200);
  assert.equal((await api("patch", "/owner/gym", ownerSession.accessToken, { classReminders: { enabled: true, leadMinutes: 5 } })).status, 422);

  const file = await Attachment.create({ publicId: nanoid(), ownerId: owner._id, gymId: gym._id, purpose: "CLASS_IMAGE", objectKey: `verification/${nanoid()}.png`, mimeType: "image/png", size: 100, status: "READY", storageProvider: "s3" });
  const imageClass = await api("post", "/owner/classes", ownerSession.accessToken, { ...body, imageAttachmentId: String(file._id) });
  assert.equal(imageClass.status, 201, imageClass.body.error?.code);
  assert.equal((await Attachment.findById(file._id)).bindingVersion, 1);
  assert.equal((await api("delete", `/uploads/${file.publicId}`, ownerSession.accessToken)).status, 409, "Bound class media cannot be deleted");
  const details = await api("get", `/public/gyms/${gym.slug}`, userSessions[0].accessToken);
  assert.equal(details.status, 200);
  assert(details.body.data.classes.find((row: any) => row.publicId === imageClass.body.data.publicId).imageUrl);
  const list = await api("get", "/owner/classes", ownerSession.accessToken);
  assert.equal(list.status, 200);
  assert(list.body.data.find((row: any) => row.publicId === imageClass.body.data.publicId).imageUrl);
  await Attachment.updateOne({ _id: file._id }, { $set: { status: "PENDING" } });
  const invalidMedia = await api("post", "/owner/classes", ownerSession.accessToken, { ...body, imageAttachmentId: String(file._id) });
  assert.equal(invalidMedia.status, 422);
  await Attachment.updateOne({ _id: file._id }, { $set: { status: "READY", gymId: new mongoose.Types.ObjectId() } });
  assert.equal((await api("post", "/owner/classes", ownerSession.accessToken, { ...body, imageAttachmentId: String(file._id) })).status, 422);
  assert.equal((await api("patch", `/workspace/classes/${imageClass.body.data.publicId}`, ownerSession.accessToken, { ...body, imageAttachmentId: null })).status, 200);
  assert.equal((await ClassSession.findById(imageClass.body.data._id)).imageAttachmentId, null);
  await Gym.updateOne({ _id: gym._id }, { $set: { attendanceLocationRequired: true } });
  const manual = await api("post", "/owner/scanner/check-in", ownerSession.accessToken, { memberIdentifier: members[winner].publicId, source: "MANUAL", reason: "Owner recorded an in-person visit" });
  assert.equal(manual.status, 201, manual.body.error?.code);
  const attendance = await AttendanceEvent.findOne({ gymId: gym._id, memberProfileId: members[winner]._id });
  assert.equal(attendance.source, "MANUAL");
  assert.equal(String(attendance.createdBy), String(owner._id));
  assert.equal(attendance.createdByRole, "GYM_OWNER");
  assert.equal(attendance.reason, "Owner recorded an in-person visit");
  assert(attendance.occurredAt && attendance.createdAt);
  await assert.rejects(() => checkIn({ gymId: String(gym._id), memberIdentifier: members[loser].publicId, memberUserId: String(users[loser]._id), actorId: String(users[loser]._id), actorRole: "USER", source: "QR" }), (error: any) => error.code === "LOCATION_REQUIRED");
  await Gym.updateOne({ _id: gym._id }, { $set: { attendanceLocationRequired: false } });
  const racePublicId = nanoid();
  const raceFile = await Attachment.create({ publicId: racePublicId, ownerId: owner._id, gymId: gym._id, purpose: "CLASS_IMAGE", objectKey: `gyms/${gym._id}/class_image/${racePublicId}.png`, mimeType: "image/png", size: 100, status: "READY", storageProvider: "s3" });
  assert.equal(await claimUnusedClassImage(raceFile._id, new Date()), null, "A fresh upload stays within its cleanup retention window");
  await Attachment.updateOne({ _id: raceFile._id }, { $set: { updatedAt: new Date(Date.now() - 2 * 86400000) } }, { timestamps: false });
  const race = await Promise.allSettled([
    saveGymClass({ gymId: String(gym._id), actorId: String(owner._id), body: { ...body, imageAttachmentId: String(raceFile._id) } }),
    claimUnusedClassImage(raceFile._id, new Date()),
  ]);
  const raceReference = await ClassSession.exists({ imageAttachmentId: raceFile._id });
  const raceImage = await Attachment.findById(raceFile._id);
  assert(race.every(result => result.status === "fulfilled") || race[0].status === "rejected");
  if (raceReference) { assert.equal(raceImage.status, "READY"); assert.equal(race[1].status === "fulfilled" && race[1].value, null); }
  else { assert.equal(raceImage.status, "DELETING"); assert.equal(race[0].status, "rejected"); }
  return [
    "Final-seat competition commits one booking/notification; frozen membership and duplicate attempts roll back seat increments",
    "Booking detail deep links enforce ownership and class reschedule, trainer change and cancellation enqueue exact-booking events",
    "Configurable class reminders deduplicate retries, reset for rescheduling and stop on cancellation",
    "Class image binding validates completed S3 ownership/tenant, blocks deletion while bound and supports explicit removal (storage fixture; no external upload)",
    "Owner manual attendance succeeds without GPS and preserves actor/role/reason while QR attendance still enforces configured location checks",
    "Fresh class uploads are retained and real concurrent attachment/deletion claims cannot leave a class pointing at deleted media (no storage operation invoked)",
  ];
}
