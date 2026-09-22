import mongoose from "mongoose";
const { Schema, model, models } = mongoose;
import { ROLES } from "../constants/domain.js";

const userSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    name: { type: String, trim: true, maxlength: 120 },
    registrationRevision: { type: Number, default: 0, select: false },
    phone: { type: String, trim: true, unique: true, sparse: true, index: true },
    email: { type: String, trim: true, lowercase: true, unique: true, sparse: true, index: true },
    avatarUrl: { type: String },
    roles: [{ type: String, enum: ROLES }],
    activeRole: { type: String, enum: ROLES, default: "USER" },
    status: {
      type: String,
      enum: ["ACTIVE", "DISABLED", "BLOCKED", "PENDING_VERIFICATION"],
      default: "ACTIVE",
      index: true
    },
    profile: {
      dateOfBirth: Date,
      gender: { type: String, enum: ["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"] },
      heightCm: Number,
      weightKg: Number,
      fitnessGoal: String,
      emergencyContact: {
        name: String,
        phone: String,
        relationship: String
      }
    },
    lastLoginAt: Date
  },
  { timestamps: true, versionKey: "version" }
);

export const User = models.User || model("User", userSchema);
