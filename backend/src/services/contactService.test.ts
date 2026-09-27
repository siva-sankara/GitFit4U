import mongoose from "mongoose";
import type { Request } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { User } from "../models/User.js";
import { RoleAssignment } from "../models/Auth.js";
import { MemberProfile } from "../models/Member.js";
import { Trainer } from "../models/Engagement.js";
import { contactPipeline, searchContacts, assertAllowedParticipants, conversationPeople } from "./contactService.js";

const actor = new mongoose.Types.ObjectId(), gym = new mongoose.Types.ObjectId(), otherGym = new mongoose.Types.ObjectId(), person = new mongoose.Types.ObjectId();
function req(role = "GYM_OWNER", permissions = ["member:read"]) {
  return { auth: { userId: String(actor), gymId: String(gym), role, permissions } } as Request;
}
afterEach(() => vi.restoreAllMocks());
describe("scoped contact directory", () => {
  it("filters the active tenant before paginating and searches phone only with permission", async () => {
    vi.spyOn(RoleAssignment, "exists").mockResolvedValue({ _id: actor });
    const aggregate = vi.spyOn(User, "aggregate").mockReturnValue({ option: vi.fn().mockResolvedValue([{ data: [], count: [{ total: 71 }] }]) } as never);
    expect(await searchContacts(req(), { q: "555", page: 3, limit: 20 })).toEqual({ data: [], total: 71 });
    const stages = aggregate.mock.calls[0][0] as any[];
    const membership = stages.find(stage => stage.$lookup?.as === "contactMemberships");
    expect(membership.$lookup.pipeline[0].$match.gymId.$in.map(String)).toEqual([String(gym)]);
    expect(stages.at(-1).$facet.data).toEqual([{ $sort: { name: 1, _id: 1 } }, { $skip: 40 }, { $limit: 20 }]);
    expect(stages.at(-2).$project.phone).toBe(1);
    expect(stages.find(stage => stage.$match?.$or?.some((entry: any) => entry.phone))).toBeTruthy();
  });
  it("ignores a member's stale staff gym and never exposes or searches personal phone/email", async () => {
    vi.spyOn(MemberProfile, "distinct").mockResolvedValue([otherGym]);
    const stages = await contactPipeline(req("USER", []), { q: "Jane" });
    const assignments = stages.find(stage => stage.$lookup?.as === "contactAssignments");
    expect(assignments.$lookup.pipeline[0].$match.gymId.$in).toEqual([otherGym]);
    expect(stages.some(stage => stage.$lookup?.as === "contactMemberships")).toBe(false);
    expect(stages.at(-1).$project.phone).toBeUndefined();
    expect(stages.at(-1).$project.email).toBeUndefined();
    expect(stages.at(-2).$match.$or).toHaveLength(1);
  });
  it("rejects a removed owner assignment before any directory query", async () => {
    vi.spyOn(RoleAssignment, "exists").mockResolvedValue(null);
    const aggregate = vi.spyOn(User, "aggregate");
    await expect(searchContacts(req())).rejects.toMatchObject({ statusCode: 403 });
    expect(aggregate).not.toHaveBeenCalled();
  });
  it("limits trainers to explicitly assigned members while retaining gym staff contacts", async () => {
    vi.spyOn(RoleAssignment, "exists").mockResolvedValue({ _id: actor });
    vi.spyOn(Trainer, "findOne").mockReturnValue({ select: () => ({ lean: async () => ({ _id: person }) }) } as never);
    const stages = await contactPipeline(req("TRAINER"));
    const membership = stages.find(stage => stage.$lookup?.as === "contactMemberships").$lookup.pipeline;
    expect(membership[1].$lookup.pipeline[0].$match.trainerId).toEqual(person);
    expect(membership[2].$match.$or[0]).toEqual({ assignedTrainerId: person });
  });
  it("allows admins to search gym names without returning gym internals or unrestricted user fields", async () => {
    const stages = await contactPipeline(req("ADMIN"), { q: "Gym [A]" });
    const gymLookup = stages.find(stage => stage.$lookup?.as === "matchingGyms").$lookup;
    expect(gymLookup.pipeline[0].$match.name.test("Gym [A]")).toBe(true);
    expect(gymLookup.pipeline[0].$match.name.test("Gym A")).toBe(false);
    expect(stages.at(-1).$project.roles).toBeUndefined();
  });
  it("authorizes exact IDs independently of directory page limits and denies foreign accounts", async () => {
    vi.spyOn(RoleAssignment, "exists").mockResolvedValue({ _id: actor });
    const option = vi.fn().mockResolvedValue([{ _id: person }]);
    const aggregate = vi.spyOn(User, "aggregate").mockReturnValue({ option } as never);
    await expect(assertAllowedParticipants(req(), [String(person), String(person)])).resolves.toBeUndefined();
    expect((aggregate.mock.calls[0][0] as any[])[0].$match._id.$in.map(String)).toEqual([String(person)]);
    option.mockResolvedValueOnce([]);
    await expect(assertAllowedParticipants(req(), [String(person)])).rejects.toMatchObject({ code: "PARTICIPANT_FORBIDDEN" });
  });
  it("removes injected phones from conversation serialization for members and former tenant contacts", async () => {
    const row = { _id: person, name: "Jane", phone: "+919999999999", email: "private@example.com" };
    expect((await conversationPeople(req("USER", []), [row]))[0]).not.toHaveProperty("phone");
    vi.spyOn(RoleAssignment, "exists").mockResolvedValue({ _id: actor });
    vi.spyOn(User, "aggregate").mockReturnValue({ option: vi.fn().mockResolvedValue([]) } as never);
    expect((await conversationPeople(req(), [row]))[0]).not.toHaveProperty("phone");
  });
});
