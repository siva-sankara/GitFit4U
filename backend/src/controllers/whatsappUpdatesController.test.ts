import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("../services/auditService.js", () => ({ writeAudit: vi.fn() }));
import { Gym } from "../models/Gym.js";
import { getWhatsAppUpdates, updateWhatsAppUpdates } from "./whatsappUpdatesController.js";
afterEach(() => vi.restoreAllMocks());
beforeEach(() => vi.spyOn(Gym, "findOne").mockReturnValue({ select: () => ({ lean: async () => ({}) }) } as never));
const input = { enabled: true, type: "channel", displayName: "Gym A updates", inviteUrl: "https://whatsapp.com/channel/0029AbCd", description: "Timings and news" };
const req = (body = input) => ({ auth: { userId: "owner-a", gymId: "gym-a", role: "GYM_OWNER" }, body }) as any;
const res = () => { const result: any = { json: vi.fn() }; result.set = vi.fn(() => result); return result; };
it("stores the settings and audit actor/time with a version increase, bound to both owner and gym", async () => {
  const update = vi.spyOn(Gym, "findOneAndUpdate").mockReturnValue({ select: () => ({ lean: async () => ({ whatsappUpdates: input }) }) } as never);
  const response = res(); await updateWhatsAppUpdates(req(), response);
  expect(update).toHaveBeenCalledWith({ _id: "gym-a", ownerId: "owner-a", deletedAt: null, "whatsappUpdates.version": { $exists: false } }, expect.objectContaining({
    $set: expect.objectContaining({ "whatsappUpdates.inviteUrl": input.inviteUrl, "whatsappUpdates.updatedBy": "owner-a", "whatsappUpdates.updatedAt": expect.any(Date) }),
    $inc: { "whatsappUpdates.version": 1 },
  }), expect.any(Object));
  expect(response.set).toHaveBeenCalledWith("Cache-Control", "private, no-store");
});
it("does not let an owner edit another owner's gym even if their context contains that gym", async () => {
  vi.spyOn(Gym, "findOne").mockReturnValue({ select: () => ({ lean: async () => null }) } as never);
  vi.spyOn(Gym, "findOneAndUpdate").mockReturnValue({ select: () => ({ lean: async () => null }) } as never);
  await expect(updateWhatsAppUpdates(req(), res())).rejects.toMatchObject({ statusCode: 403 });
});
it("keeps old gyms disabled until configured and rejects foreign gym reads", async () => {
  const find = vi.spyOn(Gym, "findOne").mockReturnValue({ select: () => ({ lean: async () => ({}) }) } as never);
  const response = res(); await getWhatsAppUpdates(req(), response);
  expect(response.json).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ enabled: false, inviteUrl: "" }) }));
  find.mockReturnValue({ select: () => ({ lean: async () => null }) } as never);
  await expect(getWhatsAppUpdates(req(), res())).rejects.toMatchObject({ statusCode: 403 });
});
it("supports editing, disabling and removing the configuration without changing financial fields", async () => {
  const update = vi.spyOn(Gym, "findOneAndUpdate").mockReturnValue({ select: () => ({ lean: async () => ({ whatsappUpdates: input }) }) } as never);
  await updateWhatsAppUpdates(req({ ...input, enabled: false }), res());
  await updateWhatsAppUpdates(req({ ...input, enabled: false, inviteUrl: "", displayName: "", description: "" }), res());
  const changes = update.mock.calls.at(-1)?.[1] as any;
  expect(changes.$set["whatsappUpdates.inviteUrl"]).toBe("");
  expect(Object.keys(changes.$set).every(key => key.startsWith("whatsappUpdates."))).toBe(true);
});
