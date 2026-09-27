import mongoose from "mongoose";
const { Schema, model, models } = mongoose;
const followSchema = new Schema(
  {
    followerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    followingId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: true },
);
followSchema.index({ followerId: 1, followingId: 1 }, { unique: true });
followSchema.index({ followingId: 1, createdAt: -1, _id: -1 });
followSchema.index({ followerId: 1, createdAt: -1, _id: -1 });

const contentFields = {
  publicId: { type: String, required: true, unique: true },
  authorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  text: { type: String, trim: true, maxlength: 3000, default: "" },
  attachmentIds: [{ type: Schema.Types.ObjectId, ref: "Attachment" }],
  deletedAt: Date,
  deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
};
const postSchema = new Schema(
  { ...contentFields, editedAt: Date },
  { timestamps: true },
);
postSchema.index({ authorId: 1, deletedAt: 1, createdAt: -1, _id: -1 });
const storySchema = new Schema(
  {
    ...contentFields,
    expiresAt: { type: Date, required: true },
    archivedAt: Date,
  },
  { timestamps: true },
);
storySchema.index({ authorId: 1, deletedAt: 1, expiresAt: -1 });
storySchema.index({
  authorId: 1,
  deletedAt: 1,
  archivedAt: 1,
  createdAt: -1,
  _id: -1,
});
storySchema.index({ archivedAt: 1, expiresAt: 1 });

const contactChangeSchema = new Schema(
  {
    challengeId: { type: String, unique: true, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    phone: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    consumedAt: Date,
  },
  { timestamps: true },
);
contactChangeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Follow = models.Follow || model("Follow", followSchema);
export const SocialPost = models.SocialPost || model("SocialPost", postSchema);
export const SocialStory =
  models.SocialStory || model("SocialStory", storySchema);
export const ProfileContactChange =
  models.ProfileContactChange ||
  model("ProfileContactChange", contactChangeSchema);
