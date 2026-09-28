import { afterEach, expect, it, vi } from "vitest";
import { MemberProfile } from "../models/Member.js";
import { redactPendingAccountRows } from "./tenantAccountPrivacy.js";
afterEach(() => vi.restoreAllMocks());
it("redacts pending account details through owner payment/subscription lists using gym-provided names only", async () => {
  const find = vi.spyOn(MemberProfile, "find").mockReturnValue({ select: () => ({ lean: async () => [{ userId: "invited", contact: { name: "Gym-entered name" } }] }) } as any);
  const data = await redactPendingAccountRows([{ payerId: { _id: "invited", name: "Private name", email: "private@example.invalid", phone: "private-phone" } }, { payerId: { _id: "accepted", name: "Accepted member" } }], "gym-a", "payerId");
  expect(find).toHaveBeenCalledWith(expect.objectContaining({ gymId: "gym-a", "invitation.status": "PENDING" }));
  expect(data[0].payerId).toEqual({ _id: "invited", name: "Gym-entered name", status: "PENDING_VERIFICATION" });
  expect(data[1].payerId.name).toBe("Accepted member");
});
