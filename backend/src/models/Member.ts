import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const memberProfileSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    memberCode: { type: String, required: true },
    status: { type: String, enum: ["ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"], default: "ACTIVE" },
    joinedAt: { type: Date, default: Date.now },
    currentSubscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" },
    fitnessGoal: String,
    assignedTrainerId: { type: Schema.Types.ObjectId, ref: "Trainer" },
    medicalNotes: { type: String, select: false },
    emergencyContact: { name: String, phone: String, relationship: String },
    ownerNotes: [{ text: String, authorId: { type: Schema.Types.ObjectId, ref: "User" }, createdAt: Date }]
  },
  { timestamps: true, versionKey: "version", optimisticConcurrency: true }
);
memberProfileSchema.index({ gymId: 1, userId: 1 }, { unique: true });
memberProfileSchema.index({ gymId: 1, memberCode: 1 }, { unique: true });
memberProfileSchema.index({ gymId: 1, status: 1, createdAt: -1 });

export const MemberProfile = models.MemberProfile || model("MemberProfile", memberProfileSchema);
