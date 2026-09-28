import { MemberProfile } from "../models/Member.js";
import { Subscription } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { shiftCalendarDate, zonedDayStart } from "../utils/gymCalendar.js";

/** One authoritative scope for member discovery and direct class links. */
export async function memberClassScope(userId: string, options: { now?: Date; from?: Date; day?: string; gymId?: string; search?: string } = {}) {
  const now = options.now || new Date();
  const members = await MemberProfile.find({ userId, status: "ACTIVE", "invitation.status": { $ne: "PENDING" } })
    .select("_id gymId currentSubscriptionId").lean();
  const empty = { filter: { _id: { $in: [] } }, eligibleGymCount: 0 };
  if (!members.length) return empty;
  const subscriptions = await Subscription.find({
    userId, type: "GYM_MEMBERSHIP", status: "ACTIVE", startsAt: { $lte: now }, endsAt: { $gt: now },
    $or: members.map((member) => ({ memberProfileId: member._id, gymId: member.gymId,
      ...(member.currentSubscriptionId ? { _id: member.currentSubscriptionId } : {}) })),
  }).select("gymId startsAt endsAt").lean();
  if (!subscriptions.length) return empty;
  const gyms = await Gym.find({ _id: { $in: subscriptions.map((row) => row.gymId) }, status: "ACTIVE",
    verificationStatus: "VERIFIED", platformSubscriptionStatus: "ACTIVE", deletedAt: null })
    .select("_id timezone").lean();
  const eligibleGymCount = gyms.length;
  const allowed = gyms.filter((gym) => !options.gymId || String(gym._id) === options.gymId);
  const windows = allowed.flatMap((gym) => subscriptions.filter((row) => String(row.gymId) === String(gym._id)).map((row) => {
    const floor = Math.max(now.getTime(), options.from?.getTime() || 0, row.startsAt!.getTime(),
      options.day ? zonedDayStart(options.day, gym.timezone || "Asia/Kolkata").getTime() : 0);
    return { gymId: gym._id, startsAt: { $gte: new Date(floor),
      ...(options.day ? { $lt: zonedDayStart(shiftCalendarDate(options.day, 1), gym.timezone || "Asia/Kolkata") } : {}) },
    endsAt: { $lte: row.endsAt } };
  }));
  if (!windows.length) return { ...empty, eligibleGymCount };
  const search = options.search?.trim().slice(0, 80);
  return { eligibleGymCount, filter: { status: "SCHEDULED", $or: windows,
    ...(search ? { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } : {}) } };
}
