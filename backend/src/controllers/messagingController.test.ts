import express, { type ErrorRequestHandler, type Request } from "express";
import request from "supertest";
import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
  requireRole:
    (...roles: string[]) =>
    (req: Request, res: any, next: () => void) =>
      roles.includes(req.auth!.role)
        ? next()
        : res.status(403).json({ code: "ROLE_FORBIDDEN" }),
}));
vi.mock("../services/domainEventService.js", () => ({
  emitDomainEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/auditService.js", () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));
import { Conversation, Message } from "../models/Collaboration.js";
import { Campaign, SupportTicket } from "../models/Engagement.js";
import { Attachment } from "../models/Business.js";
import { messagingRoutes } from "../routes/messagingRoutes.js";
import { ensureSupportConversation } from "../services/supportConversationService.js";
const userId = String(new mongoose.Types.ObjectId());
const otherId = String(new mongoose.Types.ObjectId());
const conversationId = new mongoose.Types.ObjectId();
function app(role: NonNullable<Request["auth"]>["role"] = "USER") {
  const instance = express();
  instance.use(express.json());
  instance.use((req, _res, next) => {
    req.auth = { userId, role, sessionId: "session", permissions: [] };
    next();
  });
  instance.use("/conversations", messagingRoutes);
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ code: error.code });
  };
  instance.use(errors);
  return instance;
}
function mockConversation(value: any) {
  vi.spyOn(Conversation, "findOne").mockReturnValue({
    populate: vi.fn().mockResolvedValue(value),
  } as never);
}
afterEach(() => vi.restoreAllMocks());
describe("conversation authorization and integrity", () => {
  it("rejects nonparticipants before reading message history", async () => {
    mockConversation({
      _id: conversationId,
      type: "DIRECT",
      participants: [otherId],
    });
    const messages = vi.spyOn(Message, "find");
    const response = await request(app()).get(
      "/conversations/thread-id/messages",
    );
    expect(response.status).toBe(404);
    expect(messages).not.toHaveBeenCalled();
  });
  it("denies a former support participant unless they are requester or active admin", async () => {
    mockConversation({
      _id: conversationId,
      type: "SUPPORT",
      participants: [userId],
      supportTicketId: { requesterId: otherId },
    });
    expect(
      (await request(app("GYM_OWNER")).get("/conversations/thread-id/messages"))
        .status,
    ).toBe(404);
  });
  it("never permits deleting another participant's message", async () => {
    mockConversation({
      _id: conversationId,
      type: "DIRECT",
      participants: [userId, otherId],
    });
    const deletion = vi
      .spyOn(Message, "findOneAndUpdate")
      .mockResolvedValue(null);
    expect(
      (
        await request(app()).delete(
          "/conversations/thread-id/messages/message-id",
        )
      ).status,
    ).toBe(404);
    expect(deletion.mock.calls[0][0]).toMatchObject({
      senderId: userId,
      conversationId,
      publicId: "message-id",
    });
  });
  it("archives a conversation for only the authenticated account", async () => {
    mockConversation({
      _id: conversationId,
      type: "DIRECT",
      participants: [userId, otherId],
    });
    const update = vi
      .spyOn(Conversation, "updateOne")
      .mockResolvedValue({} as never);
    expect(
      (await request(app()).delete("/conversations/thread-id")).body.data.scope,
    ).toBe("FOR_ME");
    expect(update).toHaveBeenCalledWith(
      { _id: conversationId },
      { $addToSet: { archivedBy: userId } },
    );
  });
  it("returns an existing message for an identical retried send without creating duplicates", async () => {
    mockConversation({
      _id: conversationId,
      publicId: "thread-id",
      type: "DIRECT",
      participants: [userId],
    });
    vi.spyOn(Message, "create").mockRejectedValue({ code: 11000 });
    vi.spyOn(Message, "findOne").mockResolvedValue({
      _id: new mongoose.Types.ObjectId(),
      publicId: "old-message",
      text: "Hello there",
      attachments: [],
      createdAt: new Date(),
    } as never);
    vi.spyOn(Conversation, "updateOne").mockResolvedValue({} as never);
    const response = await request(app())
      .post("/conversations/thread-id/messages")
      .send({ clientMessageId: "same-draft-id", text: "Hello there" });
    expect(response.status).toBe(200);
    expect(response.body.data.publicId).toBe("old-message");
  });
  it("rejects a reused draft id when its text changed", async () => {
    mockConversation({
      _id: conversationId,
      type: "DIRECT",
      participants: [userId],
    });
    vi.spyOn(Message, "create").mockRejectedValue({ code: 11000 });
    vi.spyOn(Message, "findOne").mockResolvedValue({
      text: "Original",
      attachments: [],
    } as never);
    expect(
      (
        await request(app())
          .post("/conversations/thread-id/messages")
          .send({ clientMessageId: "same-draft-id", text: "Changed" })
      ).status,
    ).toBe(409);
  });
  it("does not allow members to close support conversations", async () => {
    mockConversation({
      _id: conversationId,
      type: "SUPPORT",
      participants: [userId],
      supportTicketId: {
        _id: conversationId,
        requesterId: userId,
        status: "OPEN",
      },
    });
    const update = vi.spyOn(SupportTicket, "updateOne");
    expect(
      (
        await request(app())
          .patch("/conversations/thread-id/support-status")
          .send({ status: "CLOSED" })
      ).status,
    ).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });
  it("rejects invalid timestamp cursors without querying history", async () => {
    mockConversation({
      _id: conversationId,
      type: "DIRECT",
      participants: [userId],
    });
    const find = vi.spyOn(Message, "find");
    expect(
      (
        await request(app()).get(
          "/conversations/thread-id/messages?before=invalid",
        )
      ).status,
    ).toBe(400);
    expect(find).not.toHaveBeenCalled();
  });
  it("rejects attachment identities that are not ready message uploads owned by the sender", async () => {
    mockConversation({
      _id: conversationId,
      type: "DIRECT",
      participants: [userId],
    });
    const files = vi.spyOn(Attachment, "find").mockResolvedValue([]);
    const create = vi.spyOn(Message, "create");
    const response = await request(app())
      .post("/conversations/thread-id/messages")
      .send({
        clientMessageId: "file-draft-id",
        attachments: [{ key: "another-user-file" }],
      });
    expect(response.status).toBe(422);
    expect(create).not.toHaveBeenCalled();
    expect(files.mock.calls[0][0]).toMatchObject({
      ownerId: userId,
      purpose: "MESSAGE",
      status: "READY",
      deletedAt: null,
    });
  });
  it("requires reopening a resolved support ticket before sending", async () => {
    mockConversation({
      _id: conversationId,
      type: "SUPPORT",
      participants: [userId],
      supportTicketId: { requesterId: userId, status: "RESOLVED" },
    });
    const create = vi.spyOn(Message, "create");
    expect(
      (
        await request(app())
          .post("/conversations/thread-id/messages")
          .send({ clientMessageId: "same-draft-id", text: "Please reopen" })
      ).status,
    ).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });
  it("enforces administrator authorization for broadcasts before querying campaigns", async () => {
    const find = vi.spyOn(Campaign, "find");
    expect((await request(app()).get("/conversations/broadcasts")).status).toBe(
      403,
    );
    expect(find).not.toHaveBeenCalled();
  });
  it("reuses an already queued announcement for the same submission key", async () => {
    vi.spyOn(Campaign, "findOne").mockResolvedValue({
      publicId: "campaign-id",
      name: "Notice",
      message: "Hello members",
      audience: { roles: ["USER"] },
    } as never);
    const create = vi.spyOn(Campaign, "create");
    const response = await request(app("ADMIN"))
      .post("/conversations/broadcasts")
      .send({
        name: "Notice",
        message: "Hello members",
        roles: ["USER"],
        idempotencyKey: "123e4567-e89b-42d3-a456-426614174000",
      });
    expect(response.status).toBe(200);
    expect(create).not.toHaveBeenCalled();
  });
});
it("bridges historical support messages additively using stable deduplication keys", async () => {
  const ticketId = new mongoose.Types.ObjectId(),
    entryId = new mongoose.Types.ObjectId();
  vi.spyOn(Conversation, "findOneAndUpdate").mockResolvedValue({
    _id: conversationId,
    publicId: "support-chat",
  } as never);
  const bulk = vi.spyOn(Message, "bulkWrite").mockResolvedValue({} as never);
  vi.spyOn(Message, "findOne").mockReturnValue({
    sort: vi.fn().mockResolvedValue(null),
  } as never);
  const ticket = {
    _id: ticketId,
    requesterId: userId,
    subject: "Need help",
    createdAt: new Date(),
    messages: [
      {
        _id: entryId,
        authorId: userId,
        body: "Original ticket message",
        attachments: ["https://example.com/file.pdf"],
      },
    ],
  };
  await ensureSupportConversation(ticket);
  await ensureSupportConversation(ticket);
  const first: any = bulk.mock.calls[0][0][0],
    second: any = bulk.mock.calls[1][0][0];
  expect(first.updateOne.filter).toEqual(second.updateOne.filter);
  expect(first.updateOne.filter.clientMessageId).toBe(
    "support:" + ticketId + ":" + entryId,
  );
  expect(first.updateOne.update.$setOnInsert.text).toBe(
    "Original ticket message",
  );
  expect(first.updateOne.upsert).toBe(true);
  expect(ticket.messages).toHaveLength(1);
});
