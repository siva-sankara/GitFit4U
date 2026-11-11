import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../config/env.js", () => ({ env: { NODE_ENV: "test", LOG_LEVEL: "silent", WHATSAPP_MODE: "live", WHATSAPP_DEFAULT_LANGUAGE: "en_US" } }));
import { WhatsAppConnection, WhatsAppConversation, WhatsAppMessage, WhatsAppOutbox, WhatsAppTemplate } from "../models/WhatsApp.js";
import { queueWhatsAppConversationMessage } from "./whatsappDeliveryService.js";
const query = (value: unknown): any => { const q = Promise.resolve(value) as any; for (const key of ["select", "lean"]) q[key] = () => q; return q; };
const actor = { userId: "owner", role: "GYM_OWNER", gymId: "own-gym", permissions: ["member:read"] };
const input = { idempotencyKey: "request", purpose: "SERVICE" as const, templateId: "507f1f77bcf86cd799439011" };
beforeEach(() => {
  vi.spyOn(WhatsAppConnection, "findOne").mockImplementation(() => query({ _id: "own-connection", publicId: "sender" }));
  vi.spyOn(WhatsAppConversation, "findOne").mockImplementation(() => query({ _id: "conversation", publicId: "conversation-public", scope: "GYM", gymId: "own-gym", providerContactId: "919876543210", lastInboundAt: new Date() }));
  vi.spyOn(WhatsAppTemplate, "findOne").mockImplementation(() => query({ name: "from_database", language: "en_US", components: [{ type: "BODY", text: "Your gym has an update." }] }));
  vi.spyOn(WhatsAppOutbox, "findOneAndUpdate").mockImplementation(async (_filter: any, update: any) => ({ _id: "outbox", ...update.$setOnInsert }));
  vi.spyOn(WhatsAppMessage, "exists").mockResolvedValue({ _id: "message" } as never);
});
afterEach(() => vi.restoreAllMocks());
describe("authorized catalog selection for the existing WhatsApp inbox", () => {
  it("derives sender, recipient and template details from server-owned records", async () => {
    const outbox = await queueWhatsAppConversationMessage(actor, "conversation-public", input);
    expect(WhatsAppConnection.findOne).toHaveBeenCalledWith({ bindingKey: "GYM:own-gym" });
    expect(WhatsAppTemplate.findOne).toHaveBeenCalledWith({ connectionId: "own-connection", _id: input.templateId, category: "UTILITY", status: "APPROVED" });
    expect(outbox).toMatchObject({ connectionId: "own-connection", recipientId: "919876543210", template: { name: "from_database", language: "en_US", parameters: [] } });
  });
  it("does not access another gym's conversation", async () => {
    vi.mocked(WhatsAppConversation.findOne).mockImplementation(() => query(null));
    await expect(queueWhatsAppConversationMessage(actor, "foreign-conversation", input)).rejects.toMatchObject({ code: "WHATSAPP_CONVERSATION_NOT_FOUND" });
    expect(WhatsAppConversation.findOne).toHaveBeenCalledWith({ publicId: "foreign-conversation", connectionId: "own-connection" });
    expect(WhatsAppOutbox.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it("does not accept another sender's template or an unapproved template", async () => {
    vi.mocked(WhatsAppTemplate.findOne).mockImplementation(() => query(null));
    await expect(queueWhatsAppConversationMessage(actor, "conversation-public", input)).rejects.toMatchObject({ code: "WHATSAPP_TEMPLATE_UNAVAILABLE" });
    expect(WhatsAppOutbox.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it("rejects frontend-provided template parameters", async () => {
    await expect(queueWhatsAppConversationMessage(actor, "conversation-public", { ...input, parameters: [{ type: "body", parameters: [{ text: "forged payment" }] }] })).rejects.toMatchObject({ code: "WHATSAPP_PARAMETERS_NOT_ALLOWED" });
    expect(WhatsAppOutbox.findOneAndUpdate).not.toHaveBeenCalled();
  });
  it("requires business actions to build templates with variables", async () => {
    vi.mocked(WhatsAppTemplate.findOne).mockImplementation(() => query({ components: [{ type: "BODY", text: "Hi {{1}}" }] }));
    await expect(queueWhatsAppConversationMessage(actor, "conversation-public", input)).rejects.toMatchObject({ code: "WHATSAPP_TEMPLATE_PARAMETERS_REQUIRED" });
  });
});
