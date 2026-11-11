import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const enqueue = vi.hoisted(() => vi.fn());
vi.mock("../config/env.js", () => ({ env: { NODE_ENV: "test", LOG_LEVEL: "silent", WHATSAPP_MODE: "live" } }));
vi.mock("./whatsappDeliveryService.js", () => ({ enqueueWhatsAppDomainEvent: enqueue, whatsappEventMatrix: { "payment.successful": {}, "membership.activated": {} } }));
import { env } from "../config/env.js";
import { Notification } from "../models/Engagement.js";
import { User } from "../models/User.js";
import { emitDomainEvent } from "./domainEventService.js";
import { processWhatsAppNotificationIntents } from "./whatsappNotificationService.js";
const query = (value: unknown): any => { const q = Promise.resolve(value) as any; for (const key of ["select", "session", "lean"]) q[key] = () => q; return q; };
let notification: Record<string, unknown>;
beforeEach(() => {
  env.WHATSAPP_MODE = "live"; enqueue.mockReset().mockResolvedValue({ status: "QUEUED" });
  notification = { _id: "notification", event: "payment.successful", entityId: "payment-public", userId: "user", gymId: "gym", whatsappOccurrenceId: "capture", whatsappAttempts: 1, createdAt: new Date() };
  vi.spyOn(Notification, "findOneAndUpdate").mockImplementation(() => query(notification));
  vi.spyOn(Notification, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
  vi.spyOn(User, "findOne").mockImplementation(() => query({ name: "Rahul", phone: "9876543210", status: "ACTIVE" }));
  vi.spyOn(User, "findById").mockImplementation(() => query({ name: "Rahul", phone: "9876543210", status: "ACTIVE" }));
});
afterEach(() => vi.restoreAllMocks());
describe("WhatsApp work commits separately from financial operations", () => {
  it("stores only a durable intent inside a payment transaction, without entering the WhatsApp subsystem", async () => {
    enqueue.mockRejectedValue(new Error("WhatsApp database unavailable"));
    const session = {} as any;
    await expect(emitDomainEvent({ event: "payment.successful", entityId: "payment-public", userId: "user", gymId: "gym", session })).resolves.toBeDefined();
    expect(enqueue).not.toHaveBeenCalled();
    expect(Notification.updateOne).toHaveBeenCalledWith(expect.anything(), { $setOnInsert: expect.objectContaining({ whatsappStatus: "QUEUED", channels: ["IN_APP", "PUSH"] }) }, { upsert: true, session });
  });
  it("projects a committed intent without inheriting a transaction session", async () => {
    expect(await processWhatsAppNotificationIntents(1)).toBe(1);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ entityId: "payment-public", occurrenceId: "capture", propagateQueueErrors: true }), expect.objectContaining({ name: "Rahul" }));
    expect(enqueue.mock.calls[0][0]).not.toHaveProperty("session");
    expect(Notification.updateOne).toHaveBeenCalledWith(expect.objectContaining({ whatsappLeaseId: expect.any(String) }), expect.objectContaining({ $set: { whatsappStatus: "ENQUEUED" } }));
  });
  it.each([1, 6])("isolates outbox failure and bounds retries at attempt %s", async attempt => {
    notification.whatsappAttempts = attempt; enqueue.mockRejectedValue(new Error("Outbox unavailable"));
    expect(await processWhatsAppNotificationIntents(1)).toBe(1);
    expect(Notification.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ whatsappStatus: attempt < 6 ? "QUEUED" : "FAILED" }) }));
  });
  it("does not process or send when disabled", async () => {
    env.WHATSAPP_MODE = "disabled";
    expect(await processWhatsAppNotificationIntents()).toBe(0);
    expect(Notification.findOneAndUpdate).not.toHaveBeenCalled(); expect(enqueue).not.toHaveBeenCalled();
  });
  it("suppresses stale intents instead of sending old welcome/payment messages after an outage", async () => {
    notification.createdAt = new Date(Date.now() - 49 * 60 * 60_000);
    await processWhatsAppNotificationIntents(1); expect(enqueue).not.toHaveBeenCalled();
  });
});
