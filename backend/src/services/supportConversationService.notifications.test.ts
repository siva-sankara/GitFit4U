import { afterEach, expect, it, vi } from "vitest";
import { User } from "../models/User.js";
import * as events from "./domainEventService.js";
import { notifySupportReply } from "./supportConversationService.js";
afterEach(() => vi.restoreAllMocks());
const ticket = { _id: "ticket", requesterId: "requester", gymId: "gym" };
it("notifies only the requester for a persisted administrator reply with retry-stable dedupe", async () => {
  vi.spyOn(User, "exists").mockResolvedValue({ _id: "admin" } as never);
  const emit = vi.spyOn(events, "emitDomainEvent").mockResolvedValue({} as never);
  for (let attempt = 0; attempt < 2; attempt++)
    await notifySupportReply(ticket, "conversation", { _id: "persisted-reply", authorId: "admin" });
  expect(emit).toHaveBeenCalledTimes(2);
  expect(emit.mock.calls[0]).toEqual(emit.mock.calls[1]);
  expect(emit).toHaveBeenCalledWith(expect.objectContaining({
    event: "support.updated", userId: "requester", entityId: "ticket",
    occurrenceId: "reply:persisted-reply", actionUrl: "/messages/conversation",
  }));
});
it("routes requester replies to a bounded active admin audience, excluding the sender", async () => {
  const limit = vi.fn(() => ({ lean: async () => [{ _id: "admin-a" }, { _id: "admin-b" }] }));
  const find = vi.spyOn(User, "find").mockReturnValue({ select: () => ({ limit }) } as never);
  const emit = vi.spyOn(events, "emitDomainEvent").mockResolvedValue({} as never);
  await notifySupportReply(ticket, "conversation", { _id: "reply", authorId: "requester" });
  expect(find).toHaveBeenCalledWith({ roles: "ADMIN", status: "ACTIVE", _id: { $ne: "requester" } });
  expect(limit).toHaveBeenCalledWith(100);
  expect(emit.mock.calls.map(([event]) => event.userId)).toEqual(["admin-a", "admin-b"]);
});
it("rejects unrelated authors and unsaved replies without notifying anyone", async () => {
  vi.spyOn(User, "exists").mockResolvedValue(null);
  const emit = vi.spyOn(events, "emitDomainEvent").mockResolvedValue({} as never);
  await expect(notifySupportReply(ticket, "conversation", { _id: "reply", authorId: "unrelated" })).rejects.toMatchObject({ code: "SUPPORT_REPLY_FORBIDDEN" });
  await expect(notifySupportReply(ticket, "conversation", { authorId: "requester" })).rejects.toMatchObject({ code: "SUPPORT_REPLY_NOT_SAVED" });
  await expect(notifySupportReply(ticket, "conversation", undefined)).rejects.toMatchObject({ code: "SUPPORT_REPLY_NOT_SAVED" });
  expect(emit).not.toHaveBeenCalled();
});
