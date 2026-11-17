import { afterEach, expect, it, vi } from "vitest";
vi.mock("./supportConversationService.js", () => ({ ensureSupportConversation: vi.fn(async () => ({ publicId: "support-conversation" })) }));
vi.mock("./whatsappDeliveryService.js", () => ({ getWhatsAppConversation: vi.fn(async () => ({ publicId: "whatsapp-conversation" })) }));
import { Subscription, Payment } from "../models/Commerce.js";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { Conversation, Message } from "../models/Collaboration.js";
import { SupportTicket, ClassBooking, Review } from "../models/Engagement.js";
import { resolveNotificationDestination as resolve } from "./notificationDestinationService.js";
import { getWhatsAppConversation } from "./whatsappDeliveryService.js";
const owner = { userId: "owner", gymId: "gym-a", role: "GYM_OWNER", permissions: ["gym:read", "member:read"] } as never;
const user = { userId: "user", role: "USER", permissions: [] } as never;
afterEach(() => vi.restoreAllMocks());
const lean = (value: unknown) => ({ lean: async () => value }) as never;
it("opens platform renewals even though the historical event is membership.renewed", async () => {
  vi.spyOn(Subscription, "findOne").mockReturnValue(lean({ type: "PLATFORM", gymId: "gym-a", publicId: "sub" }));
  vi.spyOn(Gym, "findOne").mockReturnValue(lean({ publicId: "gym-public" }));
  expect(await resolve({ event: "membership.renewed", entityId: "sub" }, owner)).toMatchObject({ available: true, path: "/platform-renewal?gym=gym-public" });
});
it("opens the exact member subscription", async () => {
  vi.spyOn(Subscription, "findOne").mockReturnValue(lean({ type: "GYM_MEMBERSHIP", publicId: "sub-a" }));
  expect(await resolve({ event: "membership.activated", entityId: "sub-a" }, user)).toMatchObject({ path: "/app/profile?section=membership&membership=sub-a" });
});
it("opens owner join requests at the requested member instead of looking for the owner's own membership", async () => {
  vi.spyOn(Gym, "exists").mockResolvedValue({ _id: "gym-a" } as never);
  const member = vi.spyOn(MemberProfile, "findOne").mockReturnValue(lean({ publicId: "request-member" }));
  expect(await resolve({ event: "membership.requested", entityId: "request-member", gymId: "gym-a" }, owner)).toMatchObject({ path: "/owner/members/request-member" });
  expect(member).toHaveBeenCalledWith(expect.objectContaining({ gymId: "gym-a" }));
});
it("routes gym status updates to gym settings, not renewal checkout", async () => {
  vi.spyOn(Gym, "findOne").mockReturnValue(lean({ _id: "gym-a", publicId: "gym-public" }));
  expect(await resolve({ event: "gym.activated", gymId: "gym-a" }, owner)).toMatchObject({ path: "/owner/gym-profile" });
});
it("opens announcements/campaigns in their own detail without trying to access gym billing", async () => {
  const gym = vi.spyOn(Gym, "findOne");
  for (const row of [{ event: "gym.announcement" }, { dedupeKey: "campaign:first", entityType: "SYSTEM" }])
    expect(await resolve({ ...row, _id: "507f1f77bcf86cd799439011" }, user)).toMatchObject({ path: "/app/notifications?notification=507f1f77bcf86cd799439011" });
  expect(gym).not.toHaveBeenCalled();
});
it("opens inbound WhatsApp in the WhatsApp channel using its existing access check", async () => {
  expect(await resolve({ event: "message.received", entityId: "whatsapp-conversation", actionUrl: "/messages?channel=whatsapp&conversation=whatsapp-conversation" }, owner)).toMatchObject({ path: "/owner/messages?channel=whatsapp&conversation=whatsapp-conversation" });
  expect(getWhatsAppConversation).toHaveBeenCalledWith(owner, "whatsapp-conversation");
});
it("keeps ordinary messages scoped to their recipient", async () => {
  vi.spyOn(Message, "findOne").mockReturnValue(lean({ conversationId: "internal" }));
  const conversation = vi.spyOn(Conversation, "findOne").mockReturnValue(lean({ publicId: "conversation" }));
  expect(await resolve({ event: "message.received", entityId: "message" }, user)).toMatchObject({ path: "/app/messages?conversation=conversation" });
  expect(conversation).toHaveBeenCalledWith({ _id: "internal", participants: "user" });
});
it("opens manually sent membership reminders in their authorized conversation", async () => {
  const conversation = vi.spyOn(Conversation, "findOne").mockReturnValue(lean({ publicId: "gym-thread" }));
  expect(await resolve({ event: "membership.expiring", entityId: "member-record", actionUrl: "/messages/gym-thread" }, user)).toMatchObject({ path: "/app/messages?conversation=gym-thread" });
  expect(conversation).toHaveBeenCalledWith({ publicId: "gym-thread", participants: "user" });
  conversation.mockReturnValue(lean(null));
  expect(await resolve({ event: "member.activation_invitation", actionUrl: "/messages/private-thread" }, user)).toMatchObject({ available: false });
});
it("keeps support tickets on the support activity screen", async () => {
  vi.spyOn(SupportTicket, "findOne").mockResolvedValue({ publicId: "ticket" } as never);
  expect(await resolve({ event: "support.updated", entityId: "ticket" }, user)).toMatchObject({ path: "/app/support?ticket=support-conversation" });
});
it("opens the exact booking in the profile bookings section", async () => {
  vi.spyOn(MemberProfile, "distinct").mockResolvedValue(["member"] as never);
  vi.spyOn(ClassBooking, "findOne").mockReturnValue({ populate: () => lean({ sessionId: "session" }) } as never);
  expect(await resolve({ event: "class.reminder", entityId: "507f1f77bcf86cd799439011" }, user)).toMatchObject({ path: "/app/profile?section=bookings&booking=507f1f77bcf86cd799439011" });
});
it("opens a review for its gym owner", async () => {
  vi.spyOn(Gym, "distinct").mockResolvedValue(["gym-a"] as never);
  vi.spyOn(Review, "findOne").mockReturnValue(lean({ gymId: "gym-a" }));
  vi.spyOn(Gym, "findOne").mockReturnValue(lean({ slug: "gym-a" }));
  expect(await resolve({ event: "review.created", entityId: "review" }, owner)).toMatchObject({ path: "/owner/gyms/gym-a#gym-reviews" });
});
it("does not silently show a payment for the wrong active gym", async () => {
  vi.spyOn(Payment, "findOne").mockReturnValue(lean({ gymId: "gym-b", publicId: "payment" }));
  expect(await resolve({ event: "payment.successful", entityId: "payment" }, owner)).toMatchObject({ available: false, explanation: expect.stringContaining("another gym") });
});
it("denies missing/deleted payment targets and unknown URLs", async () => {
  vi.spyOn(Payment, "findOne").mockReturnValue(lean(null));
  expect(await resolve({ event: "payment.failed", entityId: "missing" }, user)).toMatchObject({ available: false });
  expect(await resolve({ actionUrl: "https://evil.test" }, user)).toMatchObject({ available: false });
});
