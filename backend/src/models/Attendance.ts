import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const gymScannerSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true },
    name: { type: String, required: true },
    status: { type: String, enum: ["ACTIVE", "DISABLED"], default: "ACTIVE" },
    secretVersion: { type: Number, default: 1 },
    lastSeenAt: Date
  },
  { timestamps: true }
);
gymScannerSchema.index({ gymId: 1, status: 1 });

const attendanceEventSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true },
    memberProfileId: { type: Schema.Types.ObjectId, ref: "MemberProfile", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["CHECK_IN", "CHECK_OUT", "CORRECTION"], required: true },
    occurredAt: { type: Date, required: true, default: Date.now },
    localDate: { type: String, required: true },
    source: { type: String, enum: ["QR", "MANUAL", "IMPORT"], required: true },
    scannerId: { type: Schema.Types.ObjectId, ref: "GymScanner" },
    qrNonce: { type: String, unique: true, sparse: true },
    idempotencyKey: { type: String },
    supersedesEventId: { type: Schema.Types.ObjectId, ref: "AttendanceEvent" },
    reason: String,
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true }
    ,locationEvidence: {
      point: { type: { type: String, enum: ["Point"] }, coordinates: [{ type: Number }] },
      accuracyMeters: Number, distanceMeters: Number, allowedRadiusMeters: Number, capturedAt: Date
    }
  },
  { timestamps: true, immutable: true }
);
attendanceEventSchema.index({ gymId: 1, memberProfileId: 1, occurredAt: -1 });
attendanceEventSchema.index({ gymId: 1, localDate: 1, occurredAt: -1 });
attendanceEventSchema.index({ gymId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

const attendanceProjectionSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    memberProfileId: { type: Schema.Types.ObjectId, ref: "MemberProfile", required: true },
    localDate: { type: String, required: true },
    firstCheckInAt: Date,
    lastCheckOutAt: Date,
    visitCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);
attendanceProjectionSchema.index({ gymId: 1, memberProfileId: 1, localDate: 1 }, { unique: true });

const streakProjectionSchema = new Schema(
  {
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true },
    memberProfileId: { type: Schema.Types.ObjectId, ref: "MemberProfile", required: true },
    currentStreak: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    totalVisits: { type: Number, default: 0 },
    lastAttendanceDate: String,
    calculatedAt: Date
  },
  { timestamps: true }
);
streakProjectionSchema.index({ gymId: 1, memberProfileId: 1 }, { unique: true });

export const GymScanner = models.GymScanner || model("GymScanner", gymScannerSchema);
export const AttendanceEvent = models.AttendanceEvent || model("AttendanceEvent", attendanceEventSchema);
export const AttendanceProjection =
  models.AttendanceProjection || model("AttendanceProjection", attendanceProjectionSchema);
export const StreakProjection = models.StreakProjection || model("StreakProjection", streakProjectionSchema);
