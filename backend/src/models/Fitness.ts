import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const exerciseSchema = new Schema({
  name: { type: String, required: true }, sets: { type: Number, min: 1 }, reps: String,
  durationSeconds: { type: Number, min: 1 }, restSeconds: { type: Number, min: 0 }, notes: { type: String, maxlength: 1000 }
}, { _id: true });

const workoutPlanSchema = new Schema({
  publicId: { type: String, required: true, unique: true },
  gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true },
  trainerId: { type: Schema.Types.ObjectId, ref: "Trainer", required: true, index: true },
  name: { type: String, required: true, trim: true, maxlength: 160 },
  description: { type: String, maxlength: 3000 },
  goal: { type: String, maxlength: 200 },
  version: { type: Number, min: 1, default: 1 },
  exercises: [exerciseSchema],
  status: { type: String, enum: ["DRAFT", "ACTIVE", "ARCHIVED"], default: "DRAFT" }
}, { timestamps: true, optimisticConcurrency: true });
workoutPlanSchema.index({ gymId: 1, trainerId: 1, status: 1 });

const workoutAssignmentSchema = new Schema({
  publicId: { type: String, required: true, unique: true },
  gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true },
  trainerId: { type: Schema.Types.ObjectId, ref: "Trainer", required: true },
  memberProfileId: { type: Schema.Types.ObjectId, ref: "MemberProfile", required: true, index: true },
  workoutPlanId: { type: Schema.Types.ObjectId, ref: "WorkoutPlan", required: true },
  planSnapshot: { type: Schema.Types.Mixed, required: true },
  startsAt: { type: Date, required: true }, endsAt: Date,
  status: { type: String, enum: ["SCHEDULED", "ACTIVE", "COMPLETED", "CANCELLED"], default: "SCHEDULED" },
  notes: { type: String, maxlength: 2000 }
}, { timestamps: true });
workoutAssignmentSchema.index({ memberProfileId: 1, status: 1, startsAt: -1 });

const progressEntrySchema = new Schema({
  publicId: { type: String, required: true, unique: true },
  gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true },
  memberProfileId: { type: Schema.Types.ObjectId, ref: "MemberProfile", required: true, index: true },
  recordedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  recordedAt: { type: Date, default: Date.now },
  weightKg: { type: Number, min: 20, max: 400 }, bodyFatPercent: { type: Number, min: 1, max: 80 },
  measurements: { chestCm: Number, waistCm: Number, hipsCm: Number, armCm: Number, thighCm: Number },
  performance: { type: Schema.Types.Mixed }, photoUrls: [String], notes: { type: String, maxlength: 3000 }
}, { timestamps: true });
progressEntrySchema.index({ memberProfileId: 1, recordedAt: -1 });

export const WorkoutPlan = models.WorkoutPlan || model("WorkoutPlan", workoutPlanSchema);
export const WorkoutAssignment = models.WorkoutAssignment || model("WorkoutAssignment", workoutAssignmentSchema);
export const ProgressEntry = models.ProgressEntry || model("ProgressEntry", progressEntrySchema);
