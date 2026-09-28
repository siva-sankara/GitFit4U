import { afterEach, expect, it, vi } from "vitest";
import { Conversation, Message } from "../models/Collaboration.js";
import { queueInvoiceDelivery } from "./invoiceDeliveryService.js";
const mocks = vi.hoisted(() => ({ email: vi.fn(), event: vi.fn() }));
vi.mock("./transactionalEmailService.js", () => ({ queueTransactionalEmail: mocks.email, appEmailUrl: (path: string) => `https://app.test${path}`, emailTemplate: () => ({ subject: "Receipt", html: "View", text: "View" }) }));
vi.mock("./domainEventService.js", () => ({ emitDomainEvent: mocks.event }));
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });
it("permits senderless SYSTEM messages for document and validated upsert contexts", async () => {
  const sender = Message.schema.path("senderId") as any;
  expect(sender.options.required.call({ type: "SYSTEM" })).toBe(false);
  expect(sender.options.required.call({ getUpdate: () => ({ $setOnInsert: { type: "SYSTEM" } }) })).toBe(false);
  expect(sender.options.required.call({ type: "TEXT" })).toBe(true);
  const system = new Message({ publicId: "receipt", clientMessageId: "invoice:receipt", conversationId: "507f1f77bcf86cd799439011", type: "SYSTEM", senderId: null });
  await expect(system.validate()).resolves.toBeUndefined();
});
it("reuses stable invoice and message event keys within the payment transaction", async () => {
  const session = {} as any;
  vi.spyOn(Conversation, "findOneAndUpdate").mockResolvedValue({ _id: "conversation" } as any);
  vi.spyOn(Conversation, "updateOne").mockResolvedValue({} as any);
  const message = vi.spyOn(Message, "findOneAndUpdate").mockResolvedValue({ _id: "message", createdAt: new Date() } as any);
  const invoice = { _id: "invoice", publicId: "invoice-public", number: "GFU-one", userId: "payer", purpose: "PLATFORM_PLAN", supplierSnapshot: { name: "GETFIT4U" }, customerSnapshot: { email: "customer@example.test" } };
  await queueInvoiceDelivery(invoice, session); await queueInvoiceDelivery(invoice, session);
  expect(message.mock.calls.every(call => call[0].clientMessageId === "invoice:invoice-public" && call[0].senderId === null && call[2].session === session)).toBe(true);
  expect(message.mock.calls[0][1].$setOnInsert).toMatchObject({ type: "SYSTEM", actionUrl: "/owner/payments" });
  expect(mocks.email).toHaveBeenCalledWith(expect.objectContaining({ eventKey: "invoice:invoice-public", userId: "payer" }), session);
  expect(mocks.event).toHaveBeenCalledWith(expect.objectContaining({ event: "invoice.ready", entityId: "invoice-public", session }));
});
