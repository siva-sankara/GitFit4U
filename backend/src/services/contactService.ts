import type { Request } from "express";
import mongoose from "mongoose";
import { MemberProfile } from "../models/Member.js";
import { RoleAssignment } from "../models/Auth.js";
import { User } from "../models/User.js";
import { Trainer } from "../models/Engagement.js";
import { WorkoutAssignment } from "../models/Fitness.js";
import { Gym } from "../models/Gym.js";
import { AppError } from "../utils/AppError.js";
import { withUserMedia } from "./userMediaService.js";

export function canViewContactPhone(auth: NonNullable<Request["auth"]>) {
  return auth.role === "ADMIN" ||
    (["GYM_OWNER", "GYM_STAFF", "TRAINER"].includes(auth.role) &&
      auth.permissions.includes("member:read"));
}

// Filter permissions before search and paging. A page of contacts is never an ACL.
export async function contactPipeline(req: Request, options: { q?: string; ids?: string[] } = {}) {
  const auth = req.auth!;
  const admin = auth.role === "ADMIN";
  let gyms: mongoose.Types.ObjectId[] = [];
  let trainer: any = null;
  if (!admin && ["GYM_OWNER", "GYM_STAFF", "TRAINER"].includes(auth.role)) {
    if (!auth.gymId || !(await RoleAssignment.exists({ userId: auth.userId, gymId: auth.gymId, role: auth.role, status: "ACTIVE" })))
      throw new AppError(403, "GYM_ASSIGNMENT_REQUIRED", "Select a gym you are authorized to manage.");
    gyms = [new mongoose.Types.ObjectId(auth.gymId)];
    if (auth.role === "TRAINER") trainer = await Trainer.findOne({ userId: auth.userId, gymId: auth.gymId, status: "ACTIVE" }).select("_id").lean();
  } else if (!admin) {
    // A member cannot widen the directory using a stale staff-session gym ID.
    gyms = await MemberProfile.distinct("gymId", { userId: auth.userId, status: "ACTIVE" });
  }
  const memberAccess = admin || (["GYM_OWNER", "GYM_STAFF"].includes(auth.role) && auth.permissions.includes("member:read")) || Boolean(trainer);
  const membership: any[] = [{ $match: { $expr: { $eq: ["$userId", "$$person"] }, ...(!admin ? { gymId: { $in: gyms } } : {}) } }];
  if (trainer) membership.push(
    { $lookup: { from: WorkoutAssignment.collection.name, let: { member: "$_id" }, pipeline: [{ $match: { trainerId: trainer._id, status: { $ne: "CANCELLED" }, $expr: { $eq: ["$memberProfileId", "$$member"] } } }, { $limit: 1 }], as: "assignedWorkouts" } },
    { $match: { $or: [{ assignedTrainerId: trainer._id }, { "assignedWorkouts.0": { $exists: true } }] } },
  );
  membership.push({ $project: { gymId: 1 } });
  const pipeline: any[] = [
    { $match: { status: "ACTIVE", _id: { $ne: new mongoose.Types.ObjectId(auth.userId), ...(options.ids ? { $in: options.ids.map(id => new mongoose.Types.ObjectId(id)) } : {}) } } },
    { $lookup: { from: RoleAssignment.collection.name, let: { person: "$_id" }, pipeline: [{ $match: { $expr: { $eq: ["$userId", "$$person"] }, status: "ACTIVE", role: { $in: ["GYM_OWNER", "GYM_STAFF", "TRAINER"] }, ...(!admin ? { gymId: { $in: gyms } } : {}) } }, { $project: { gymId: 1 } }], as: "contactAssignments" } },
  ];
  if (memberAccess) pipeline.push({ $lookup: { from: MemberProfile.collection.name, let: { person: "$_id" }, pipeline: membership, as: "contactMemberships" } });
  if (!admin) pipeline.push({ $match: { $or: [{ "contactAssignments.0": { $exists: true } }, ...(memberAccess ? [{ "contactMemberships.0": { $exists: true } }] : [])] } });
  if (options.q) {
    const regex = new RegExp(options.q.replace(/[.*+?^$()|[\]{}\\]/g, "\\$&"), "i");
    const search: any[] = [{ name: regex }];
    if (canViewContactPhone(auth)) search.push({ phone: regex }, { email: regex });
    if (admin) {
      pipeline.push({ $lookup: { from: Gym.collection.name, let: { gyms: { $concatArrays: ["$contactAssignments.gymId", "$contactMemberships.gymId"] } }, pipeline: [{ $match: { name: regex, deletedAt: null, $expr: { $in: ["$_id", "$$gyms"] } } }, { $limit: 1 }], as: "matchingGyms" } });
      search.push({ "matchingGyms.0": { $exists: true } });
    }
    pipeline.push({ $match: { $or: search } });
  }
  pipeline.push({ $project: { _id: 1, publicId: 1, name: 1, avatarUrl: 1, avatarAttachmentId: 1, ...(canViewContactPhone(auth) ? { phone: 1, email: 1 } : {}) } });
  return pipeline;
}

export async function searchContacts(req: Request, { q = "", page = 1, limit = 20 } = {}) {
  const [result] = await User.aggregate([...(await contactPipeline(req, { q })), { $facet: { data: [{ $sort: { name: 1, _id: 1 } }, { $skip: (page - 1) * limit }, { $limit: limit }], count: [{ $count: "total" }] } }]).option({ maxTimeMS: 10000 });
  return { data: await withUserMedia(result?.data || []), total: result?.count?.[0]?.total || 0 };
}

export async function permittedContacts(req: Request, ids: string[]) {
  const unique = [...new Set(ids)].filter(id => id !== req.auth!.userId);
  return unique.length ? User.aggregate(await contactPipeline(req, { ids: unique })).option({ maxTimeMS: 10000 }) : [];
}

export async function assertAllowedParticipants(req: Request, ids: string[]) {
  const unique = [...new Set(ids)].filter(id => id !== req.auth!.userId);
  if ((await permittedContacts(req, unique)).length !== unique.length)
    throw new AppError(403, "PARTICIPANT_FORBIDDEN", "Select a contact assigned to your gym or account.");
}

export async function conversationPeople(req: Request, people: any[]) {
  const rows = people.filter(Boolean);
  const visible = canViewContactPhone(req.auth!) ? await permittedContacts(req, rows.map(person => String(person._id))) : [];
  const phones = new Map(visible.map((person: any) => [String(person._id), person.phone]));
  return withUserMedia(rows.map(person => ({ _id: person._id, publicId: person.publicId, name: person.name, avatarUrl: person.avatarUrl, avatarAttachmentId: person.avatarAttachmentId, ...(phones.has(String(person._id)) ? { phone: phones.get(String(person._id)) } : {}) })));
}

// Compatibility for older bounded selectors, not used to authorize new chats.
export async function allowedContacts(req: Request) {
  return (await searchContacts(req, { limit: 100 })).data;
}
