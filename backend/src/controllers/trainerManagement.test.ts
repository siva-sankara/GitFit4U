import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { User } from "../models/User.js";
import { Trainer } from "../models/Engagement.js";
import { RoleAssignment, Session } from "../models/Auth.js";
import { TRAINER_DEFAULT_PERMISSIONS } from "../constants/domain.js";
import { saveTrainer } from "./memberManagementController.js";
import { writeAudit } from "../services/auditService.js";

vi.mock("../services/auditService.js", () => ({ writeAudit: vi.fn() }));

const session = {} as any;
const gymId = "gym-a";
const userId = "trainer-user";
const query = (value: unknown) =>
  ({ session: vi.fn().mockResolvedValue(value) }) as any;
let trainer: any;
let user: any;
const request = (body: object) =>
  ({
    method: "PATCH",
    params: { id: "trainer-public" },
    auth: { userId: "owner-user", gymId, role: "GYM_OWNER" },
    body,
  }) as any;
const response = () => {
  const res: any = { json: vi.fn() };
  res.status = vi.fn().mockReturnValue(res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  trainer = {
    _id: "trainer",
    publicId: "trainer-public",
    gymId,
    userId,
    status: "ACTIVE",
    save: vi.fn(),
  };
  user = {
    _id: userId,
    email: "trainer@example.com",
    roles: ["USER", "TRAINER"],
    activeRole: "TRAINER",
    status: "ACTIVE",
  };
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(
    async (callback: any) => callback(session),
  );
  vi.spyOn(Trainer, "findOne").mockReturnValue(query(trainer));
  vi.spyOn(User, "findById").mockReturnValue(query(user));
  vi.spyOn(User, "updateOne").mockResolvedValue({ matchedCount: 1 } as any);
  vi.spyOn(RoleAssignment, "findOneAndUpdate").mockResolvedValue({} as any);
  vi.spyOn(RoleAssignment, "exists").mockReturnValue(query(null));
  vi.spyOn(Session, "updateMany").mockResolvedValue({
    modifiedCount: 1,
  } as any);
});
afterEach(() => vi.restoreAllMocks());

it("removes the final trainer role, resets active role, and revokes only this gym's trainer sessions in the same transaction", async () => {
  user.roles.push("GYM_OWNER");
  await saveTrainer(request({ status: "INACTIVE" }), response());
  expect(trainer.save).toHaveBeenCalledWith({ session });
  expect(RoleAssignment.findOneAndUpdate).toHaveBeenCalledWith(
    { userId, gymId, role: "TRAINER" },
    { $set: { permissions: TRAINER_DEFAULT_PERMISSIONS, status: "REVOKED" } },
    { upsert: false, session, runValidators: true },
  );
  expect(RoleAssignment.exists).toHaveBeenCalledWith({
    userId,
    role: "TRAINER",
    status: "ACTIVE",
  });
  expect(User.updateOne).toHaveBeenCalledWith(
    { _id: userId },
    {
      $set: { roles: ["USER", "GYM_OWNER"], activeRole: "USER" },
      $inc: { version: 1 },
    },
    { session, runValidators: true },
  );
  expect(Session.updateMany).toHaveBeenCalledWith(
    { userId, activeGymId: gymId, activeRole: "TRAINER", revokedAt: null },
    {
      $set: {
        revokedAt: expect.any(Date),
        revokeReason: "TRAINER_STATUS_CHANGED",
      },
    },
    { session },
  );
});

it("preserves trainer access at other active gyms while still serializing cross-gym updates through the shared user", async () => {
  vi.mocked(RoleAssignment.exists).mockReturnValue(
    query({ _id: "other-gym-assignment" }),
  );
  await saveTrainer(request({ status: "ARCHIVED" }), response());
  expect(User.updateOne).toHaveBeenCalledWith(
    { _id: userId },
    {
      $set: { roles: ["USER", "TRAINER"], activeRole: "TRAINER" },
      $inc: { version: 1 },
    },
    { session, runValidators: true },
  );
  expect(Session.updateMany).toHaveBeenCalledWith(
    { userId, activeGymId: gymId, activeRole: "TRAINER", revokedAt: null },
    expect.any(Object),
    { session },
  );
});

it("reactivates a verified active trainer account without revoking its sessions or duplicating roles", async () => {
  trainer.status = "INACTIVE";
  user.roles = ["USER"];
  user.activeRole = "USER";
  await saveTrainer(request({ status: "ACTIVE" }), response());
  expect(RoleAssignment.findOneAndUpdate).toHaveBeenCalledWith(
    { userId, gymId, role: "TRAINER" },
    { $set: { permissions: TRAINER_DEFAULT_PERMISSIONS, status: "ACTIVE" } },
    { upsert: true, session, runValidators: true },
  );
  expect(User.updateOne).toHaveBeenCalledWith(
    { _id: userId },
    {
      $set: { roles: ["USER", "TRAINER"], activeRole: "USER" },
      $inc: { version: 1 },
    },
    { session, runValidators: true },
  );
  expect(Session.updateMany).not.toHaveBeenCalled();
});

it.each(["BLOCKED", "DISABLED", "PENDING_VERIFICATION"])(
  "rejects trainer activation for a %s linked account before changing access",
  async (status) => {
    trainer.status = "INACTIVE";
    user.status = status;
    await expect(
      saveTrainer(request({ status: "ACTIVE" }), response()),
    ).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
    expect(trainer.save).not.toHaveBeenCalled();
    expect(RoleAssignment.findOneAndUpdate).not.toHaveBeenCalled();
    expect(User.updateOne).not.toHaveBeenCalled();
    expect(Session.updateMany).not.toHaveBeenCalled();
    expect(writeAudit).not.toHaveBeenCalled();
  },
);

it("keeps a metadata-only edit inactive and can safely remove legacy trainer-only role sets", async () => {
  trainer.status = "INACTIVE";
  user.roles = ["TRAINER"];
  user.status = "BLOCKED";
  await saveTrainer(request({ name: "Updated trainer" }), response());
  expect(trainer.status).toBe("INACTIVE");
  expect(User.updateOne).toHaveBeenCalledWith(
    { _id: userId },
    { $set: { roles: ["USER"], activeRole: "USER" }, $inc: { version: 1 } },
    { session, runValidators: true },
  );
  expect(Session.updateMany).toHaveBeenCalled();
});

it("scopes trainer lookup to the authorized gym and rejects an unavailable tenant profile", async () => {
  vi.mocked(Trainer.findOne).mockReturnValue(query(null));
  await expect(
    saveTrainer(request({ status: "ACTIVE" }), response()),
  ).rejects.toMatchObject({ code: "TRAINER_NOT_FOUND" });
  expect(Trainer.findOne).toHaveBeenCalledWith({
    gymId,
    publicId: "trainer-public",
  });
  expect(User.updateOne).not.toHaveBeenCalled();
  expect(Session.updateMany).not.toHaveBeenCalled();
});

it("propagates session revocation failures out of the transaction rather than claiming success", async () => {
  vi.mocked(Session.updateMany).mockRejectedValue(
    new Error("session write failed"),
  );
  await expect(
    saveTrainer(request({ status: "ARCHIVED" }), response()),
  ).rejects.toThrow("session write failed");
  expect(writeAudit).not.toHaveBeenCalled();
});
