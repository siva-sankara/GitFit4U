import { afterEach, describe, expect, it, vi } from "vitest";
import { Gym } from "../models/Gym.js";
import { assertTenantMediaAccess } from "./mediaAccessService.js";
afterEach(() => vi.restoreAllMocks());
const req = (permissions: string[] = ["member:write"]) => ({ auth: { userId: "owner", gymId: "gym-a", permissions } }) as any;
describe("tenant media authorization", () => {
  it("checks member management permission, active context and live gym status", async () => {
    const exists = vi.spyOn(Gym, "exists").mockResolvedValue({ _id: "gym-a" } as any);
    await assertTenantMediaAccess(req(), "MEMBER_AVATAR", "gym-a");
    expect(exists).toHaveBeenCalledWith({ _id: "gym-a", deletedAt: null, status: { $nin: ["SUSPENDED", "ARCHIVED"] } });
  });
  it.each([[[], "gym-a"], [["member:write"], "gym-b"]])("rejects missing permission or another gym", async (permissions, gymId) => {
    await expect(assertTenantMediaAccess(req(permissions as string[]), "MEMBER_AVATAR", gymId)).rejects.toMatchObject({ statusCode: 403 });
  });
  it("rejects a gym that has become read-only after upload initiation", async () => {
    vi.spyOn(Gym, "exists").mockResolvedValue(null);
    await expect(assertTenantMediaAccess(req(), "MEMBER_AVATAR", "gym-a")).rejects.toMatchObject({ code: "GYM_READ_ONLY" });
  });
  it("keeps personal image uploads independent of tenant context", async () => {
    const exists = vi.spyOn(Gym, "exists");
    await assertTenantMediaAccess(req([]), "AVATAR");
    expect(exists).not.toHaveBeenCalled();
  });
});
