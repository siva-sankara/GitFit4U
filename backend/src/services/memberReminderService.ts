import mongoose from "mongoose";
import { nanoid } from "nanoid";
import { Conversation, Message } from "../models/Collaboration.js";
import { MemberCommunication } from "../models/Communication.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { Notification } from "../models/Engagement.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";
import { AppError } from "../utils/AppError.js";
import { sha256 } from "../utils/crypto.js";
import { issueMemberInvitation } from "./accountInvitationService.js";
import { enqueueWhatsAppDomainEvent } from "./whatsappDeliveryService.js";
import { normalizeWhatsAppRecipient } from "./whatsappConnectionService.js";

export type MemberReminderType =
  | "activation_invitation"
  | "renewal_reminder"
  | "payment_reminder"
  | "general_followup";

const eventForReminder: Record<MemberReminderType, string> = {
  activation_invitation: "member.activation_invitation",
  renewal_reminder: "membership.renewal_reminder",
  payment_reminder: "membership.payment_reminder",
  general_followup: "member.general_followup",
};

const notificationCopy: Record<
  MemberReminderType,
  { title: string; body: string; category: "SYSTEM" | "MEMBERSHIP" | "PAYMENT" }
> = {
  activation_invitation: {
    title: "Account activation reminder",
    body: "Please verify and activate your GETFIT4U account.",
    category: "SYSTEM",
  },
  renewal_reminder: {
    title: "Membership renewal reminder",
    body: "Please review your membership renewal date.",
    category: "MEMBERSHIP",
  },
  payment_reminder: {
    title: "Payment reminder",
    body: "Please check your membership and payment status.",
    category: "PAYMENT",
  },
  general_followup: {
    title: "Gym message",
    body: "Your gym has sent a message about your membership or access.",
    category: "MEMBERSHIP",
  },
};

export function selectMemberReminderType(
  member: Record<string, any>,
  subscription?: Record<string, any> | null,
  payment?: Record<string, any> | null,
): MemberReminderType {
  if (member.invitation?.status === "PENDING") return "activation_invitation";
  if (member.directAccess && !subscription) return "general_followup";
  if (
    subscription &&
    (subscription.status === "PENDING_PAYMENT" ||
      !payment ||
      ["CREATED", "PENDING", "AUTHORIZED", "FAILED", "CANCELLED"].includes(
        payment.status,
      ))
  )
    return "payment_reminder";
  if (
    subscription &&
    ["ACTIVE", "GRACE"].includes(subscription.status) &&
    subscription.renewalAt
  )
    return "renewal_reminder";
  return "general_followup";
}

