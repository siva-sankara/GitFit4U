import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const gymRegistrationSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    currentStep: {
      type: String,
      enum: [
        "ACCOUNT",
        "GYM",
        "PLAN",
        "PAYMENT",
        "COMPLETE",
        "DOCUMENTS",
        "VERIFICATION",
        "APPROVAL",
      ],
      default: "GYM",
    },
    status: {
      type: String,
      enum: [
        "DRAFT",
        "VERIFICATION_PENDING",
        "CHANGES_REQUIRED",
        "REJECTED",
        "VERIFIED",
        "PAYMENT_PENDING",
        "PAYMENT_FAILED",
        "PAYMENT_CANCELLED",
        "PAYMENT_SUCCESSFUL",
        "FINAL_APPROVAL",
        "APPROVED",
        "ACTIVE",
        "SUSPENDED",
      ],
      default: "DRAFT",
      index: true,
    },
    selectedPlatformPlanId: {
      type: Schema.Types.ObjectId,
      ref: "PlatformPlan",
    },
    latestPaymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    submittedAt: Date,
    activatedAt: Date,
    preliminaryVerifiedAt: Date,
    approvedAt: Date,
    rejectedAt: Date,
    reviewNotes: String,
    reviewVersion: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: "version", optimisticConcurrency: true },
);

gymRegistrationSchema.index({ ownerId: 1, status: 1 });
gymRegistrationSchema.index({ status: 1, createdAt: -1 });

// const verificationReviewSchema = new Schema(
//   {
//     registrationId: { type: Schema.Types.ObjectId, ref: "GymRegistration", required: true, index: true },
//     reviewerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
//     decision: { type: String, enum: ["VERIFIED", "CHANGES_REQUIRED", "REJECTED", "APPROVED"] },
//     notes: String,
//     checklist: Schema.Types.Mixed
//   },
//   { timestamps: true }
// );

export const GymRegistration =
  models.GymRegistration || model("GymRegistration", gymRegistrationSchema);
// export const VerificationReview = models.VerificationReview || model("VerificationReview", verificationReviewSchema);
