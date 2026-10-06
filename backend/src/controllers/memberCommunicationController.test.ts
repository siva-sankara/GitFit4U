import mongoose from "mongoose";
import { beforeEach, expect, it, vi } from "vitest";
import { Conversation } from "../models/Collaboration.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { User } from "../models/User.js";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  audit: vi.fn(),
  emit: vi.fn(),
  to: vi.fn(),
}));
vi.mock("../services/memberReminderService.js", () => ({
  prepareMemberWhatsAppReminder: mocks.prepare,
}));
vi.mock("../services/auditService.js", () => ({ writeAudit: mocks.audit }));
import { openInAppConversation, sendWhatsAppReminder } from "./memberCommunicationController.js";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.to.mockReturnValue({ emit: mocks.emit });
});

function response() {
  const res: any = {
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status.mockReturnValue(res);
  return res;
}

const request = (reason = "renewal_reminder") =>
  ({
    auth: { gymId: "gym-id", userId: "owner-id" },
    params: { id: "member-public" },
    body: { reason, source: "members_list" },
    idempotencyKey: "stable-request-key",
    app: { get: vi.fn().mockReturnValue({ to: mocks.to }) },
    requestId: "request-id",
    header: vi.fn(),
  }) as any;

it("returns a queued official reminder and emits the stored message and notification", async () => {
  mocks.prepare.mockResolvedValue({
    communicationId: "communication-public",
    mode: "integrated",
    status: "queued",
    message: "WhatsApp reminder queued.",
    messageType: "renewal_reminder",
    inAppMessageCreated: true,
    notificationCreated: true,
    conversationPublicId: "conversation-public",
    recipientUserId: "member-user",
    inAppMessage: { publicId: "message-public" },
    notificationId: "notification-id",
    duplicate: false,
  });
  const req = request();
  const res = response();
  await sendWhatsAppReminder(req, res);
  expect(mocks.prepare).toHaveBeenCalledWith({
    gymId: "gym-id",
    actorId: "owner-id",
    memberPublicId: "member-public",
    idempotencyKey: "stable-request-key",
    requestedReason: "renewal_reminder",
  });
  expect(mocks.to).toHaveBeenCalledWith("conversation:conversation-public");
  expect(mocks.to).toHaveBeenCalledWith("user:member-user");
  expect(res.status).toHaveBeenCalledWith(202);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: expect.objectContaining({
      mode: "integrated",
      status: "queued",
      inAppMessageCreated: true,
      notificationCreated: true,
    }),
  });
  expect(mocks.audit).toHaveBeenCalledWith(
    req,
    expect.objectContaining({
      action: "member.communication.whatsapp_reminder",
      entityId: "communication-public",
    }),
  );
});

it("returns the fallback URL and does not re-emit idempotent duplicate records", async () => {
  mocks.prepare.mockResolvedValue({
    communicationId: "communication-public",
    mode: "fallback",
    status: "opened",
    waUrl: "https://wa.me/919999799900?text=Reminder",
    message: "Open WhatsApp with prefilled text.",
    messageType: "general_followup",
    inAppMessageCreated: true,
    notificationCreated: true,
    conversationPublicId: "conversation-public",
    recipientUserId: "member-user",
    notificationId: "notification-id",
    duplicate: true,
  });
  const res = response();
  await sendWhatsAppReminder(request("general_followup"), res);
  expect(mocks.emit).not.toHaveBeenCalled();
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: expect.objectContaining({
      mode: "fallback",
      waUrl: "https://wa.me/919999799900?text=Reminder",
      duplicate: true,
    }),
  });
});

it("opens an owner-scoped chat for an active linked member without exposing participant selection", async () => {
  const ownerId = "507f1f77bcf86cd799439011";
  const userId = "507f191e810c19729de860ea";
  const conversation = { publicId: "conversation-public", _id: "conversation-id" };
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (work: any) => work({}));
  vi.spyOn(MemberProfile, "findOne").mockReturnValue({
    session: vi.fn().mockResolvedValue({
      publicId: "member-public",
      userId,
      status: "ACTIVE",
      invitation: { status: "ACCEPTED" },
    }),
  } as any);
  vi.spyOn(User, "findOne").mockReturnValue({
    session: vi.fn().mockResolvedValue({ _id: userId, status: "ACTIVE" }),
  } as any);
  vi.spyOn(Gym, "findOne").mockReturnValue({
    session: vi.fn().mockResolvedValue({ _id: "507f1f77bcf86cd799439012", name: "Gym One" }),
  } as any);
  vi.spyOn(Conversation, "findOneAndUpdate").mockResolvedValue(conversation as any);
  const req: any = {
    auth: { gymId: "507f1f77bcf86cd799439012", userId: ownerId },
    params: { id: "member-public" },
    app: { get: vi.fn().mockReturnValue({ to: mocks.to }) },
    requestId: "request-id",
    header: vi.fn(),
  };
  const res = response();
  await openInAppConversation(req, res);
  expect(Conversation.findOneAndUpdate).toHaveBeenCalledWith(
    { directKey: [ownerId, userId].sort().join(":") },
    expect.any(Object),
    expect.objectContaining({ upsert: true, session: {} }),
  );
  expect(res.json).toHaveBeenCalledWith({
    success: true,
    data: { publicId: "conversation-public", pendingActivation: false },
  });
  expect(mocks.audit).toHaveBeenCalledWith(
    req,
    expect.objectContaining({ action: "member.communication.chat_opened" }),
  );
});
