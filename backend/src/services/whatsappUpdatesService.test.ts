import { afterEach, expect, it, vi } from "vitest";
import { Gym } from "../models/Gym.js";
import { Payment, Subscription } from "../models/Commerce.js";
import { MemberProfile } from "../models/Member.js";
import { Refund } from "../models/Business.js";
import { membershipWhatsAppUpdates, ownerUpdatesScope, whatsappUpdatesInput } from "./whatsappUpdatesService.js";
import { validWhatsAppInvite } from "../utils/whatsappInvite.js";
afterEach(() => vi.restoreAllMocks());
const group = { enabled: true, type: "group", displayName: "Gym updates", inviteUrl: "https://chat.whatsapp.com/AbCd012345", description: "Timings" };
it.each([
  ["https://chat.whatsapp.com/AbCd012345", "group"],
  ["https://chat.whatsapp.com/AbCd012345?mode=ac_t", "group"],
  ["https://whatsapp.com/channel/0029AbCd", "channel"],
  ["https://www.whatsapp.com/channel/0029AbCd/", "channel"],
])("accepts official destination %s with no arbitrary token length", (url, type) => {
  expect(validWhatsAppInvite(url, type as "group" | "channel")).toBe(true);
});
it.each(["javascript:alert(1)", "data:text/plain,hello", "http://chat.whatsapp.com/AbCd", "https://chat.whatsapp.com.evil.test/AbCd", "https://evil.test/chat.whatsapp.com/AbCd", "https://user:secret@chat.whatsapp.com/AbCd", "https://chat.whatsapp.com:443/AbCd", "https://chat.whatsapp.com:8080/AbCd", "https://chat.whatsapp.com/", "https://chat.whatsapp.com/a/../AbCd", "https://chat.whatsapp.com/%41bCd", "https://chat.whatsapp.com/AbCd?redirect=https://evil.test", "https://chat.whatsapp.com/AbCd#hello", "https://wa.me/AbCd", "https://chat.whatsapp.com/AbCd\\extra"])("rejects unsafe or malformed link %s", url => {
  expect(validWhatsAppInvite(url, "group")).toBe(false);
});
it("validates paired settings, allows disabling/removing, and preserves identifier case", () => {
  expect(whatsappUpdatesInput.parse(group).inviteUrl).toBe(group.inviteUrl);
  expect(whatsappUpdatesInput.safeParse({ ...group, type: "channel" }).success).toBe(false);
  expect(whatsappUpdatesInput.safeParse({ ...group, displayName: "" }).success).toBe(false);
  expect(whatsappUpdatesInput.safeParse({ ...group, enabled: false, displayName: "", inviteUrl: "" }).success).toBe(true);
});
it("binds edits to the active gym AND authenticated owner; denies staff/member edits", () => {
  expect(ownerUpdatesScope({ role: "GYM_OWNER", userId: "owner", gymId: "gym-a" } as never)).toEqual({ _id: "gym-a", ownerId: "owner", deletedAt: null });
  for (const role of ["USER", "GYM_STAFF", "TRAINER", "ADMIN"]) expect(() => ownerUpdatesScope({ role, userId: "someone", gymId: "gym-a" } as never)).toThrow("Only the gym owner");
});
function setup(patch = {}) {
  vi.spyOn(Refund, "exists").mockResolvedValue(null);
  const subscription = { _id: "subscription-a", publicId: "membership-a", userId: "user-a", gymId: "gym-a", memberProfileId: "member-a", latestPaymentId: "payment-a", type: "GYM_MEMBERSHIP", status: "ACTIVE", endsAt: new Date(Date.now() + 86400000), ...patch };
  const findSubscription = vi.spyOn(Subscription, "findOne").mockReturnValue({ lean: async () => subscription } as never);
  const member = vi.spyOn(MemberProfile, "exists").mockResolvedValue({ _id: "member-a" } as never);
  const payment = vi.spyOn(Payment, "exists").mockResolvedValue({ _id: "payment-a" } as never);
  const gym = vi.spyOn(Gym, "findOne").mockReturnValue({ select: () => ({ lean: async () => ({ name: "Gym A", whatsappUpdates: group }) }) } as never);
  return { findSubscription, member, payment, gym };
}
it.each(["ACTIVE", "FROZEN"])("allows paid %s memberships (including future start) with exact financial and tenant binding", async status => {
  const mocks = setup({ status, startsAt: new Date(Date.now() + 3600000) });
  expect(await membershipWhatsAppUpdates("user-a", "membership-a")).toMatchObject({ gymName: "Gym A", inviteUrl: group.inviteUrl });
  expect(mocks.findSubscription).toHaveBeenCalledWith({ publicId: "membership-a", userId: "user-a", type: "GYM_MEMBERSHIP" });
  expect(mocks.payment).toHaveBeenCalledWith({ _id: "payment-a", payerId: "user-a", gymId: "gym-a", subscriptionId: "subscription-a", purpose: "MEMBERSHIP", status: "CAPTURED", fulfillmentStatus: "APPLIED", $or: [{ provider: "RAZORPAY" }, { provider: "OFFLINE", "metadata.collectorId": { $exists: true }, capturedAt: { $ne: null } }] });
  expect(mocks.member).toHaveBeenCalledWith(expect.objectContaining({ userId: "user-a", gymId: "gym-a", status: "ACTIVE" }));
});
it.each(["PENDING_PAYMENT", "EXPIRED", "CANCELLED", "GRACE", "DEACTIVATED"])("hides the link for %s memberships", async status => {
  const mocks = setup({ status }); expect(await membershipWhatsAppUpdates("user-a", "membership-a")).toBeNull(); expect(mocks.gym).not.toHaveBeenCalled();
});
it("denies cross-account or platform membership identifiers", async () => {
  const mocks = setup(); mocks.findSubscription.mockReturnValue({ lean: async () => null } as never);
  await expect(membershipWhatsAppUpdates("other", "membership-a")).rejects.toMatchObject({ statusCode: 404 });
  expect(mocks.gym).not.toHaveBeenCalled();
});
it.each(["payment", "member"] as const)("does not load private configuration when %s eligibility is missing", async key => {
  const mocks = setup(); mocks[key].mockResolvedValue(null);
  expect(await membershipWhatsAppUpdates("user-a", "membership-a")).toBeNull(); expect(mocks.gym).not.toHaveBeenCalled();
});
it("never returns disabled links or expired subscriptions", async () => {
  const mocks = setup(); mocks.gym.mockReturnValue({ select: () => ({ lean: async () => ({ whatsappUpdates: { ...group, enabled: false } }) }) } as never);
  expect(await membershipWhatsAppUpdates("user-a", "membership-a")).toBeNull();
  mocks.findSubscription.mockReturnValue({ lean: async () => ({ status: "ACTIVE", endsAt: new Date(0), latestPaymentId: "p" }) } as never);
  expect(await membershipWhatsAppUpdates("user-a", "membership-a")).toBeNull();
});
it("excludes invitations from normal gym queries and populates", () => {
  expect(Gym.schema.path("whatsappUpdates").options.select).toBe(false);
});
