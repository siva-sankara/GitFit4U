import mongoose from "mongoose";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { Invoice } from "../models/Business.js";
import { Payment } from "../models/Commerce.js";
import { TransactionalEmail } from "../models/Delivery.js";
import { invoiceDeliveryStatus, invoiceEmail } from "./invoiceEmailService.js";
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), queue: vi.fn() }));
vi.mock("./invoiceService.js", () => ({ ensurePaymentInvoice: mocks.ensure, invoicePaymentScope: (auth: any) => ({ payerId: auth.userId }) }));
vi.mock("./invoiceDeliveryService.js", () => ({ queueInvoiceEmail: mocks.queue }));
vi.mock("../integrations/notifications/emailProvider.js", () => ({ emailConfigured: () => false }));
const session = {} as any, auth = { role: "USER", userId: "payer", permissions: [] as string[] };
const invoice = { _id: "invoice", publicId: "receipt-one", issuedAt: new Date(), customerSnapshot: { email: "payer@example.test" } };
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (work: any) => work(session));
  vi.spyOn(Payment, "findOne").mockReturnValue({ session: async () => ({ _id: "payment" }) } as any);
  mocks.ensure.mockResolvedValue(invoice);
});
afterEach(() => vi.restoreAllMocks());
it("rejects another user's invoice before queue or snapshot access", async () => {
  vi.spyOn(Payment, "findOne").mockReturnValue({ session: async () => null } as any);
  await expect(invoiceEmail("another-payment", auth, "request-key")).rejects.toMatchObject({ code: "PAYMENT_NOT_FOUND" });
  expect(Payment.findOne).toHaveBeenCalledWith({ publicId: "another-payment", payerId: "payer" });
  expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
});
it("a repeated explicit request returns the previous delivery without another enqueue", async () => {
  vi.spyOn(TransactionalEmail, "findOne").mockReturnValue({ session: async () => ({ status: "SENT", sentAt: new Date() }) } as any);
  const claim = vi.spyOn(Invoice, "findOneAndUpdate");
  expect(await invoiceEmail("payment", auth, "request-key")).toMatchObject({ invoiceId: "receipt-one", status: "SENT", configured: false });
  expect(claim).not.toHaveBeenCalled(); expect(mocks.queue).not.toHaveBeenCalled();
});
it("an explicit resend reuses the invoice, cancels only unsent work and queues a new stable attempt", async () => {
  vi.spyOn(TransactionalEmail, "findOne").mockReturnValue({ session: async () => null } as any);
  vi.spyOn(Invoice, "findOneAndUpdate").mockResolvedValue(invoice as any);
  vi.spyOn(TransactionalEmail, "exists").mockReturnValue({ session: async () => null } as any);
  const cancel = vi.spyOn(TransactionalEmail, "updateMany").mockResolvedValue({} as any);
  mocks.queue.mockResolvedValue({ status: "QUEUED", createdAt: new Date() });
  expect(await invoiceEmail("payment", auth, "request-key")).toMatchObject({ invoiceId: "receipt-one", status: "QUEUED", configured: false });
  expect(cancel).toHaveBeenCalledWith({ kind: "INVOICE", entityId: "invoice", status: "QUEUED" }, { $set: { status: "CANCELLED" } }, { session });
  expect(mocks.queue).toHaveBeenCalledWith(invoice, expect.stringMatching(/^invoice:receipt-one:resend:[a-f0-9]{64}$/), session);
});
it("reports generated/queued/provider accepted/confirmed delivery timestamps separately", () => {
  const createdAt = new Date(), sentAt = new Date(), deliveredAt = new Date();
  expect(invoiceDeliveryStatus(invoice, { status: "SENT", createdAt, sentAt })).toMatchObject({ generatedAt: invoice.issuedAt, queuedAt: createdAt, sentAt, deliveredAt: undefined, status: "SENT" });
  expect(invoiceDeliveryStatus(invoice, { status: "DELIVERED", createdAt, sentAt, deliveredAt })).toMatchObject({ deliveredAt, status: "DELIVERED" });
});
