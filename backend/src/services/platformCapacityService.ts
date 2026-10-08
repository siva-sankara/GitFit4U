import mongoose, { type ClientSession } from "mongoose";
import { Gym } from "../models/Gym.js";
import { Subscription } from "../models/Commerce.js";
import { AppError } from "../utils/AppError.js";

/** All member activation paths (imports, invitations, checkout and restoration)
 * share this check. Legacy gyms without a platform record retain their policy. */
export async function enforcePlatformCapacity(gymId: unknown, kind: "MEMBER" | "STAFF", session: ClientSession | null,
  exclude: { _id?: unknown; userId?: unknown; role?: string } = {}) {
  const subscription = await Subscription.findOne({ gymId, type: "PLATFORM" }).sort({ endsAt: -1 }).session(session);
  if (!subscription) return;
  const limit = subscription.planSnapshot?.[kind === "MEMBER" ? "memberLimit" : "staffLimit"];
  if (limit == null && !subscription.adminAuthorization?.authorizedBy) return;
  const now = new Date();
  if (subscription.status !== "ACTIVE" || subscription.startsAt > now || subscription.endsAt <= now)
    throw new AppError(409, "PLATFORM_ACCESS_EXPIRED", "Renew the gym's platform access before activating additional members or staff.");
  if (!Number.isInteger(limit) || limit < 0) throw new AppError(409, "PLAN_LIMITS_REQUIRED", "This platform term requires explicit capacity limits.");
  if (!session) throw new AppError(409, "CAPACITY_TRANSACTION_REQUIRED", "Capacity changes must use the authorized transactional workflow.");
  const gym = await Gym.findOneAndUpdate({ _id: gymId, status: "ACTIVE", deletedAt: null }, { $inc: { version: 1 } }, { session });
  if (!gym) throw new AppError(409, "GYM_UNAVAILABLE", "This gym cannot activate additional access.");
  const filter: Record<string, unknown> = { gymId, status: "ACTIVE" };
  if (kind === "MEMBER") { filter.isDeleted = { $ne: true }; if (exclude._id) filter._id = { $ne: exclude._id }; }
  else { filter.role = { $in: ["TRAINER", "GYM_STAFF"] }; if (exclude.userId && exclude.role) filter.$nor = [{ userId: exclude.userId, role: exclude.role }]; }
  const used = await mongoose.model(kind === "MEMBER" ? "MemberProfile" : "RoleAssignment").countDocuments(filter).session(session);
  if (used >= limit) throw new AppError(409, "PLATFORM_CAPACITY_REACHED", `The platform plan's ${kind === "MEMBER" ? "member" : "staff"} capacity is full. Upgrade the plan before adding access.`);
}
