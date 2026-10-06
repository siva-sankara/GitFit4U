import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const memberImportJobSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true },
    actorId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    sourceFileName: { type: String, required: true },
    sourceFormat: { type: String, enum: ["csv", "xls", "xlsx"], required: true },
    columns: [{ type: String, maxlength: 120 }],
    rawRows: { type: [Schema.Types.Mixed], select: false, default: [] },
    mapping: { type: Schema.Types.Mixed, default: {} },
    validatedRows: { type: [Schema.Types.Mixed], select: false, default: [] },
    status: {
      type: String,
      enum: ["UPLOADED", "VALIDATED", "PROCESSING", "COMPLETED", "FAILED"],
      default: "UPLOADED",
      index: true,
    },
    cursor: { type: Number, default: 0 },
    summary: {
      total: { type: Number, default: 0 },
      valid: { type: Number, default: 0 },
      warnings: { type: Number, default: 0 },
      invalid: { type: Number, default: 0 },
      imported: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      skipped: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    expiresAt: { type: Date, required: true },
    completedAt: Date,
  },
  { timestamps: true },
);
memberImportJobSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
memberImportJobSchema.index({ gymId: 1, actorId: 1, createdAt: -1 });

export const MemberImportJob =
  models.MemberImportJob || model("MemberImportJob", memberImportJobSchema);
