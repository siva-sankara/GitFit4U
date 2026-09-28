import express, { type ErrorRequestHandler } from "express";
import request from "supertest";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("../services/supportConversationService.js", () => ({
  ensureSupportConversation: vi
    .fn()
    .mockResolvedValue({ publicId: "support-chat" }),
  notifySupportCreated: vi.fn().mockResolvedValue(undefined),
}));
import { createSupportTicket } from "./userController.js";
import { SupportTicket } from "../models/Engagement.js";
const instance = express();
instance.use(express.json());
instance.use((req, _res, next) => {
  req.auth = {
    userId: "user-one",
    role: "USER",
    sessionId: "session",
    permissions: [],
  };
  next();
});
instance.post("/support", createSupportTicket);
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  res.status(error.statusCode || 500).json({ code: error.code });
};
instance.use(errors);
afterEach(() => vi.restoreAllMocks());
it("uses the same per-user ticket identity when retrying a support submission", async () => {
  const input = {
    subject: "Membership question",
    message: "Please help with my membership",
  };
  const ticket = {
    subject: input.subject,
    messages: [{ body: input.message }],
    toObject: () => ({ publicId: "ticket-one" }),
  };
  const upsert = vi
    .spyOn(SupportTicket, "findOneAndUpdate")
    .mockResolvedValue(ticket as never);
  for (let index = 0; index < 2; index++) {
    const response = await request(instance)
      .post("/support")
      .set("idempotency-key", "stable-request-id")
      .send(input);
    expect(response.status).toBe(201);
    expect(response.body.data.conversationId).toBe("support-chat");
  }
  expect(upsert.mock.calls[0][0]).toEqual(upsert.mock.calls[1][0]);
  expect(upsert.mock.calls[0][0]).toMatchObject({
    requesterId: "user-one",
    publicId: expect.stringMatching(/^support_/),
  });
  expect(upsert.mock.calls[0][2]).toMatchObject({
    upsert: true,
    runValidators: true,
  });
});
it("rejects changing a support request while reusing its submission identifier", async () => {
  vi.spyOn(SupportTicket, "findOneAndUpdate").mockResolvedValue({
    subject: "Original",
    messages: [{ body: "Original issue" }],
  } as never);
  const response = await request(instance)
    .post("/support")
    .set("idempotency-key", "stable-request-id")
    .send({ subject: "New subject", message: "Changed issue" });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe("SUBMISSION_KEY_REUSED");
});
