import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const memberProfileSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: true,
      index: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    memberCode: { type: String, required: true },
    status: {
      type: String,
      enum: ["JOIN_REQUESTED", "ACTIVE", "INACTIVE", "SUSPENDED", "ARCHIVED"],
      default: "ACTIVE",
    },
    contact: {
      name: String, email: String, phone: String, avatarUrl: String,
      avatarAttachmentId: { type: Schema.Types.ObjectId, ref: "Attachment" },
    },
    directAccess: { type: Boolean, default: false },
    directAccessBeforeDeactivation: { type: Boolean, default: false },
    deactivatedAt: Date,
    deactivatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deactivationReason: String,
    reactivatedAt: Date,
    reactivatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    reactivationReason: String,
    approvedAt: Date,
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    joinedAt: { type: Date, default: Date.now },
    currentSubscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" },
    fitnessGoal: String,
    assignedTrainerId: { type: Schema.Types.ObjectId, ref: "Trainer" },
    trainerAssignedAt: Date,
    medicalNotes: { type: String, select: false },
    emergencyContact: { name: String, phone: String, relationship: String },
    ownerNotes: [
      {
        text: String,
        authorId: { type: Schema.Types.ObjectId, ref: "User" },
        createdAt: Date,
      },
    ],
  },
  { timestamps: true, versionKey: "version", optimisticConcurrency: true },
);
memberProfileSchema.index({ gymId: 1, userId: 1 }, { unique: true });
memberProfileSchema.index({ gymId: 1, memberCode: 1 }, { unique: true });
memberProfileSchema.index({ gymId: 1, status: 1, createdAt: -1 });
memberProfileSchema.index({ "contact.avatarAttachmentId": 1 });
memberProfileSchema.index({ gymId: 1, assignedTrainerId: 1, createdAt: -1 });
memberProfileSchema.index({ gymId: 1, currentSubscriptionId: 1 });

export const MemberProfile =
  models.MemberProfile || model("MemberProfile", memberProfileSchema);
