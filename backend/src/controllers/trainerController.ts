import type { Request, Response } from "express";
import { nanoid } from "nanoid";
import { Trainer, ClassSession } from "../models/Engagement.js";
import { MemberProfile } from "../models/Member.js";
import { AttendanceEvent } from "../models/Attendance.js";
import {
  WorkoutPlan,
  WorkoutAssignment,
  ProgressEntry,
} from "../models/Fitness.js";
import { Notification } from "../models/Engagement.js";
import { AppError } from "../utils/AppError.js";

async function trainerFor(req: Request) {
  const trainer = await Trainer.findOne({
    userId: req.auth!.userId,
    gymId: req.auth!.gymId,
    status: "ACTIVE",
  });
  if (!trainer)
    throw new AppError(
      403,
      "TRAINER_PROFILE_REQUIRED",
      "An active trainer profile is required.",
    );
  return trainer;
}

export async function dashboard(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const now = new Date();
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const [clients, today, upcoming, pending, attendance] = await Promise.all([
    WorkoutAssignment.distinct("memberProfileId", {
      trainerId: trainer._id,
      status: { $in: ["SCHEDULED", "ACTIVE"] },
    }),
    ClassSession.countDocuments({
      trainerId: trainer._id,
      startsAt: { $gte: now, $lte: dayEnd },
      status: "SCHEDULED",
    }),
    ClassSession.countDocuments({
      trainerId: trainer._id,
      startsAt: { $gt: dayEnd },
      status: "SCHEDULED",
    }),
    WorkoutAssignment.countDocuments({
      trainerId: trainer._id,
      status: "SCHEDULED",
    }),
    AttendanceEvent.countDocuments({
      gymId: trainer.gymId,
      createdBy: req.auth!.userId,
      occurredAt: { $gte: new Date(now.getFullYear(), now.getMonth(), 1) },
    }),
  ]);
  const assigned = await MemberProfile.distinct("_id", {
    gymId: trainer.gymId,
    assignedTrainerId: trainer._id,
  });
  res.json({
    success: true,
    data: {
      totalAssignedClients: new Set([...clients, ...assigned].map(String)).size,
      todaysSessions: today,
      upcomingSessions: upcoming,
      pendingActions: pending,
      monthlySessionAttendance: attendance,
    },
  });
}

export async function clients(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const memberIds = await WorkoutAssignment.distinct("memberProfileId", {
    trainerId: trainer._id,
    status: { $ne: "CANCELLED" },
  });
  const data = await MemberProfile.find({
    $or: [{ _id: { $in: memberIds } }, { assignedTrainerId: trainer._id }],
    gymId: trainer.gymId,
  })
    .populate("userId", "publicId name phone email avatarUrl")
    .populate("currentSubscriptionId", "publicId status startsAt endsAt")
    .lean();
  res.json({ success: true, data });
}

export async function sessions(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const filter: any = { trainerId: trainer._id };
  if (req.query.from || req.query.to)
    filter.startsAt = {
      ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}),
      ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}),
    };
  const data = await ClassSession.find(filter).sort({ startsAt: 1 }).lean();
  res.json({ success: true, data });
}

export async function workoutPlans(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  res.json({
    success: true,
    data: await WorkoutPlan.find({
      trainerId: trainer._id,
      status: { $ne: "ARCHIVED" },
    })
      .sort({ updatedAt: -1 })
      .lean(),
  });
}
export async function createWorkoutPlan(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const data = await WorkoutPlan.create({
    ...req.body,
    publicId: nanoid(20),
    gymId: trainer.gymId,
    trainerId: trainer._id,
  });
  res.status(201).json({ success: true, data });
}
export async function updateWorkoutPlan(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const data = await WorkoutPlan.findOneAndUpdate(
    { publicId: req.params.id, trainerId: trainer._id },
    { $set: req.body, $inc: { version: 1 } },
    { new: true, runValidators: true },
  );
  if (!data)
    throw new AppError(
      404,
      "WORKOUT_PLAN_NOT_FOUND",
      "Workout plan not found.",
    );
  res.json({ success: true, data });
}

export async function assignWorkout(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const member = await MemberProfile.findOne({
    publicId: req.params.memberId,
    gymId: trainer.gymId,
    assignedTrainerId: trainer._id,
  });
  const plan = await WorkoutPlan.findOne({
    publicId: req.body.workoutPlanId,
    trainerId: trainer._id,
    status: "ACTIVE",
  });
  if (!member || !plan)
    throw new AppError(
      404,
      "WORKOUT_ASSIGNMENT_TARGET_NOT_FOUND",
      "Member or active workout plan not found.",
    );
  const data = await WorkoutAssignment.create({
    publicId: nanoid(20),
    gymId: trainer.gymId,
    trainerId: trainer._id,
    memberProfileId: member._id,
    workoutPlanId: plan._id,
    planSnapshot: {
      publicId: plan.publicId,
      name: plan.name,
      version: plan.version,
      exercises: plan.exercises,
    },
    startsAt: req.body.startsAt,
    endsAt: req.body.endsAt,
    status: "SCHEDULED",
    notes: req.body.notes,
  });
  await Notification.create({
    userId: member.userId,
    gymId: trainer.gymId,
    category: "TRAINER",
    title: "New workout plan",
    message: `${plan.name} was assigned to you.`,
    entityType: "MEMBER",
    entityId: member.publicId,
    actionUrl: "/app/profile",
  });
  res.status(201).json({ success: true, data });
}

export async function progress(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const member = await MemberProfile.findOne({
    publicId: req.params.memberId,
    gymId: trainer.gymId,
    assignedTrainerId: trainer._id,
  });
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  const data = await ProgressEntry.find({ memberProfileId: member._id })
    .sort({ recordedAt: -1 })
    .limit(100)
    .lean();
  res.json({ success: true, data });
}
export async function recordProgress(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const member = await MemberProfile.findOne({
    publicId: req.params.memberId,
    gymId: trainer.gymId,
    assignedTrainerId: trainer._id,
  });
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  const data = await ProgressEntry.create({
    ...req.body,
    publicId: nanoid(20),
    gymId: trainer.gymId,
    memberProfileId: member._id,
    recordedBy: req.auth!.userId,
  });
  res.status(201).json({ success: true, data });
}
