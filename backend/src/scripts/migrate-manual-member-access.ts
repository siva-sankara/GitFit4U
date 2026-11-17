import "dotenv/config";
import mongoose from "mongoose";
import { env } from "../config/env.js";
import { User } from "../models/User.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { Refund } from "../models/Business.js";
import { AuthIdentity } from "../models/Auth.js";
import { AuditLog } from "../models/Operations.js";

// Dry run by default. Never creates receipts, passwords or verification claims.
const apply = process.argv.includes("--apply");
const counts = { inspected: 0, eligible: 0, changed: 0, skipped: 0, failed: 0 };
try {
  await mongoose.connect(env.MONGO_URI);
  const candidates = MemberProfile.find({ offlineAccessGranted: { $ne: true }, "invitation.status": "PENDING", status: { $in: ["ACTIVE", "INACTIVE"] }, isDeleted: { $ne: true }, deactivatedAt: null }).select("_id").cursor();
  for await (const candidate of candidates) {
    counts.inspected++;
    try {
      const outcome = await mongoose.connection.transaction(async session => {
        const member = await MemberProfile.findOne({ _id: candidate._id, offlineAccessGranted: { $ne: true }, "invitation.status": "PENDING", status: { $in: ["ACTIVE", "INACTIVE"] }, isDeleted: { $ne: true }, deactivatedAt: null }).session(session);
        if (!member) return false;
        const gym = await Gym.exists({ _id: member.gymId, status: "ACTIVE", deletedAt: null }).session(session);
        const sub = await Subscription.findOne({ _id: member.currentSubscriptionId, gymId: member.gymId, userId: member.userId, memberProfileId: member._id, type: "GYM_MEMBERSHIP", status: "ACTIVE", endsAt: { $gt: new Date() } }).session(session);
        const payment = sub && await Payment.findOne({ _id: sub.latestPaymentId, subscriptionId: sub._id, payerId: member.userId, gymId: member.gymId, provider: "OFFLINE", purpose: "MEMBERSHIP", status: "CAPTURED", capturedAt: { $ne: null }, "metadata.collectorId": { $exists: true } }).session(session);
        const user = await User.findOne({ _id: member.userId, status: { $in: ["ACTIVE", "PENDING_VERIFICATION"] } }).session(session);
        if (!gym || !sub || !payment || !user || payment.amountMinor !== sub.planSnapshot.totalMinor || await Refund.exists({ paymentId: payment._id, status: { $in: ["REQUESTED", "PROCESSING", "PROCESSED"] } }).session(session)) return false;
        if (user.status === "PENDING_VERIFICATION" && await AuthIdentity.exists({ userId: user._id }).session(session)) return false;
        if (!apply) return true;
        if (user.status === "PENDING_VERIFICATION") { user.status = "ACTIVE"; user.firstAccessPending = true; await user.save({ session }); }
        member.status = "ACTIVE"; member.offlineAccessGranted = true; await member.save({ session });
        payment.fulfillmentStatus = "APPLIED"; await payment.save({ session });
        await AuditLog.create([{ actorRole: "SYSTEM", gymId: member.gymId, action: "member.offline.invitation-hold.migrated", entityType: "MemberProfile", entityId: member.publicId, outcome: "SUCCESS", reason: "Existing bound cash/offline receipt verified; contact verification and credential setup remain separate." }], { session });
        return true;
      });
      if (outcome) { counts.eligible++; if (apply) counts.changed++; } else counts.skipped++;
    } catch { counts.failed++; }
  }
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", ...counts, guidance: "Existing unclaimed accounts use their setup email or verified account recovery; no temporary passwords are created or exposed." }, null, 2));
  if (counts.failed) process.exitCode = 1;
} finally { await mongoose.disconnect(); }
