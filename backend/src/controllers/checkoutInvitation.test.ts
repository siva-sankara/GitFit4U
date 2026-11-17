import { afterEach, expect, it, vi } from "vitest";
import { Payment, Subscription } from "../models/Commerce.js";
import { paymentStatus } from "./checkoutController.js";
vi.mock("../services/whatsappUpdatesService.js", () => ({ platformOwnersInvitation: vi.fn(async () => null) }));
function responseMock() { const result: any = { json: vi.fn() }; result.set = vi.fn(() => result); return result; }
afterEach(() => vi.restoreAllMocks());
const req = { params: { id: "payment-a" }, auth: { userId: "member-a" }, query: { success: "true", gymId: "gym-b" } } as any;
const lean = (value: unknown) => ({ lean: async () => value }) as never;
it.each([
  { status: "PENDING", purpose: "MEMBERSHIP" }, { status: "AUTHORIZED", purpose: "MEMBERSHIP" }, { status: "FAILED", purpose: "MEMBERSHIP" },
  { status: "CAPTURED", purpose: "MEMBERSHIP", fulfillmentStatus: "PENDING" },
  { status: "CAPTURED", purpose: "PLATFORM_PLAN", fulfillmentStatus: "APPLIED" },
])("does not add a member invitation target for %j regardless of client flags", async payment => {
  vi.spyOn(Payment, "findOne").mockReturnValue(lean(payment));
  const subscription = vi.spyOn(Subscription, "findOne");
  const response = responseMock(); await paymentStatus(req, response);
  expect(response.json).toHaveBeenCalledWith({ success: true, data: { ...payment, membershipPublicId: null, ownersInvitation: null } });
  expect(subscription).not.toHaveBeenCalled();
});
it("binds confirmed fulfillment to the same authenticated purchaser, gym and subscription", async () => {
  const payment = { status: "CAPTURED", purpose: "MEMBERSHIP", fulfillmentStatus: "APPLIED", gymId: "gym-a", subscriptionId: "subscription-a" };
  const find = vi.spyOn(Payment, "findOne").mockReturnValue(lean(payment));
  const subscription = vi.spyOn(Subscription, "findOne").mockReturnValue({ select: () => lean({ publicId: "membership-a" }) } as never);
  const response = responseMock(); await paymentStatus(req, response);
  expect(find).toHaveBeenCalledWith({ publicId: "payment-a", payerId: "member-a" });
  expect(subscription).toHaveBeenCalledWith({ _id: "subscription-a", userId: "member-a", gymId: "gym-a", type: "GYM_MEMBERSHIP" });
  expect(response.json).toHaveBeenCalledWith({ success: true, data: { ...payment, membershipPublicId: "membership-a", ownersInvitation: null } });
});
it("rejects another payer's payment reference", async () => {
  vi.spyOn(Payment, "findOne").mockReturnValue(lean(null));
  await expect(paymentStatus(req, {} as any)).rejects.toMatchObject({ statusCode: 404 });
});
