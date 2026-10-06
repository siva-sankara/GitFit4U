import mongoose from "mongoose";
const { Schema, model, models } = mongoose;

const attachmentPart = new Schema(
  { key: String, url: String, name: String, mimeType: String, size: Number },
  { _id: false },
);

const conversationSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    gymId: { type: Schema.Types.ObjectId, ref: "Gym", index: true },
    type: {
      type: String,
      enum: ["DIRECT", "GROUP", "SUPPORT", "SYSTEM"],
      default: "DIRECT",
    },
    participants: [
      { type: Schema.Types.ObjectId, ref: "User", required: true },
    ],
    title: { type: String, trim: true, maxlength: 120 },
    supportTicketId: { type: Schema.Types.ObjectId, ref: "SupportTicket" },
    directKey: { type: String },
    lastMessageId: { type: Schema.Types.ObjectId, ref: "Message" },
    lastMessageAt: { type: Date, index: true },
    archivedBy: [{ type: Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);
conversationSchema.index({ participants: 1, lastMessageAt: -1 });
conversationSchema.index(
  { supportTicketId: 1 },
  {
    unique: true,
    partialFilterExpression: { supportTicketId: { $type: "objectId" } },
  },
);
conversationSchema.index(
  { directKey: 1 },
  { unique: true, partialFilterExpression: { directKey: { $type: "string" } } },
);

const messageSchema = new Schema(
  {
    publicId: { type: String, required: true, unique: true },
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: function (this: any) {
        const type = this.type || this.getUpdate?.()?.$setOnInsert?.type || this.getUpdate?.()?.$set?.type;
        return type !== "SYSTEM";
      },
      index: true,
    },
    clientMessageId: { type: String, required: true },
    source: {
      type: String,
      enum: ["USER", "SYSTEM", "WHATSAPP_REMINDER"],
      default: "USER",
      index: true,
    },
    invoiceId: { type: Schema.Types.ObjectId, ref: "Invoice" },
    actionUrl: { type: String, maxlength: 2000 },
    type: {
      type: String,
      enum: ["TEXT", "IMAGE", "FILE", "SYSTEM"],
      default: "TEXT",
    },
    text: { type: String, trim: true, maxlength: 5000 },
    attachments: [attachmentPart],
    deliveredTo: [
      { userId: { type: Schema.Types.ObjectId, ref: "User" }, at: Date },
    ],
    readBy: [
      { userId: { type: Schema.Types.ObjectId, ref: "User" }, at: Date },
    ],
    editedAt: Date,
    deletedAt: Date,
  },
  { timestamps: true },
);
messageSchema.index({ conversationId: 1, createdAt: -1 });
messageSchema.index({ senderId: 1, clientMessageId: 1 }, { unique: true });
messageSchema.index({ "attachments.key": 1 });

const deviceTokenSchema = new Schema(
  {
    deviceId: { type: String, maxlength: 128, index: true },
    sessionId: { type: String, index: true },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    token: { type: String, required: true, unique: true, select: false },
    tokenHash: { type: String, required: true, unique: true },
    platform: { type: String, enum: ["WEB", "ANDROID", "IOS"], required: true },
    permission: {
      type: String,
      enum: ["GRANTED", "DENIED", "DEFAULT"],
      default: "DEFAULT",
    },
    lastSeenAt: { type: Date, default: Date.now },
    revokedAt: Date,
  },
  { timestamps: true },
);
deviceTokenSchema.index({ userId: 1, revokedAt: 1 });
deviceTokenSchema.index({ userId: 1, sessionId: 1, revokedAt: 1 });

export const Conversation =
  models.Conversation || model("Conversation", conversationSchema);
export const Message = models.Message || model("Message", messageSchema);
export const DeviceToken =
  models.DeviceToken || model("DeviceToken", deviceTokenSchema);
