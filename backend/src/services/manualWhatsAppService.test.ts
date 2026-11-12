import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { Gym } from "../models/Gym.js";
import { MemberProfile } from "../models/Member.js";
import { messagingGym, messagingMembers, whatsappGroupInput } from "./manualWhatsAppService.js";
import { getWhatsAppGroup, updateWhatsAppGroup } from "../controllers/manualWhatsAppController.js";
import { manualWhatsAppChatUrl, normalizeWhatsAppRecipient, whatsappChatUrl } from "../utils/whatsappDeepLink.js";

const auth = { userId: "owner-a", gymId: "gym-a", role: "GYM_OWNER", permissions: ["member:read"], sessionId: "session" } as any;
function chain(value: unknown) {
  const query: any = { lean: vi.fn().mockResolvedValue(value) };
  for (const method of ["select", "populate", "sort", "skip", "limit"]) query[method] = vi.fn().mockReturnValue(query);
  return query;
}
beforeEach(() => vi.spyOn(Gym, "findOne").mockReturnValue(chain({ name: "Gym A", ownerId: { name: "Owner A" } })));
afterEach(() => vi.restoreAllMocks());

it.each(["9876543210", "09876543210", "91 98765 43210", "+91 (98765) 43210"])("reuses Indian normalization: %s", phone => {
  expect(manualWhatsAppChatUrl(phone)).toBe("https://wa.me/919876543210");
  expect(normalizeWhatsAppRecipient(phone)).toBe("919876543210");
});
it.each(["", "123", "0000000000", "12345678", "call9876543210", "9876543210,9988776655", "+09876543210", "9876543210 ext 1"])("rejects missing, malformed or ambiguous phones: %s", phone => {
  expect(manualWhatsAppChatUrl(phone)).toBeNull();
});
it("respects explicit international numbers and encodes the existing reminder URL", () => {
  expect(manualWhatsAppChatUrl("+44 20 7946 0958")).toBe("https://wa.me/442079460958");
  expect(manualWhatsAppChatUrl("+65 6123 4567")).toBe("https://wa.me/6561234567");
  const message = "Hi 💪\n₹100 & ? #";
  expect(whatsappChatUrl("9876543210", message)).toBe(`https://wa.me/919876543210?text=${encodeURIComponent(message)}`);
});
it.each([
  "http://chat.whatsapp.com/ABCDEFGHIJKL", "https://chat.whatsapp.com.evil.test/ABCDEFGHIJKL",
  "https://evil.test/chat.whatsapp.com/ABCDEFGHIJKL", "https://chat.whatsapp.com/", "javascript:alert(1)",
  "https://user@chat.whatsapp.com/ABCDEFGHIJKL", "https://chat.whatsapp.com/ABCDEFGHIJKL?redirect=evil",
])("rejects unsafe group links: %s", inviteLink => {
  expect(whatsappGroupInput.safeParse({ name: "Members", inviteLink }).success).toBe(false);
});
it("accepts a group invite, permits removal and rejects injected properties", () => {
  expect(whatsappGroupInput.parse({ name: " Members ", inviteLink: "https://chat.whatsapp.com/ABCDEFGHIJKL" }).name).toBe("Members");
  expect(whatsappGroupInput.parse({ name: "", inviteLink: "" })).toEqual({ name: "", inviteLink: "" });
  expect(whatsappGroupInput.safeParse({ name: "Members", inviteLink: "" }).success).toBe(false);
  expect(whatsappGroupInput.safeParse({ name: "", inviteLink: "", gymId: "other-gym" }).success).toBe(false);
  expect(Gym.schema.path("whatsappGroup").options.select).toBe(false);
});
it("checks real ownership in addition to the authenticated gym context", async () => {
  await messagingGym(auth);
  expect(Gym.findOne).toHaveBeenCalledWith({ _id: "gym-a", ownerId: "owner-a", deletedAt: null });
  vi.mocked(Gym.findOne).mockReturnValue(chain(null));
  await expect(messagingGym({ ...auth, gymId: "gym-b" })).rejects.toMatchObject({ statusCode: 403 });
  await expect(messagingGym({ ...auth, role: "GYM_STAFF" })).rejects.toMatchObject({ statusCode: 403 });
});
it("stores group settings only for the authorized owner and ignores query tenant IDs", async () => {
  vi.spyOn(Gym, "updateOne").mockResolvedValue({ matchedCount: 1 } as any);
  const group = { name: "Our members", inviteLink: "https://chat.whatsapp.com/ABCDEFGHIJKL" };
  const res = { json: vi.fn() } as any;
  await updateWhatsAppGroup({ auth, query: { gymId: "gym-b" }, body: group } as any, res);
  expect(Gym.updateOne).toHaveBeenCalledWith({ _id: "gym-a", ownerId: "owner-a", deletedAt: null }, { $set: { whatsappGroup: group } }, { runValidators: true });
  expect(res.json).toHaveBeenCalledWith({ success: true, data: group });
  vi.mocked(Gym.findOne).mockReturnValue(chain(null));
  await expect(getWhatsAppGroup({ auth: { ...auth, gymId: "gym-b" } } as any, res)).rejects.toMatchObject({ statusCode: 403 });
});
it("returns minimal scoped data and preserves pending-account privacy", async () => {
  const query = chain([
    { publicId: "member-a", status: "ACTIVE", invitation: { status: "PENDING" }, contact: { name: "Gym-entered name" }, userId: { name: "Private account name", phone: "+919876543210" }, emergencyContact: { phone: "private" } },
    { publicId: "member-b", status: "ACTIVE", contact: { name: "Rahul", phone: "9876543210" }, currentSubscriptionId: { _id: "private-id", status: "ACTIVE", startsAt: "2026-01-01", endsAt: "2026-12-01", planSnapshot: { name: "Gold", priceMinor: 9999 }, paymentToken: "private" } },
  ]);
  vi.spyOn(MemberProfile, "find").mockReturnValue(query);
  const result = await messagingMembers("gym-a", { gymId: "injected" }, { joinedAt: -1 }, 25, 25);
  expect(MemberProfile.find).toHaveBeenCalledWith({ gymId: "gym-a", isDeleted: { $ne: true } });
  expect(query.skip).toHaveBeenCalledWith(25);
  expect(query.limit).toHaveBeenCalledWith(25);
  expect(query.populate).toHaveBeenCalledWith(expect.objectContaining({ match: { gymId: "gym-a", type: "GYM_MEMBERSHIP" } }));
  expect(result[0]).toMatchObject({ name: "Gym-entered name", phone: "", chatUrl: null });
  expect(result[1]).toMatchObject({ name: "Rahul", chatUrl: "https://wa.me/919876543210", renewalAmount: null });
  expect(JSON.stringify(result)).not.toMatch(/private|priceMinor|emergencyContact|userId/i);
});
