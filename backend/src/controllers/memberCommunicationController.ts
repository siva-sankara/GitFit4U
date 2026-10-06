import type { Request, Response } from "express";
import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Conversation, Message } from "../models/Collaboration.js";
import { Notification } from "../models/Engagement.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";
import { prepareMemberWhatsAppReminder } from "../services/memberReminderService.js";
import { writeAudit } from "../services/auditService.js";
import { AppError } from "../utils/AppError.js";

export async function openInAppConversation(req: Request, res: Response) {
  const result = await mongoose.connection.transaction(async (session) => {
    const member = await MemberProfile.findOne({
      publicId: req.params.id,
      gymId: req.auth!.gymId,
      isDeleted: { $ne: true },
      status: { $ne: "ARCHIVED" },
    }).session(session);
    if (!member)
      throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found in this gym.");
    const [user, gym] = await Promise.all([
      User.findOne({
        _id: member.userId,
        status: { $in: ["ACTIVE", "PENDING_VERIFICATION"] },
      }).session(session),
      Gym.findOne({ _id: req.auth!.gymId, deletedAt: null }).session(session),
    ]);
    if (!user || !gym)
      throw new AppError(
        409,
        "MEMBER_ACCOUNT_UNAVAILABLE",
        "This member does not have an eligible GETFIT4U account.",
      );
    const participantIds = [String(req.auth!.userId), String(user._id)]
      .sort()
      .map((value) => new mongoose.Types.ObjectId(value));
    const directKey = participantIds.map(String).join(":");
    const conversation = await Conversation.findOneAndUpdate(
      { directKey },
      {
        $setOnInsert: {
          publicId: nanoid(20),
          gymId: gym._id,
          type: "DIRECT",
          participants: participantIds,
          directKey,
          lastMessageAt: new Date(),
        },
        $pull: { archivedBy: { $in: participantIds } },
      },
      { upsert: true, returnDocument: "after", session },
    );
    let invitationMessage: any = null;
    let notification: any = null;
    let invitationMessageCreated = false;
    let notificationCreated = false;
    const pendingActivation =
      member.invitation?.status === "PENDING" ||
      user.status === "PENDING_VERIFICATION";
    if (pendingActivation) {
      const clientMessageId = `member-activation-thread:${member.publicId}`;
      invitationMessage = await Message.findOne({
        senderId: req.auth!.userId,
        clientMessageId,
      }).session(session);
      if (!invitationMessage) {
        invitationMessageCreated = true;
        invitationMessage = await Message.create(
          [
            {
              publicId: nanoid(20),
              conversationId: conversation._id,
              senderId: req.auth!.userId,
              clientMessageId,
              source: "SYSTEM",
              type: "TEXT",
              text: `Your ${gym.name} membership is ready. Activate your GETFIT4U account using the latest secure invitation sent to your registered email.`,
              deliveredTo: [{ userId: user._id, at: new Date() }],
              readBy: [{ userId: req.auth!.userId, at: new Date() }],
            },
          ],
          { session },
        ).then((rows) => rows[0]);
        await Conversation.updateOne(
          { _id: conversation._id },
          {
            $set: {
              lastMessageId: invitationMessage._id,
              lastMessageAt: invitationMessage.createdAt,
            },
          },
          { session },
        );
      }
      notification = await Notification.findOne({
        userId: user._id,
        dedupeKey: `member-activation-thread:${member.publicId}`,
      }).session(session);
      if (!notification) notificationCreated = true;
      notification = notification || await Notification.findOneAndUpdate(
        {
          userId: user._id,
          dedupeKey: `member-activation-thread:${member.publicId}`,
        },
        {
          $setOnInsert: {
            userId: user._id,
            gymId: gym._id,
            category: "SYSTEM",
            title: "Activate your GETFIT4U account",
            message: `${gym.name} opened an in-app conversation for your membership. Use your latest secure email invitation to activate your account.`,
            actionUrl: `/messages/${conversation.publicId}`,
            actionLabel: "Open message",
            source: gym.name,
            event: "member.activation_invitation",
            entityType: "MEMBER",
            entityId: member.publicId,
            dedupeKey: `member-activation-thread:${member.publicId}`,
            channels: ["IN_APP"],
            pushStatus: "NOT_REQUESTED",
            deliveredAt: new Date(),
          },
        },
        { upsert: true, returnDocument: "after", session },
      );
    }
    return {
      conversation,
      invitationMessage,
      invitationMessageCreated,
      notification,
      notificationCreated,
      user,
      pendingActivation,
    };
  });
  const io = req.app.get("io");
  if (result.invitationMessageCreated)
    io?.to(`conversation:${result.conversation.publicId}`).emit(
      "message.created",
      result.invitationMessage,
    );
  if (result.notificationCreated)
    io?.to(`user:${result.user._id}`).emit("notification.created", {
      id: result.notification._id,
    });
  await writeAudit(req, {
    action: result.pendingActivation
      ? "member.communication.activation_thread_opened"
      : "member.communication.chat_opened",
    entityType: "Conversation",
    entityId: result.conversation.publicId,
    after: { memberId: String(req.params.id), pendingActivation: result.pendingActivation },
  });
  res.json({
    success: true,
    data: {
      publicId: result.conversation.publicId,
      pendingActivation: result.pendingActivation,
    },
  });
}

export async function sendWhatsAppReminder(req: Request, res: Response) {
  const data = await prepareMemberWhatsAppReminder({
    gymId: req.auth!.gymId!,
    actorId: req.auth!.userId,
    memberPublicId: String(req.params.id),
    idempotencyKey: req.idempotencyKey!,
    requestedReason: req.body.reason,
  });
  if (!data.duplicate) {
    const io = req.app.get("io");
    io?.to(`conversation:${data.conversationPublicId}`).emit(
      "message.created",
      data.inAppMessage,
    );
    if (data.notificationId)
      io?.to(`user:${data.recipientUserId}`).emit("notification.created", {
        id: data.notificationId,
      });
  }
  await writeAudit(req, {
    action: "member.communication.whatsapp_reminder",
    entityType: "MemberCommunication",
    entityId: data.communicationId,
    after: {
      memberId: String(req.params.id),
      source: "members_list",
      channel: "whatsapp",
      mode: data.mode,
      messageType: data.messageType,
      status: data.status,
      duplicate: data.duplicate,
      inAppMessageCreated: data.inAppMessageCreated,
      notificationCreated: data.notificationCreated,
    },
  });
  res.status(data.mode === "integrated" ? 202 : 200).json({
    success: true,
    data: {
      communicationId: data.communicationId,
      mode: data.mode,
      status: data.status,
      waUrl: data.waUrl,
      message: data.message,
      messageType: data.messageType,
      inAppMessageCreated: data.inAppMessageCreated,
      notificationCreated: data.notificationCreated,
      duplicate: data.duplicate,
    },
  });
}
