import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { app } from "../app.js";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { RoleAssignment } from "../models/Auth.js";
import { MemberProfile } from "../models/Member.js";
import { Subscription } from "../models/Commerce.js";
import { ClassSession, ClassBooking } from "../models/Engagement.js";
import { GymScanner, AttendanceEvent } from "../models/Attendance.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { createSession } from "../services/tokenService.js";
import { issueGymQr } from "../services/attendanceQrService.js";

export async function checkAttendanceClassAccess({ assertDatabase }: { assertDatabase: () => void }) {
  assertDatabase(); assert.match(mongoose.connection.db!.databaseName, /^gfv_[a-f0-9]{32}$/);
  const checks: string[] = [];
  const account = (role = "USER") => User.create({ publicId: nanoid(), name: "Scope fixture", email: `${nanoid()}@verification.invalid`, roles: [role], activeRole: role, status: "ACTIVE" });
  const owner = await account("GYM_OWNER");
  const users = await Promise.all(Array.from({ length: 10 }, () => account()));
  const gyms = await Gym.create(["A", "B"].map((name) => ({ publicId: nanoid(), ownerId: owner._id, name: `Scope ${name}`, slug: nanoid().toLowerCase(), location: { type: "Point", coordinates: [77, 12] }, status: "ACTIVE", verificationStatus: "VERIFIED", platformSubscriptionStatus: "ACTIVE" })));
  await RoleAssignment.create(gyms.map((gym: any) => ({ userId: owner._id, role: "GYM_OWNER", gymId: gym._id, permissions: OWNER_DEFAULT_PERMISSIONS, status: "ACTIVE" })));
  const sessions = await Promise.all(users.map((user) => createSession({ userId: String(user._id), activeRole: "USER" })));
  const ownerSession = await createSession({ userId: String(owner._id), activeRole: "GYM_OWNER", activeGymId: String(gyms[0]._id) });
  const api = (method: "get" | "post", path: string, token?: string, body?: object) => {
    const call = request(app)[method]("/api/v1" + path).set("idempotency-key", nanoid()).set("x-csrf-protection", "1");
    if (token) call.set("Authorization", `Bearer ${token}`);
    return body ? call.send(body) : call;
  };
  const access = async (index: number, gym: any, status = "ACTIVE", extra: any = {}) => {
    const member = await MemberProfile.create({ publicId: nanoid(), memberCode: nanoid(), userId: users[index]._id, gymId: gym._id, status: "ACTIVE", ...extra.member });
    const subscription = await Subscription.create({ publicId: nanoid(), userId: users[index]._id, gymId: gym._id, memberProfileId: member._id, type: "GYM_MEMBERSHIP", status,
      startsAt: new Date(Date.now() - 86400000), endsAt: new Date(Date.now() + 86400000), planSnapshot: { name: "Fixture" }, ...extra.subscription });
    await MemberProfile.updateOne({ _id: member._id }, { $set: { currentSubscriptionId: subscription._id } });
    return { member, subscription };
  };
  const a = await access(0, gyms[0]); await access(1, gyms[1]);
  await access(3, gyms[0]); await access(3, gyms[1]);
  await access(4, gyms[0], "FROZEN");
  await access(5, gyms[0], "ACTIVE", { subscription: { endsAt: new Date(Date.now() - 1000) } });
  await access(6, gyms[0], "ACTIVE", { member: { invitation: { status: "PENDING" } } });
  await access(7, gyms[0], "ACTIVE", { member: { status: "INACTIVE" } });
  await access(8, gyms[0], "ACTIVE", { subscription: { startsAt: new Date(Date.now() + 10000) } });
  await access(9, gyms[0], "CANCELLED");
  const classes = await ClassSession.create(gyms.map((gym: any) => ({ publicId: nanoid(), gymId: gym._id, name: `Eligible ${gym.name}`, category: "YOGA", startsAt: new Date(Date.now() + 3600000), endsAt: new Date(Date.now() + 7200000), capacity: 20, status: "SCHEDULED" })));
  const list = async (index: number, query = "") => {
    const result = await api("get", "/users/classes" + query, sessions[index].accessToken);
    assert.equal(result.status, 200, result.body.error?.code); return result.body;
  };
  for (const index of [0, 1]) {
    const result = await list(index);
    assert.deepEqual(result.data.map((row: any) => row.publicId), [classes[index].publicId]);
    assert.equal(result.meta.total, 1); assert.equal(result.meta.eligibleGymCount, 1);
  }
  assert.equal((await list(3)).meta.total, 2);
  for (const index of [2, 4, 5, 6, 7, 8, 9]) {
    const result = await list(index); assert.equal(result.meta.total, 0); assert.equal(result.meta.eligibleGymCount, 0); assert.deepEqual(result.data, []);
    assert.equal((await api("get", `/users/classes/${classes[0].publicId}`, sessions[index].accessToken)).status, 404);
    assert.equal((await api("post", `/users/classes/${classes[0].publicId}/bookings`, sessions[index].accessToken, {})).status, 403);
  }
  assert.equal((await list(0, `?gymId=${gyms[1]._id}&userId=${users[1]._id}&q=Eligible`)).meta.total, 0);
  assert.equal((await list(0, "?q=Scope%20B")).meta.total, 0);
  assert.equal((await list(0, "?limit=1&page=2")).data.length, 0);
  assert.equal((await api("get", `/users/classes/${classes[1].publicId}`, sessions[0].accessToken)).status, 404);
  assert.equal((await api("post", `/users/classes/${classes[1].publicId}/bookings`, sessions[0].accessToken, { userId: String(users[1]._id), gymId: String(gyms[1]._id) })).status, 403);
  assert.equal((await ClassSession.findById(classes[0]._id)).bookedCount, 0);
  assert.equal((await ClassSession.findById(classes[1]._id)).bookedCount, 0);
  checks.push("A/B/multiple/no/frozen/expired/pending/inactive/future/cancelled memberships scope list, count, pagination, search, detail and booking; forged gym/user parameters cannot expand access");
  const booked = await api("post", `/users/classes/${classes[0].publicId}/bookings`, sessions[0].accessToken, {});
  assert.equal(booked.status, 201, booked.body.error?.code);
  await Subscription.updateOne({ _id: a.subscription._id }, { $set: { status: "EXPIRED" } });
  assert.equal((await list(0)).meta.total, 0);
  assert.equal((await api("get", `/users/classes/bookings/${booked.body.data._id}`, sessions[0].accessToken)).status, 200);
  assert.equal((await api("get", `/users/classes/bookings/${booked.body.data._id}`, sessions[1].accessToken)).status, 404);
  assert.equal(await ClassBooking.countDocuments({ _id: booked.body.data._id }), 1);
  await Subscription.updateOne({ _id: a.subscription._id }, { $set: { status: "ACTIVE" } });
  checks.push("Expired membership removes upcoming discovery while the user's own historical booking remains accessible");

  const displayed = await Promise.all(Array.from({ length: 5 }, () => api("get", "/owner/attendance/qr", ownerSession.accessToken)));
  displayed.forEach((result) => assert.equal(result.status, 200, result.body.error?.code));
  const qrToken = displayed[0].body.data.token;
  assert.equal(new Set(displayed.map((result) => result.body.data.token)).size, 1);
  assert.equal(await GymScanner.countDocuments({ gymId: gyms[0]._id, kind: "GYM_IDENTITY" }), 1);
  assert.equal((await GymScanner.findOne({ gymId: gyms[0]._id, kind: "GYM_IDENTITY" })).qrPayload, qrToken);
  const oldSecret = env.ATTENDANCE_QR_SECRET;
  try {
    env.ATTENDANCE_QR_SECRET = "isolated-redeployment-fixture-secret-change";
    await Gym.updateOne({ _id: gyms[0]._id }, { $set: { name: "Renamed gym", logoUrl: "https://images.invalid/new.png" } });
    const newOwnerSession = await createSession({ userId: String(owner._id), activeRole: "GYM_OWNER", activeGymId: String(gyms[0]._id) });
    assert.equal((await api("get", "/owner/attendance/qr", newOwnerSession.accessToken)).body.data.token, qrToken);
    assert.equal((await api("post", "/owner/attendance/qr/rotate", ownerSession.accessToken, {})).status, 410);
  } finally { env.ATTENDANCE_QR_SECRET = oldSecret; }
  assert.equal((await api("post", "/users/me/attendance/check-in", undefined, { qrToken })).status, 401);
  assert.equal((await api("post", "/users/me/attendance/check-in", sessions[1].accessToken, { qrToken, memberIdentifier: a.member.publicId })).status, 403);
  for (const index of [4, 5, 6, 7, 8, 9]) {
    const result = await api("post", "/users/me/attendance/check-in", sessions[index].accessToken, { qrToken });
    assert([403, 404, 409].includes(result.status), `ineligible attendance status ${result.status}`);
  }
  const checked = await Promise.all(Array.from({ length: 3 }, () => api("post", "/users/me/attendance/check-in", sessions[0].accessToken, { qrToken })));
  assert(checked.every((result) => [200, 201].includes(result.status)));
  assert.equal(checked.filter((result) => result.body.data.duplicate === false).length, 1);
  assert.equal(await AttendanceEvent.countDocuments({ gymId: gyms[0]._id, userId: users[0]._id }), 1);
  checks.push("Concurrent QR display creates one permanent identity; saved bytes survive new login, gym edits and signing-secret change; rotation disabled; auth/current membership and concurrent daily attendance uniqueness enforced");

  const legacyReference = nanoid(24), legacyGym = gyms[1];
  await GymScanner.create({ publicId: legacyReference, gymId: legacyGym._id, kind: "GYM_IDENTITY", secretVersion: 2, name: "Previously printed", status: "ACTIVE" });
  const printed = issueGymQr(String(legacyGym._id), legacyReference, 2);
  const legacyOwner = await createSession({ userId: String(owner._id), activeRole: "GYM_OWNER", activeGymId: String(legacyGym._id) });
  assert.equal((await api("get", "/owner/attendance/qr", legacyOwner.accessToken)).body.data.token, printed);
  try {
    env.ATTENDANCE_QR_SECRET = "isolated-another-deployment-secret";
    assert.equal((await api("get", "/owner/attendance/qr", legacyOwner.accessToken)).body.data.token, printed);
    assert.equal((await api("post", "/users/me/attendance/check-in", sessions[1].accessToken, { qrToken: printed })).status, 201);
    assert.equal((await api("post", "/users/me/attendance/check-in", sessions[1].accessToken, { qrToken: issueGymQr(String(legacyGym._id), legacyReference, 1) })).status, 410);
  } finally { env.ATTENDANCE_QR_SECRET = oldSecret; }
  await Gym.updateOne({ _id: legacyGym._id }, { $set: { status: "SUSPENDED" } });
  assert.equal((await api("post", "/users/me/attendance/check-in", sessions[1].accessToken, { qrToken: printed })).status, 409);
  checks.push("Legacy printed v2 bytes are saved unchanged and remain usable after secret change; old revoked revisions and suspended gyms stay blocked");
  return checks;
}
