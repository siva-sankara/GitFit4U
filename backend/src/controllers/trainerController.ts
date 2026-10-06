import type { Request, Response } from "express";
import { emitDomainEvent } from "../services/domainEventService.js";
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
import { withMemberMedia } from "../services/userMediaService.js";
import { paginationFromQuery, pageMeta } from "../utils/pagination.js";

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
  const { page, limit, skip } = paginationFromQuery(req.query);
  const memberIds = await WorkoutAssignment.distinct("memberProfileId", {
    trainerId: trainer._id,
    status: { $ne: "CANCELLED" },
  });
  const filter = {
    $or: [{ _id: { $in: memberIds } }, { assignedTrainerId: trainer._id }],
    gymId: trainer.gymId,
  };
  const [data, total] = await Promise.all([MemberProfile.find(filter)
    .populate(
      "userId",
      "publicId name phone email avatarUrl avatarAttachmentId",
    )
    .populate("currentSubscriptionId", "publicId status startsAt endsAt")
    .skip(skip).limit(limit).lean(), MemberProfile.countDocuments(filter)]);
  res.json({ success: true, data: await withMemberMedia(data), meta: pageMeta(page, limit, total) });
}

export async function sessions(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter: any = { trainerId: trainer._id };
  if (req.query.from || req.query.to)
    filter.startsAt = {
      ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}),
      ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {}),
    };
  const [data, total] = await Promise.all([
    ClassSession.find(filter).sort({ startsAt: 1, _id: 1 }).skip(skip).limit(limit).lean(),
    ClassSession.countDocuments(filter),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
}

export async function workoutPlans(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const { page, limit, skip } = paginationFromQuery(req.query);
  const filter = { trainerId: trainer._id, status: { $ne: "ARCHIVED" } };
  const [data, total] = await Promise.all([
    WorkoutPlan.find(filter).sort({ updatedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    WorkoutPlan.countDocuments(filter),
  ]);
  res.json({
    success: true,
    data,
    meta: pageMeta(page, limit, total),
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
    { returnDocument: "after", runValidators: true },
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
  await emitDomainEvent({
    event: "workout.assigned",
    userId: member.userId,
    gymId: trainer.gymId,
    entityId: data.publicId,
    actionUrl: "/app/workouts",
  });
  res.status(201).json({ success: true, data });
}

export async function progress(req: Request, res: Response) {
  const trainer = await trainerFor(req);
  const { page, limit, skip } = paginationFromQuery(req.query);
  const member = await MemberProfile.findOne({
    publicId: req.params.memberId,
    gymId: trainer.gymId,
    assignedTrainerId: trainer._id,
  });
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found.");
  const filter = { memberProfileId: member._id };
  const [data, total] = await Promise.all([
    ProgressEntry.find(filter).sort({ recordedAt: -1, _id: -1 }).skip(skip).limit(limit).lean(),
    ProgressEntry.countDocuments(filter),
  ]);
  res.json({ success: true, data, meta: pageMeta(page, limit, total) });
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
