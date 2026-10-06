import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const memberCommunicationSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    requestKey: { type: String, required: true, unique: true },
    dedupeKey: { type: String, required: true, unique: true },
    gymId: {
      type: Schema.Types.ObjectId,
      ref: "Gym",
      required: true,
      index: true,
    },
    memberId: {
      type: Schema.Types.ObjectId,
      ref: "MemberProfile",
      required: true,
      index: true,
    },
    recipientUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    sentBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    source: {
      type: String,
      enum: ["MEMBERS_LIST"],
      required: true,
    },
    channel: { type: String, enum: ["WHATSAPP"], required: true },
    mode: { type: String, enum: ["INTEGRATED", "FALLBACK"], required: true },
    fallbackUsed: { type: Boolean, required: true },
    messageType: {
      type: String,
      enum: [
        "activation_invitation",
        "renewal_reminder",
        "payment_reminder",
        "general_followup",
      ],
      required: true,
      index: true,
    },
    messagePreview: { type: String, required: true, maxlength: 500 },
    inAppConversationId: { type: Schema.Types.ObjectId, ref: "Conversation" },
    inAppConversationPublicId: { type: String, maxlength: 120 },
    inAppMessageId: { type: Schema.Types.ObjectId, ref: "Message" },
    notificationId: { type: Schema.Types.ObjectId, ref: "Notification" },
    whatsappOutboxId: { type: Schema.Types.ObjectId, ref: "WhatsAppOutbox" },
    providerMessageId: { type: String, index: true },
    status: {
      type: String,
      enum: [
        "PROCESSING",
        "QUEUED",
        "ACCEPTED",
        "SENT",
        "DELIVERED",
        "READ",
        "OPENED",
        "FAILED",
        "SUPPRESSED",
      ],
      default: "PROCESSING",
      index: true,
    },
    failureCode: { type: String, maxlength: 120 },
  },
  { timestamps: true },
);

memberCommunicationSchema.index({ gymId: 1, memberId: 1, createdAt: -1 });
memberCommunicationSchema.index({ whatsappOutboxId: 1 }, { sparse: true });

export const MemberCommunication =
  models.MemberCommunication ||
  model("MemberCommunication", memberCommunicationSchema);
