import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TransactionalEmail } from "../models/Delivery.js";
import { deliverTransactionalEmails, encryptEmail, decryptEmail, queueTransactionalEmail } from "./transactionalEmailService.js";
const mocks = vi.hoisted(() => ({ configured: vi.fn(), send: vi.fn(), status: vi.fn() }));
vi.mock("../integrations/notifications/emailProvider.js", () => ({ emailConfigured: mocks.configured, sendTransactionalEmail: mocks.send, transactionalEmailStatus: mocks.status }));
beforeEach(() => { vi.clearAllMocks(); mocks.configured.mockReturnValue(true); vi.spyOn(TransactionalEmail, "find").mockReturnValue({ sort: () => ({ limit: async () => [] }) } as any); });
afterEach(() => vi.restoreAllMocks());
it("encrypts contact/token content with authenticated encryption and rejects tampering", () => {
  const content = { to: "private@example.test", subject: "Welcome", html: "secret-token", text: "secret-token" };
  const encrypted = encryptEmail(content);
  expect(encrypted).not.toContain("secret-token");
  expect(decryptEmail(encrypted)).toEqual(content);
  const [iv, tag, data] = encrypted.split(".");
  expect(() => decryptEmail(`${iv}.${tag}.${data.slice(0, -3)}AAA`)).toThrow();
});
it("keeps the same event's email envelope on replays", async () => {
  const queue = vi.spyOn(TransactionalEmail, "findOneAndUpdate").mockResolvedValue({} as any);
  const input = { eventKey: "invoice:one", userId: "user", kind: "INVOICE" as const, entityId: "invoice", content: { to: "member@example.test", subject: "Invoice", html: "View", text: "View" } };
  await queueTransactionalEmail(input); await queueTransactionalEmail(input);
  expect(queue.mock.calls.every(call => call[0].eventKey === input.eventKey && Object.keys(call[1]).join() === "$setOnInsert")).toBe(true);
});
it("leaves durable messages queued when delivery is not configured", async () => {
  mocks.configured.mockReturnValue(false);
  const claim = vi.spyOn(TransactionalEmail, "findOneAndUpdate");
  expect(await deliverTransactionalEmails()).toEqual({ configured: false, processed: 0 });
  expect(claim).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
});
it("retries a provider outage without reporting sent or delivered", async () => {
  const now = new Date();
  vi.spyOn(TransactionalEmail, "findOneAndUpdate").mockReturnValue({ select: vi.fn().mockResolvedValue({ _id: "mail", kind: "INVOICE", eventKey: "invoice:one", attempts: 1, encryptedPayload: encryptEmail({ to: "member@example.test", subject: "Receipt", html: "View", text: "View" }) }) } as any);
  const update = vi.spyOn(TransactionalEmail, "updateOne").mockResolvedValue({} as any);
  mocks.send.mockRejectedValue({ code: "EMAIL_PROVIDER_503" });
  await deliverTransactionalEmails(1, now);
  expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ _id: "mail", leaseToken: expect.any(String) }), expect.objectContaining({ $set: expect.objectContaining({ status: "QUEUED", lastErrorCode: "EMAIL_PROVIDER_503" }) }));
  expect(mocks.send).toHaveBeenCalledWith(expect.anything(), "invoice:one");
});
it("does not replay ambiguous sends after the provider idempotency retention window", async () => {
  vi.spyOn(TransactionalEmail, "findOneAndUpdate").mockReturnValue({ select: vi.fn().mockResolvedValue({ _id: "mail", firstAttemptAt: new Date(0), kind: "INVOICE" }) } as any);
  const update = vi.spyOn(TransactionalEmail, "updateOne").mockResolvedValue({} as any);
  await deliverTransactionalEmails(1);
  expect(update).toHaveBeenCalledWith(expect.anything(), { $set: { status: "FAILED", lastErrorCode: "EMAIL_RECONCILIATION_REQUIRED" } });
  expect(mocks.send).not.toHaveBeenCalled();
});