function calendarDate(value: Date | string, timezone: string) {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

export function buildMemberReminderMessage(input: {
  type: MemberReminderType;
  memberName: string;
  gymName: string;
  gymOwnerPhone?: string;
  activationLink?: string;
  planName?: string;
  renewalDate?: Date | string;
  timezone?: string;
}) {
  const name = input.memberName || "Member";
  if (input.type === "activation_invitation") {
    if (!input.activationLink)
      throw new AppError(
        409,
        "ACTIVATION_LINK_UNAVAILABLE",
        "A secure activation link could not be prepared.",
      );
    const contact = input.gymOwnerPhone
      ? `For help, contact ${input.gymOwnerPhone}.`
      : "For help, contact the gym.";
    return `Hi ${name}, this is ${input.gymName}. Your GETFIT4U gym account is ready. Please verify and activate your account using this link: ${input.activationLink}. ${contact}`;
  }
  if (input.type === "renewal_reminder") {
    if (!input.renewalDate)
      throw new AppError(
        409,
        "RENEWAL_DATE_UNAVAILABLE",
        "A renewal date is not available for this member.",
      );
    return `Hi ${name}, your ${input.gymName} membership plan ${input.planName || "membership"} is due for renewal on ${calendarDate(input.renewalDate, input.timezone || "Asia/Kolkata")}. Please renew on time to continue your workouts without interruption. Thank you, ${input.gymName}.`;
  }
  if (input.type === "payment_reminder")
    return `Hi ${name}, this is a reminder from ${input.gymName}. Your membership/payment update is pending. Please contact the gym or complete the payment to continue your access.`;
  return `Hi ${name}, this is ${input.gymName}. We are contacting you regarding your gym membership/access details. Please check your GETFIT4U app messages or contact the gym for more information.`;
}

export function memberReminderWhatsAppUrl(phone: string, message: string) {
  const recipient = normalizeWhatsAppRecipient(phone);
  return `https://wa.me/${recipient}?text=${encodeURIComponent(message)}`;
}

function existingResponse(communication: any, messageText: string, phone: string) {
  const integrated = communication.mode === "INTEGRATED";
  return {
    communicationId: communication.publicId,
    mode: integrated ? ("integrated" as const) : ("fallback" as const),
    status: String(communication.status || "QUEUED").toLowerCase(),
    ...(integrated
      ? {}
      : { waUrl: memberReminderWhatsAppUrl(phone, messageText) }),
    message: integrated
      ? "WhatsApp reminder queued."
      : "WhatsApp integration not connected. Open WhatsApp with prefilled text.",
    messageType: communication.messageType as MemberReminderType,
    inAppMessageCreated: Boolean(communication.inAppMessageId),
    notificationCreated: Boolean(communication.notificationId),
    conversationPublicId: communication.inAppConversationPublicId,
    recipientUserId: String(communication.recipientUserId),
    inAppMessage: undefined as any,
    notificationId: communication.notificationId
      ? String(communication.notificationId)
      : undefined,
    duplicate: true,
  };
}

export async function prepareMemberWhatsAppReminder(input: {
  gymId: string;
  actorId: string;
  memberPublicId: string;
  idempotencyKey: string;
  requestedReason?: MemberReminderType;
  now?: Date;
}) {
  const now = input.now || new Date();
  const gym = await Gym.findOne({
    _id: input.gymId,
    deletedAt: null,
    status: { $nin: ["SUSPENDED", "ARCHIVED"] },
  });
  const member = await MemberProfile.findOne({
    publicId: input.memberPublicId,
    gymId: input.gymId,
    status: { $ne: "ARCHIVED" },
  });
  if (!gym || !member)
    throw new AppError(
      404,
      "MEMBER_NOT_FOUND",
      "This member is not available in the selected gym.",
    );
  const user = await User.findOne({
    _id: member.userId,
    status: { $in: ["ACTIVE", "PENDING_VERIFICATION"] },
  });
  if (!user)
    throw new AppError(
      409,
      "MEMBER_ACCOUNT_UNAVAILABLE",
      "This member does not have an eligible GETFIT4U account.",
    );
  const subscription = member.currentSubscriptionId
    ? await Subscription.findOne({
        _id: member.currentSubscriptionId,
        gymId: gym._id,
        memberProfileId: member._id,
        type: "GYM_MEMBERSHIP",
      })
    : null;
  const payment = subscription?.latestPaymentId
    ? await Payment.findOne({
        _id: subscription.latestPaymentId,
        gymId: gym._id,
        subscriptionId: subscription._id,
        purpose: "MEMBERSHIP",
      })
    : null;
  const messageType = selectMemberReminderType(member, subscription, payment);
  const rawPhone =
    user.status === "ACTIVE"
      ? user.phone
      : member.contact?.phone || user.phone;
  if (!rawPhone)
    throw new AppError(
      422,
      "WHATSAPP_PHONE_REQUIRED",
      "Add a valid member phone number before sending a WhatsApp reminder.",
    );
  const phone = normalizeWhatsAppRecipient(rawPhone);
  const requestKey = sha256(
    `member-reminder:${input.gymId}:${input.actorId}:${input.idempotencyKey}`,
  );
  const dedupeKey = sha256(
    `member-reminder:${input.gymId}:${member._id}:${messageType}:${Math.floor(now.getTime() / 60_000)}`,
  );
  let communication: any = await MemberCommunication.findOne({
    $or: [{ requestKey }, { dedupeKey }],
  });
  let ownsClaim = false;
  if (communication) {
    if (communication.status === "PROCESSING") {
      const staleBefore = new Date(now.getTime() - 2 * 60_000);
      const reclaimed = await MemberCommunication.findOneAndUpdate(
        {
          _id: communication._id,
          status: "PROCESSING",
          updatedAt: { $lte: staleBefore },
        },
        { $set: { updatedAt: now }, $unset: { failureCode: 1 } },
        { returnDocument: "after", timestamps: false },
      );
      if (!reclaimed)
        throw new AppError(
          409,
          "REMINDER_IN_PROGRESS",
          "This reminder is already being prepared.",
        );
      communication = reclaimed;
      ownsClaim = true;
    }
    if (!ownsClaim) {
      if (communication.status === "FAILED")
        throw new AppError(
          409,
          communication.failureCode || "REMINDER_FAILED",
          "The previous reminder attempt failed. Wait briefly and try again.",
        );
      const existingMessage = communication.inAppMessageId
        ? await Message.findById(communication.inAppMessageId)
            .select("text")
            .lean()
        : null;
      if (!existingMessage?.text)
        throw new AppError(
          409,
          "REMINDER_INCOMPLETE",
          "This reminder is still being finalized.",
        );
      return existingResponse(communication, existingMessage.text, phone);
    }
  }
  if (!ownsClaim) {
    try {
      communication = await MemberCommunication.create({
        publicId: nanoid(20),
        requestKey,
        dedupeKey,
        gymId: gym._id,
        memberId: member._id,
        recipientUserId: user._id,
        sentBy: input.actorId,
        source: "MEMBERS_LIST",
        channel: "WHATSAPP",
        mode: "FALLBACK",
        fallbackUsed: true,
        messageType,
        messagePreview: "Preparing member reminder",
        status: "PROCESSING",
      });
    } catch (error: any) {
      if (error?.code !== 11000) throw error;
      communication = await MemberCommunication.findOne({
        $or: [{ requestKey }, { dedupeKey }],
      });
      if (communication?.status === "PROCESSING")
        throw new AppError(
          409,
          "REMINDER_IN_PROGRESS",
          "This reminder is already being prepared.",
        );
      const existingMessage = communication?.inAppMessageId
        ? await Message.findById(communication.inAppMessageId)
            .select("text")
            .lean()
        : null;
      if (communication && existingMessage?.text)
        return existingResponse(communication, existingMessage.text, phone);
      throw error;
    }
  }

  try {
    const result = await mongoose.connection.transaction(async (session) => {
      let activationLink: string | undefined;
      if (messageType === "activation_invitation") {
        const invitation = await issueMemberInvitation(
          member,
          user,
          gym,
          session,
          now,
          { includeActionUrl: true, bypassCooldown: true },
        );
        activationLink = invitation.actionUrl;
      }
      const memberName = member.contact?.name || user.name || "Member";
      const messageText = buildMemberReminderMessage({
        type: messageType,
        memberName,
        gymName: gym.name,
        gymOwnerPhone: gym.contact?.phone || gym.contact?.whatsapp,
        activationLink,
        planName: subscription?.planSnapshot?.name,
        renewalDate: subscription?.renewalAt,
        timezone: gym.timezone,
      });
      const participantIds = [String(input.actorId), String(user._id)]
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
          },
          $pull: { archivedBy: { $in: participantIds } },
        },
        { upsert: true, returnDocument: "after", session },
      );
      const inAppMessage = await Message.findOneAndUpdate(
        {
          senderId: input.actorId,
          clientMessageId: `whatsapp-reminder:${communication.publicId}`,
        },
        {
          $setOnInsert: {
            publicId: nanoid(20),
            conversationId: conversation._id,
            senderId: input.actorId,
            clientMessageId: `whatsapp-reminder:${communication.publicId}`,
            source: "WHATSAPP_REMINDER",
            type: "TEXT",
            text: messageText,
            deliveredTo: [{ userId: user._id, at: now }],
            readBy: [{ userId: input.actorId, at: now }],
          },
        },
        { upsert: true, returnDocument: "after", session },
      );
      await Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            lastMessageId: inAppMessage._id,
            lastMessageAt: now,
          },
        },
        { session },
      );
      const copy = notificationCopy[messageType];
      const push =
        user.status === "ACTIVE" &&
        user.notificationPreferences?.push !== false &&
        (!user.notificationPreferences?.categories ||
          user.notificationPreferences.categories.includes(copy.category));
      const notification = await Notification.findOneAndUpdate(
        {
          userId: user._id,
          dedupeKey: `member-reminder:${communication.publicId}`,
        },
        {
          $setOnInsert: {
            userId: user._id,
            gymId: gym._id,
            category: copy.category,
            title: copy.title,
            message: copy.body,
            actionUrl: `/messages/${conversation.publicId}`,
            actionLabel: "Open message",
            source: gym.name,
            event: eventForReminder[messageType],
            entityType: "MEMBER",
            entityId: member.publicId,
            dedupeKey: `member-reminder:${communication.publicId}`,
            channels: push ? ["IN_APP", "PUSH"] : ["IN_APP"],
            pushStatus: push ? "QUEUED" : "NOT_REQUESTED",
            deliveredAt: now,
          },
        },
        { upsert: true, returnDocument: "after", session },
      );
      const outbox: any = await enqueueWhatsAppDomainEvent(
        {
          event: eventForReminder[messageType],
          userId: user._id,
          gymId: gym._id,
          entityId: member.publicId,
          occurrenceId: communication.publicId,
          actionUrl: `/messages/${conversation.publicId}`,
          session,
        },
        user,
      );
      const integrated = outbox?.status === "QUEUED";
      const preview = activationLink
        ? messageText.replace(activationLink, "[secure activation link]")
        : messageText;
      await MemberCommunication.updateOne(
        { _id: communication._id, status: "PROCESSING" },
        {
          $set: {
            mode: integrated ? "INTEGRATED" : "FALLBACK",
            fallbackUsed: !integrated,
            messagePreview: preview.slice(0, 500),
            inAppConversationId: conversation._id,
            inAppConversationPublicId: conversation.publicId,
            inAppMessageId: inAppMessage._id,
            notificationId: notification._id,
            whatsappOutboxId: outbox?._id,
            status: integrated ? "QUEUED" : "OPENED",
          },
        },
        { session },
      );
      return {
        conversation,
        inAppMessage,
        notification,
        messageText,
        integrated,
        outbox,
      };
    });
    return {
      communicationId: communication.publicId,
      mode: result.integrated ? ("integrated" as const) : ("fallback" as const),
      status: result.integrated ? "queued" : "opened",
      ...(result.integrated
        ? {}
        : { waUrl: memberReminderWhatsAppUrl(phone, result.messageText) }),
      message: result.integrated
        ? "WhatsApp reminder queued."
        : "WhatsApp integration not connected. Open WhatsApp with prefilled text.",
      messageType,
      inAppMessageCreated: true,
      notificationCreated: true,
      conversationPublicId: result.conversation.publicId,
      recipientUserId: String(user._id),
      inAppMessage: result.inAppMessage,
      notificationId: String(result.notification._id),
      duplicate: false,
    };
  } catch (error: any) {
    await MemberCommunication.updateOne(
      { _id: communication._id, status: "PROCESSING" },
      {
        $set: {
          status: "FAILED",
          failureCode: String(error?.code || "REMINDER_FAILED").slice(0, 120),
        },
      },
    );
    throw error;
  }
}
