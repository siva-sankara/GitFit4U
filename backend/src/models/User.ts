import mongoose from "mongoose";
const { Schema, model, models } = mongoose;
import { ROLES } from "../constants/domain.js";
import { normalizeAccountPhone, normalizeEmail } from "../utils/accountIdentity.js";

const userSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true, index: true },
    name: { type: String, trim: true, maxlength: 120 },
    registrationRevision: { type: Number, default: 0, select: false },
    developmentTestAccount: { type: Boolean, default: false },
    phone: {
      type: String,
      trim: true,
      set: (value: string | null | undefined) => typeof value === "string" ? value.trim() ? normalizeAccountPhone(value) : undefined : value == null ? undefined : value,
      unique: true,
      sparse: true,
      index: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      set: (value: string | null | undefined) => typeof value === "string" ? normalizeEmail(value) || undefined : value == null ? undefined : value,
      unique: true,
      sparse: true,
      index: true,
    },
    avatarUrl: { type: String },
    avatarAttachmentId: { type: Schema.Types.ObjectId, ref: "Attachment" },
    social: {
      bio: { type: String, trim: true, maxlength: 500 },
      location: { type: String, trim: true, maxlength: 120 },
      fitnessInterests: [{ type: String, trim: true, maxlength: 60 }],
      visibility: {
        type: String,
        enum: ["PUBLIC", "PRIVATE"],
        default: "PRIVATE",
      },
      timezone: { type: String, default: "Asia/Kolkata" },
    },
    preferences: {
      theme: {
        type: String,
        enum: ["light", "dark"],
        default: "dark",
        set: (value: string) => value === "system" ? "dark" : value,
      },
    },
    notificationPreferences: {
      push: { type: Boolean, default: true },
      sound: { type: Boolean, default: false },
      categories: { type: [String], default: undefined },
    },
    roles: [{ type: String, enum: ROLES }],
    activeRole: { type: String, enum: ROLES, default: "USER" },
    status: {
      type: String,
      enum: ["ACTIVE", "DISABLED", "BLOCKED", "PENDING_VERIFICATION"],
      default: "ACTIVE",
      index: true,
    },
    profile: {
      dateOfBirth: Date,
      gender: {
        type: String,
        enum: ["MALE", "FEMALE", "NON_BINARY", "PREFER_NOT_TO_SAY"],
      },
      heightCm: Number,
      weightKg: Number,
      fitnessGoal: String,
      emergencyContact: {
        name: String,
        phone: String,
        relationship: String,
      },
    },
    lastLoginAt: Date,
  },
  { timestamps: true, versionKey: "version" },
);

userSchema.index({ status: 1, "social.visibility": 1, name: 1, _id: 1 });

// Existing hydrated accounts remain editable before the batch migration runs.
userSchema.post("init", (user: any) => {
  if (user.preferences?.theme === "system") user.set("preferences.theme", "dark");
});

export const User = models.User || model("User", userSchema);
