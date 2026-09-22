import type { Request } from "express";
import { MemberProfile } from "../models/Member.js";
import { RoleAssignment } from "../models/Auth.js";
import { User } from "../models/User.js";
import { Trainer } from "../models/Engagement.js";
import { WorkoutAssignment } from "../models/Fitness.js";
export async function allowedContacts(req: Request) {
  const auth = req.auth!;
  if (auth.role === "ADMIN")
    return User.find({ _id: { $ne: auth.userId }, status: "ACTIVE" })
      .select("_id publicId name")
      .limit(100)
      .lean();
  const gyms = auth.gymId
    ? [auth.gymId]
    : await MemberProfile.distinct("gymId", {
        userId: auth.userId,
        status: "ACTIVE",
      });
  const staff = await RoleAssignment.distinct("userId", {
    gymId: { $in: gyms },
    status: "ACTIVE",
  });
  let members: any[] = [];
  if (["GYM_OWNER", "GYM_STAFF"].includes(auth.role))
    members = await MemberProfile.distinct("userId", {
      gymId: auth.gymId,
      status: "ACTIVE",
    });
  if (auth.role === "TRAINER") {
    const trainer = await Trainer.findOne({
      userId: auth.userId,
      gymId: auth.gymId,
      status: "ACTIVE",
    });
    if (trainer) {
      const ids = await WorkoutAssignment.distinct("memberProfileId", {
        trainerId: trainer._id,
        status: { $ne: "CANCELLED" },
      });
      members = await MemberProfile.distinct("userId", {
        gymId: auth.gymId,
        $or: [{ _id: { $in: ids } }, { assignedTrainerId: trainer._id }],
      });
    }
  }
  return User.find({
    _id: { $in: [...staff, ...members], $ne: auth.userId },
    status: "ACTIVE",
  })
    .select("_id publicId name")
    .limit(1000)
    .lean();
}
