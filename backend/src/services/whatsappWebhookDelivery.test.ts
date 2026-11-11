import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import mongoose from "mongoose";
vi.mock("../config/env.js", () => ({ env: { NODE_ENV: "test", LOG_LEVEL: "silent", WHATSAPP_MODE: "disabled" } }));
vi.mock("./otpService.js", () => ({ recordOtpDeliveryStatus: vi.fn().mockResolvedValue(false) }));
vi.mock("./domainEventService.js", () => ({ emitDomainEvents: vi.fn() }));
import { WhatsAppConnection, WhatsAppMessage, WhatsAppOutbox, WhatsAppWebhookReceipt, WhatsAppTemplate, WhatsAppConversation } from "../models/WhatsApp.js";
import { Campaign } from "../models/Engagement.js";
import { MemberCommunication } from "../models/Communication.js";
import { RoleAssignment } from "../models/Auth.js";
import { User } from "../models/User.js";
import { emitDomainEvents } from "./domainEventService.js";
import { processWhatsAppWebhooks } from "./whatsappWebhookService.js";
const query = (value: unknown): any => { const q = Promise.resolve(value) as any; for (const key of ["select", "session", "lean"]) q[key] = () => q; return q; };
let message: any;
let receipt: any;
const connection = { _id: "connection", gymId: "gym", scope: "GYM" };
const statusPayload = (status: string) => ({ entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, statuses: [{ id: "wamid.test", status, timestamp: "1794376800", ...(status === "failed" ? { errors: [{ code: 131026, title: "private provider detail" }] } : {}) }] } }] }] });
async function process(payload: unknown) {
  receipt = { _id: "receipt", eventKey: "event", attempts: 1, payload };
  return processWhatsAppWebhooks(1);
}
beforeEach(() => {
  message = { _id: "message", outboxId: "outbox", status: "ACCEPTED" };
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (work: any) => work({ id: "status-session" }));
  vi.spyOn(WhatsAppWebhookReceipt, "findOneAndUpdate").mockImplementation(() => query(receipt));
  vi.spyOn(WhatsAppWebhookReceipt, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
  vi.spyOn(WhatsAppConnection, "findOne").mockResolvedValue(connection as never);
  vi.spyOn(WhatsAppMessage, "findOne").mockImplementation(() => query({ ...message }));
  vi.spyOn(WhatsAppMessage, "updateOne").mockImplementation(async (filter: any, update: any) => {
    if (filter.status !== message.status) return { modifiedCount: 0 } as never;
    Object.assign(message, update.$set); return { modifiedCount: 1 } as never;
  });
  vi.spyOn(WhatsAppOutbox, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
  vi.spyOn(WhatsAppOutbox, "findById").mockImplementation(() => query({ businessEvent: "whatsapp.campaign", businessEntityId: "campaign" }));
  vi.spyOn(MemberCommunication, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
  vi.spyOn(Campaign, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
  vi.spyOn(WhatsAppTemplate, "updateMany").mockResolvedValue({ modifiedCount: 1 } as never);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
describe("durable WhatsApp webhook state", () => {
  it.each(["sent", "delivered", "read", "failed"])("tracks %s against the bound sender and wamid", async status => {
    expect(await process(statusPayload(status))).toBe(1);
    expect(message.status).toBe(status.toUpperCase());
    expect(WhatsAppMessage.findOne).toHaveBeenCalledWith({ connectionId: "connection", providerMessageId: "wamid.test" });
    expect(WhatsAppOutbox.updateOne).toHaveBeenCalledWith(expect.objectContaining({ _id: "outbox", connectionId: "connection" }), expect.objectContaining({ $set: expect.objectContaining({ status: status.toUpperCase() }) }), { session: { id: "status-session" } });
    if (status === "failed") expect(message.errorCategory).toBe("PROVIDER_DELIVERY_FAILED");
  });
  it("does not duplicate transitions/counters across repeated receipts", async () => {
    await process(statusPayload("read")); await process(statusPayload("read"));
    expect(WhatsAppMessage.updateOne).toHaveBeenCalledTimes(1);
    expect(Campaign.updateOne).toHaveBeenCalledTimes(1);
    expect(Campaign.updateOne).toHaveBeenCalledWith({ publicId: "campaign" }, { $inc: { "analytics.sent": 1, "analytics.delivered": 1, "analytics.read": 1 } }, expect.anything());
  });
  it("does not regress READ on late SENT or FAILED events", async () => {
    await process(statusPayload("read")); await process(statusPayload("sent")); await process(statusPayload("failed"));
    expect(message.status).toBe("READ"); expect(Campaign.updateOne).toHaveBeenCalledTimes(1);
  });
  it("does not increment analytics when a competing worker won the transition", async () => {
    vi.mocked(WhatsAppMessage.updateOne).mockResolvedValue({ modifiedCount: 0 } as never);
    await process(statusPayload("read")); expect(Campaign.updateOne).not.toHaveBeenCalled();
  });
  it("changes only the cached template belonging to the webhook's WABA", async () => {
    await process({ entry: [{ id: "waba", time: 1794376800, changes: [{ field: "message_template_status_update", value: { message_template_id: "template", event: "PAUSED" } }] }] });
    expect(WhatsAppTemplate.updateMany).toHaveBeenCalledWith(expect.objectContaining({ wabaId: "waba", providerTemplateId: "template", $or: expect.any(Array) }), { $set: { status: "PAUSED", providerUpdatedAt: new Date(1794376800000) } });
    expect(WhatsAppConnection.findOne).not.toHaveBeenCalled();
  });
  it.each([
    [{ type: "button", button: { text: "Renew now" } }, { contentType: "TEXT", text: "Renew now" }],
    [{ type: "interactive", interactive: { button_reply: { title: "Help" } } }, { contentType: "TEXT", text: "Help" }],
    [{ type: "future_unknown_type" }, { contentType: "UNSUPPORTED" }],
  ])("stores supported replies and unknown inbound types without crashing", async (content, expected) => {
    vi.spyOn(User, "findOne").mockImplementation(() => query(null));
    vi.spyOn(WhatsAppConversation, "findOneAndUpdate").mockResolvedValue({ _id: "conversation", publicId: "conversation-public" } as never);
    vi.spyOn(WhatsAppConversation, "updateOne").mockResolvedValue({ modifiedCount: 1 } as never);
    vi.spyOn(WhatsAppMessage, "create").mockResolvedValue({} as never);
    vi.spyOn(RoleAssignment, "find").mockReturnValue({ distinct: () => Promise.resolve(["owner"]) } as never);
    const payload = { entry: [{ id: "waba", changes: [{ field: "messages", value: { metadata: { phone_number_id: "phone" }, messages: [{ id: "wamid.inbound", from: "919876543210", ...content }] } }] }] };
    await process(payload);
    expect(WhatsAppMessage.create).toHaveBeenCalledWith(expect.objectContaining(expected));
    expect(emitDomainEvents).toHaveBeenCalledTimes(1);
    vi.mocked(WhatsAppMessage.create).mockRejectedValue({ code: 11000 });
    await process(payload);
    expect(emitDomainEvents).toHaveBeenCalledTimes(1); expect(WhatsAppConversation.updateOne).toHaveBeenCalledTimes(1);
  });
});
