import { Payment, Subscription } from "../models/Commerce.js";
import { ClassBooking } from "../models/Engagement.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { RoleAssignment } from "../models/Auth.js";
import { AppError } from "../utils/AppError.js";

export async function supportContext(userId: string) {
  const memberIds = await MemberProfile.distinct("_id", { userId });
  const gyms = [...await MemberProfile.distinct("gymId", { userId }),
    ...await RoleAssignment.distinct("gymId", { userId, status: "ACTIVE" })].filter(Boolean);
  const [gymRows, payments, subscriptions, bookings] = await Promise.all([
    Gym.find({ _id: { $in: gyms }, deletedAt: null }).select("_id publicId name").lean(),
    Payment.find({ payerId: userId }).sort({ createdAt: -1 }).limit(50).select("publicId status amountMinor currency gymId").lean(),
    Subscription.find({ userId }).sort({ createdAt: -1 }).limit(50).select("publicId planSnapshot.name status gymId").lean(),
    ClassBooking.find({ memberProfileId: { $in: memberIds } }).sort({ createdAt: -1 }).limit(50).populate("sessionId", "name startsAt").lean(),
  ]);
  return { gyms: gymRows, references: [
    ...payments.map(row => ({ type: "PAYMENT", id: row.publicId, label: `Payment ${row.publicId} · ${row.status} · ${row.currency} ${(row.amountMinor / 100).toFixed(2)}`, gymId: row.gymId })),
    ...subscriptions.map(row => ({ type: "MEMBERSHIP", id: row.publicId, label: `${row.planSnapshot?.name || "Subscription"} · ${row.status}`, gymId: row.gymId })),
    ...bookings.filter(row => row.sessionId).map(row => ({ type: "BOOKING", id: String(row._id), label: `${row.sessionId.name} · ${row.status}`, gymId: row.gymId })),
  ] };
}
export async function validatedSupportContext(userId: string, gymId?: string, related?: { type: string; id: string }) {
  if (!gymId && !related) return {};
  const context = await supportContext(userId);
  if (gymId && !context.gyms.some(row => String(row._id) === gymId))
    throw new AppError(404, "SUPPORT_CONTEXT_UNAVAILABLE", "Choose a gym associated with your account.");
  const reference = related && context.references.find(row => row.type === related.type && row.id === related.id);
  if (related && (!reference || (gymId && String(reference.gymId) !== gymId)))
    throw new AppError(404, "SUPPORT_REFERENCE_UNAVAILABLE", "Choose an accessible reference for this support request.");
  return { ...(gymId ? { gymId } : {}), ...(reference ? { related: { type: reference.type, id: reference.id, label: reference.label } } : {}) };
}
