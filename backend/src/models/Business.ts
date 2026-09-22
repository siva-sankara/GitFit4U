import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const refundSchema = new Schema({
  publicId: { type: String, required: true, unique: true }, paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true, index: true },
  requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true }, amountMinor: { type: Number, min: 1, required: true }, currency: { type: String, default: "INR" },
  reason: { type: String, required: true, maxlength: 1000 }, providerRefundId: { type: String, unique: true, sparse: true },
  status: { type: String, enum: ["REQUESTED", "PROCESSING", "PROCESSED", "FAILED", "CANCELLED"], default: "REQUESTED", index: true }, processedAt: Date, failureReason: String
}, { timestamps: true });

const invoiceSchema = new Schema({
  publicId: { type: String, required: true, unique: true }, number: { type: String, required: true, unique: true },
  gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true }, userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  subscriptionId: { type: Schema.Types.ObjectId, ref: "Subscription" }, paymentId: { type: Schema.Types.ObjectId, ref: "Payment", required: true },
  supplierSnapshot: { type: Schema.Types.Mixed, required: true }, customerSnapshot: { type: Schema.Types.Mixed, required: true },
  lines: [{ description: String, quantity: Number, unitPriceMinor: Number, taxRateBasisPoints: Number, taxMinor: Number, totalMinor: Number }],
  subtotalMinor: Number, taxMinor: Number, totalMinor: Number, currency: { type: String, default: "INR" }, placeOfSupply: String,
  status: { type: String, enum: ["ISSUED", "VOID", "CREDITED"], default: "ISSUED" }, issuedAt: { type: Date, default: Date.now }, pdfObjectKey: String
}, { timestamps: true });
invoiceSchema.index({ gymId: 1, issuedAt: -1 });

const attachmentSchema = new Schema({
  registrationId: { type: Schema.Types.ObjectId, ref: "GymRegistration", index: true },
  publicId: { type: String, required: true, unique: true }, ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }, gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
  purpose: { type: String, enum: ["AVATAR", "GYM_LOGO", "GYM_COVER", "GYM_GALLERY", "DOCUMENT", "REVIEW", "MESSAGE", "PROGRESS", "AD"], required: true },
  objectKey: { type: String, required: true, unique: true }, originalName: String, mimeType: { type: String, required: true }, size: { type: Number, min: 1, required: true },
  status: { type: String, enum: ["PENDING", "UPLOADED", "SCANNING", "READY", "REJECTED", "DELETED"], default: "PENDING" }, checksum: String, deletedAt: Date
}, { timestamps: true });

const promotionFields = {
  publicId: { type: String, required: true, unique: true }, gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true }, createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  name: { type: String, required: true, maxlength: 160 }, description: { type: String, maxlength: 3000 }, startsAt: { type: Date, required: true }, endsAt: { type: Date, required: true },
  status: { type: String, enum: ["DRAFT", "SCHEDULED", "ACTIVE", "PAUSED", "ENDED", "ARCHIVED"], default: "DRAFT", index: true }, audience: Schema.Types.Mixed
};
const offerSchema = new Schema({ ...promotionFields, type: { type: String, enum: ["DISCOUNT", "NEW_MEMBER", "FESTIVAL", "REFERRAL", "FIRST_MONTH"], required: true }, discount: Schema.Types.Mixed, redemptionLimit: Number, redemptionCount: { type: Number, default: 0 } }, { timestamps: true });
const advertisementSchema = new Schema({ ...promotionFields, creativeAttachmentId: { type: Schema.Types.ObjectId, ref: "Attachment" }, budgetMinor: { type: Number, min: 0 }, spentMinor: { type: Number, min: 0, default: 0 }, metrics: { impressions: { type: Number, default: 0 }, clicks: { type: Number, default: 0 }, conversions: { type: Number, default: 0 } } }, { timestamps: true });

const favoriteSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: "User", required: true }, gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true } }, { timestamps: true });
favoriteSchema.index({ userId: 1, gymId: 1 }, { unique: true });
const referralSchema = new Schema({ referrerId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }, referredUserId: { type: Schema.Types.ObjectId, ref: "User", index: true }, code: { type: String, required: true, index: true }, status: { type: String, enum: ["INVITED", "SIGNED_UP", "QUALIFIED", "REWARDED", "EXPIRED"], default: "INVITED" }, rewardMinor: { type: Number, min: 0, default: 0 }, qualifiedAt: Date, rewardedAt: Date }, { timestamps: true });

const bankAccountSchema = new Schema({ ownerId: { type: Schema.Types.ObjectId, ref: "User", required: true }, gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true }, providerBeneficiaryId: { type: String, required: true }, accountHolder: { type: String, required: true }, maskedAccountNumber: { type: String, required: true }, ifsc: { type: String, required: true }, status: { type: String, enum: ["PENDING", "VERIFIED", "FAILED", "DISABLED"], default: "PENDING" }, verifiedAt: Date }, { timestamps: true });
bankAccountSchema.index({ gymId: 1, status: 1 });
const settlementSchema = new Schema({ publicId: { type: String, required: true, unique: true }, gymId: { type: Schema.Types.ObjectId, ref: "Gym", required: true, index: true }, bankAccountId: { type: Schema.Types.ObjectId, ref: "BankAccount", required: true }, periodStart: Date, periodEnd: Date, grossMinor: Number, commissionMinor: Number, refundMinor: Number, netMinor: Number, currency: { type: String, default: "INR" }, providerSettlementId: String, status: { type: String, enum: ["PENDING", "PROCESSING", "SETTLED", "FAILED"], default: "PENDING" }, settledAt: Date }, { timestamps: true });

export const Refund = models.Refund || model("Refund", refundSchema);
export const Invoice = models.Invoice || model("Invoice", invoiceSchema);
export const Attachment = models.Attachment || model("Attachment", attachmentSchema);
export const Offer = models.Offer || model("Offer", offerSchema);
export const Advertisement = models.Advertisement || model("Advertisement", advertisementSchema);
export const Favorite = models.Favorite || model("Favorite", favoriteSchema);
export const Referral = models.Referral || model("Referral", referralSchema);
export const BankAccount = models.BankAccount || model("BankAccount", bankAccountSchema);
export const Settlement = models.Settlement || model("Settlement", settlementSchema);
