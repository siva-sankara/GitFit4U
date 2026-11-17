import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { TransactionalEmail } from "../models/Delivery.js";
import { deliverTransactionalEmails, encryptEmail, decryptEmail, queueTransactionalEmail, emailTemplate } from "./transactionalEmailService.js";
import { env } from "../config/env.js";
const mocks = vi.hoisted(() => ({ configured: vi.fn(), send: vi.fn(), status: vi.fn(), graphConfigured: vi.fn(), graphSend: vi.fn() }));
vi.mock("../integrations/notifications/microsoftGraphOtpProvider.js", () => ({ microsoftGraphOtpConfigured: mocks.graphConfigured, sendMicrosoftGraphEmail: mocks.graphSend }));
vi.mock("../integrations/notifications/emailProvider.js", () => ({ emailConfigured: mocks.configured, sendTransactionalEmail: mocks.send, transactionalEmailStatus: mocks.status }));
beforeEach(() => { vi.clearAllMocks(); mocks.configured.mockReturnValue(true); mocks.graphConfigured.mockReturnValue(false); vi.spyOn(TransactionalEmail, "updateMany").mockResolvedValue({} as any); vi.spyOn(TransactionalEmail, "find").mockReturnValue({ sort: () => ({ limit: async () => [] }) } as any); });
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
it("preserves membership line breaks while escaping email HTML", () => {
  const content = emailTemplate("Welcome", "Plan: <Gold>\nPayment: paid", "Sign in", "https://example.test", "Optional");
  expect(content.html).toContain("Plan: &lt;Gold&gt;<br />Payment: paid");
});
it.each(["accepted", "ambiguous", "reclaimed", "persistence-failure"])("handles a %s Graph welcome without claiming inbox delivery or repeating an uncertain send", async outcome => {
  mocks.graphConfigured.mockReturnValue(true);
  const oldFrom = env.M365_FROM_EMAIL, oldMailbox = env.M365_SENDER_MAILBOX;
  env.M365_FROM_EMAIL = env.M365_SENDER_MAILBOX = "support@getfit4u.in";
  try {
    vi.spyOn(TransactionalEmail, "findOneAndUpdate").mockReturnValue({ select: vi.fn().mockResolvedValue({ _id: "welcome", kind: "WELCOME", provider: "GRAPH", attempts: 1, ...(outcome === "reclaimed" ? { firstAttemptAt: new Date() } : {}), encryptedPayload: encryptEmail({ to: "fixture@example.test", subject: "Welcome", text: "Membership saved", html: "Membership saved" }) }) } as any);
    const update = vi.spyOn(TransactionalEmail, "updateOne").mockResolvedValue({} as any);
    if (outcome === "persistence-failure") update.mockImplementation(async (_filter, change) => { if ((change as any).$set?.status === "SENT") throw new Error("Database temporarily unavailable"); return {} as any; });
    if (outcome === "ambiguous") mocks.graphSend.mockRejectedValue({ code: "M365_SUBMISSION_UNKNOWN" });
    else mocks.graphSend.mockResolvedValue({ submissionReference: "accepted-fixture" });
    await deliverTransactionalEmails(1);
    expect(mocks.send).not.toHaveBeenCalled();
    if (outcome === "accepted") {
      expect(update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ status: "SENT" }), $unset: expect.objectContaining({ encryptedPayload: 1 }) }));
      expect(update.mock.calls.some(([, change]) => change.$set?.status === "DELIVERED")).toBe(false);
    } else {
      expect(update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ status: "FAILED", lastErrorCode: outcome === "ambiguous" ? "M365_SUBMISSION_UNKNOWN" : "EMAIL_RECONCILIATION_REQUIRED" }) }));
      if (outcome === "reclaimed") expect(mocks.graphSend).not.toHaveBeenCalled();
    }
  } finally { env.M365_FROM_EMAIL = oldFrom; env.M365_SENDER_MAILBOX = oldMailbox; }
});
