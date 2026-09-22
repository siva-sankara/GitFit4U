import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const locationSchema = new Schema(
  {
    type: { type: String, enum: ["Point"], default: "Point" },
    coordinates: {
      type: [Number],
      validate: {
        validator: (value: number[]) => value.length === 2,
        message: "Location requires [longitude, latitude].",
      },
    },
  },
  { _id: false },
);

const gymSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    activationPaymentId: { type: Schema.Types.ObjectId, ref: "Payment" },
    name: { type: String, required: true, trim: true, maxlength: 160 },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    description: { type: String, maxlength: 4000 },
    logoUrl: String,
    coverImageUrl: String,
    gallery: [{ type: String }],
    videos: [{ type: String }],
    mediaAttachmentIds: [{ type: Schema.Types.ObjectId, ref: "Attachment" }],
    coverAttachmentId: { type: Schema.Types.ObjectId, ref: "Attachment" },
    benefits: [{ type: String }],
    facilities: [{ type: String }],
    amenities: [{ type: String }],
    gymType: [{ type: String }],
    audience: {
      type: String,
      enum: ["MALE", "FEMALE", "UNISEX"],
      default: "UNISEX",
    },
    contact: {
      phone: String,
      email: String,
      whatsapp: String,
      website: String,
    },
    address: {
      line1: String,
      line2: String,
      locality: String,
      city: String,
      state: String,
      postalCode: String,
      country: { type: String, default: "IN" },
    },
    location: { type: locationSchema, required: true },
    timezone: { type: String, default: "Asia/Kolkata" },
    attendanceLocationRequired: { type: Boolean, default: false },
    attendanceRadiusMeters: { type: Number, min: 25, max: 1000, default: 100 },
    openingHours: [
      {
        day: { type: Number, min: 0, max: 6 },
        closed: { type: Boolean, default: false },
        opensAt: String,
        closesAt: String,
      },
    ],
    status: {
      type: String,
      enum: ["INACTIVE", "ACTIVE", "SUSPENDED", "ARCHIVED"],
      default: "INACTIVE",
      index: true,
    },
    verificationStatus: {
      type: String,
      enum: ["UNVERIFIED", "PENDING", "VERIFIED", "REJECTED"],
      default: "UNVERIFIED",
    },
    platformSubscriptionStatus: {
      type: String,
      enum: [
        "NONE",
        "PENDING_PAYMENT",
        "ACTIVE",
        "PAST_DUE",
        "EXPIRED",
        "CANCELLED",
      ],
      default: "NONE",
    },
    profileCompleteness: { type: Number, min: 0, max: 100, default: 0 },
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
    },
    startingPriceMinor: { type: Number, default: 0 },
    currency: { type: String, default: "INR" },
    publishedAt: Date,
    suspendedAt: Date,
    suspensionReason: String,
    deletedAt: Date,
  },
  { timestamps: true, versionKey: "version", optimisticConcurrency: true },
);

gymSchema.index({ location: "2dsphere" });
gymSchema.index({
  status: 1,
  verificationStatus: 1,
  platformSubscriptionStatus: 1,
});
gymSchema.index({
  name: "text",
  "address.city": "text",
  "address.locality": "text",
});

export const Gym = models.Gym || model("Gym", gymSchema);
