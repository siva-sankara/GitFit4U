import assert from "node:assert/strict";
import mongoose from "mongoose";
import request from "supertest";
import { nanoid } from "nanoid";
import { app } from "../app.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { RoleAssignment } from "../models/Auth.js";
import { MembershipPlan, Payment, PlatformPlan, Subscription } from "../models/Commerce.js";
import { ClassSession } from "../models/Engagement.js";
import { OWNER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { createSession } from "../services/tokenService.js";
import { platformRenewalQuote } from "../services/platformRenewalService.js";
import { calendarDate, shiftCalendarDate, zonedDayStart } from "../utils/gymCalendar.js";

// Called only by the guarded isolated verification runner. This helper neither
// connects to a database nor drops one, and never invokes an external provider.
export async function checkOwnerRegressions() {
  assert.match(mongoose.connection.db!.databaseName, /^gfv_[a-f0-9]{32}$/);
  assert.equal(mongoose.get("strictQuery"), true, "Use the application's real strict query configuration");
  const results: string[] = [];
  const account = (name: string, role = "USER") => User.create({
    publicId: nanoid(), name, email: `${nanoid()}@verification.invalid`,
    roles: [role], activeRole: role, status: "ACTIVE",
  });
  const owner = await account("Owner regression fixture", "GYM_OWNER");
  const goldUser = await account("Gold regression fixture");
  const silverUser = await account("Silver regression fixture");
  const directUser = await account("Direct access regression fixture");
  const timezone = "America/New_York";
  const today = calendarDate(new Date(), timezone);
  const gym = await Gym.create({
    publicId: nanoid(), ownerId: owner._id, name: "Owner regression gym",
    slug: nanoid().toLowerCase(), timezone,
    location: { type: "Point", coordinates: [77, 12] },
    status: "ACTIVE", verificationStatus: "VERIFIED", platformSubscriptionStatus: "ACTIVE",
    contact: { email: "owner@verification.invalid", website: "https://verification.invalid" },
  });
  await RoleAssignment.create({
    userId: owner._id, role: "GYM_OWNER", gymId: gym._id,
    permissions: OWNER_DEFAULT_PERMISSIONS, status: "ACTIVE",
  });
  const ownerSession = await createSession({ userId: String(owner._id), activeRole: "GYM_OWNER", activeGymId: String(gym._id) });
  const userSession = await createSession({ userId: String(goldUser._id), activeRole: "USER" });
  async function api(method: "get" | "post" | "patch" | "delete", path: string, body?: object, expected = 200, token = ownerSession.accessToken) {
    const operation = request(app)[method]("/api/v1" + path)
      .set("Authorization", `Bearer ${token}`)
      .set("idempotency-key", nanoid()).set("x-csrf-protection", "1");
    const response = await (body ? operation.send(body) : operation);
    assert.equal(response.status, expected, `${method} ${path}: ${response.body?.error?.code || response.status}`);
    return response.body;
  }
  const plans = await MembershipPlan.create([10000, 15000].map((priceMinor, index) => ({
    publicId: nanoid(), gymId: gym._id, code: nanoid(), name: index ? "Silver" : "Gold",
    durationDays: 30, priceMinor, status: "ACTIVE",
  })));
  const create = async (user: any, plan: any) => (await api("post", "/owner/members", {
    name: user.name, email: user.email, planId: plan.publicId, startsAt: today,
    payment: { amountMinor: plan.priceMinor, method: "CASH", paidAt: today, reference: nanoid() },
  }, 201)).data;
  const gold = await create(goldUser, plans[0]);
  const silver = await create(silverUser, plans[1]);
  const filtered = await api("get", `/owner/members?planId=${plans[0].publicId}`);
  assert.equal(filtered.meta.total, 1);
  assert.equal(filtered.data[0].publicId, gold.member.publicId);
  assert.equal(filtered.data[0].currentSubscriptionId.planSnapshot.planId, plans[0].publicId);
  results.push("Real MongoDB strictQuery plan filtering retains planSnapshot.planId and excludes another plan");

  const payment = await Payment.findById(gold.payment._id);
  const subscription = await Subscription.findById(gold.subscription._id);
  assert.equal(payment.capturedAt.getTime(), zonedDayStart(today, timezone).getTime());
  assert.equal(subscription.startsAt.getTime(), zonedDayStart(today, timezone).getTime());
  assert.equal(subscription.endsAt.getTime(), zonedDayStart(shiftCalendarDate(today, 30), timezone).getTime());
  const revenue = (await api("get", `/owner/revenue?period=custom&from=${today}&to=${today}`)).data;
  assert.equal(revenue.transactionCount, 2);
  assert.equal(revenue.totalMinor, 25000);
  assert.deepEqual(revenue.series.map((row: any) => row.date), [today]);
  results.push("Calendar member/payment inputs persist at gym-local midnight and reconcile with same-day revenue");

  const direct = await MemberProfile.create({
    publicId: nanoid(), memberCode: nanoid(), gymId: gym._id, userId: directUser._id,
    status: "ACTIVE", directAccess: true,
  });
  await api("patch", `/owner/members/${silver.member.publicId}`, { status: "SUSPENDED" });
  const active = (await api("get", "/owner/members?membershipStatus=ACTIVE")).data;
  assert.deepEqual(active.map((row: any) => row.publicId).sort(), [gold.member.publicId, direct.publicId].sort());
  const cancelled = (await api("get", "/owner/members?membershipStatus=DEACTIVATED")).data;
  assert.deepEqual(cancelled.map((row: any) => row.publicId), [silver.member.publicId]);
  const platformPlan = await PlatformPlan.create({
    code: nanoid(), name: "Exact active capacity", billingPeriod: "MONTHLY",
    priceMinor: 10000, memberLimit: 2, staffLimit: 2,
  });
  await Subscription.create({
    publicId: nanoid(), type: "PLATFORM", userId: owner._id, gymId: gym._id,
    status: "ACTIVE", startsAt: new Date(), endsAt: new Date(Date.now() + 5 * 86400000),
    planSnapshot: { name: "Current platform", memberLimit: 2 },
  });
  const dashboard = (await api("get", "/owner/dashboard")).data;
  assert.equal(dashboard.totalMembers, 3);
  assert.equal(dashboard.activeMembers, 2);
  assert.equal(dashboard.platformSubscription.usage.members, 2);
  assert.equal(dashboard.expiringMemberships, 0, "A platform renewal is not an expiring gym membership");
  const quote = await platformRenewalQuote(String(owner._id), String(gym._id), String(platformPlan._id));
  assert.equal(quote.planSnapshot.memberLimit, dashboard.platformSubscription.usage.members);
  results.push("Direct/deactivated status filters, active capacity eligibility, and membership-only expiry KPIs agree");

  await api("patch", "/owner/gym", { contact: { website: null, email: null } });
  const savedGym = await Gym.findById(gym._id);
  assert.equal(savedGym.contact.website, null);
  assert.equal(savedGym.contact.email, null);
  results.push("Explicit clearing persists for optional gym contact fields");

  const sessions = await ClassSession.create(Array.from({ length: 13 }, (_, index) => {
    const startsAt = new Date(Date.now() + 2 * 86400000 + index * 3600000);
    return { publicId: nanoid(), gymId: gym._id, name: `Pagination class ${index + 1}`,
      category: "YOGA", startsAt, endsAt: new Date(startsAt.getTime() + 1800000), capacity: 4 };
  }));
  const target = sessions[12];
  const booking = (await api("post", `/users/classes/${target.publicId}/bookings`, {}, 201, userSession.accessToken)).data;
  const secondPage = await api("get", `/users/classes?gymId=${gym._id}&page=2&limit=12`, undefined, 200, userSession.accessToken);
  assert.equal(secondPage.meta.pages, 2);
  assert.equal(secondPage.meta.total, 13);
  assert.equal(secondPage.data[0].publicId, target.publicId);
  assert.equal(secondPage.data[0].myBooking._id, booking._id);
  await api("delete", `/users/classes/${target.publicId}/bookings/${booking._id}`, undefined, 200, userSession.accessToken);
  assert.equal((await ClassSession.findById(target._id)).bookedCount, 0);
  const afterCancel = await api("get", `/users/classes?gymId=${gym._id}&page=2&limit=12`, undefined, 200, userSession.accessToken);
  assert.equal(afterCancel.data[0].myBooking, null);
  results.push("Class pages expose the user's own booking and cancellation safely releases the reserved seat");
  return results;
}
