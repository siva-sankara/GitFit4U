import mongoose from "mongoose";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  userById: vi.fn(),
  userExists: vi.fn(),
  userUpdate: vi.fn(),
  identityExists: vi.fn(),
  identityUpdate: vi.fn(),
  sessions: vi.fn(),
  resetGrants: vi.fn(),
  roleUpdate: vi.fn(),
  roleExists: vi.fn(),
  gym: vi.fn(),
  gymUpdate: vi.fn(),
  memberUpdate: vi.fn(),
  memberExists: vi.fn(),
  trainer: vi.fn(),
  trainerUpdate: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("../models/User.js", () => ({
  User: {
    findOne: mocks.user,
    findById: mocks.userById,
    exists: mocks.userExists,
    updateOne: mocks.userUpdate,
  },
}));
vi.mock("../models/Auth.js", () => ({
  AuthIdentity: {
    exists: mocks.identityExists,
    updateMany: mocks.identityUpdate,
  },
  RoleAssignment: {
    findOneAndUpdate: mocks.roleUpdate,
    exists: mocks.roleExists,
  },
  Session: { updateMany: mocks.sessions },
  PasswordResetGrant: { updateMany: mocks.resetGrants },
}));
vi.mock("../models/Gym.js", () => ({
  Gym: { findOne: mocks.gym, findOneAndUpdate: mocks.gymUpdate },
}));
vi.mock("../models/Member.js", () => ({
  MemberProfile: {
    findOneAndUpdate: mocks.memberUpdate,
    exists: mocks.memberExists,
  },
}));
vi.mock("../models/Engagement.js", () => ({
  Trainer: { findOne: mocks.trainer, findOneAndUpdate: mocks.trainerUpdate },
  Notification: {},
}));
vi.mock("../models/Commerce.js", () => ({ MembershipPlan: {} }));
vi.mock("../models/Operations.js", () => ({ PlatformSettings: {} }));
vi.mock("../services/auditService.js", () => ({ writeAudit: mocks.audit }));
vi.mock("../services/membershipLifecycleService.js", () => ({
  transitionMembership: vi.fn(),
}));
vi.mock("../services/domainEventService.js", () => ({
  emitDomainEvent: vi.fn(),
}));
vi.mock("../services/gymProjectionService.js", () => ({
  refreshGymPrice: vi.fn(),
}));
import {
  accountUpdate,
  updateAccount,
  editGym,
  updateMember,
  updateTrainer,
  savePlan,
  assignRole,
} from "./adminManagementController.js";
const session = {} as any;
const query = (value: unknown) => ({
  session: vi.fn().mockResolvedValue(value),
});
const response = () => ({ json: vi.fn() }) as any;
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(mongoose.connection, "transaction").mockImplementation(
    async (callback: any) => callback(session),
  );
});
afterEach(() => vi.restoreAllMocks());
it("normalizes edited email identities and rejects mass-assigned administrator roles", () => {
  expect(accountUpdate.parse({ email: "  Member@Example.com " }).email).toBe(
    "member@example.com",
  );
  expect(() => accountUpdate.parse({ roles: ["ADMIN"] })).toThrow();
});
it("rejects moving an existing plan between gyms instead of silently ignoring the change", async () => {
  await expect(
    savePlan(
      { params: { id: "existing-plan" }, body: { gymId: "other-gym" } } as any,
      response(),
    ),
  ).rejects.toMatchObject({ code: "PLAN_GYM_IMMUTABLE" });
});
it("allows an administrator name edit with unchanged contacts without revoking their session", async () => {
  const user = {
    _id: "admin",
    publicId: "admin-public",
    roles: ["USER", "ADMIN"],
    status: "ACTIVE",
    email: "admin@example.com",
    phone: "+919876543210",
    save: vi.fn(),
  };
  mocks.user.mockReturnValue(query(user));
  await updateAccount(
    {
      params: { id: "admin-public" },
      body: {
        name: "Updated Name",
        email: "ADMIN@EXAMPLE.COM",
        phone: user.phone,
        status: "ACTIVE",
      },
    } as any,
    response(),
  );
  expect(user.save).toHaveBeenCalledWith({ session });
  expect(mocks.identityUpdate).not.toHaveBeenCalled();
  expect(mocks.sessions).not.toHaveBeenCalled();
  expect(mocks.resetGrants).not.toHaveBeenCalled();
});
it("updates a password identity to the canonical email and revokes old sessions", async () => {
  mocks.user.mockReturnValue(
    query({
      _id: "member",
      publicId: "member-public",
      roles: ["USER"],
      status: "ACTIVE",
      email: "old@example.com",
      save: vi.fn(),
    }),
  );
  mocks.userExists.mockReturnValue(query(null));
  mocks.identityExists.mockReturnValue(query(null));
  await updateAccount(
    {
      params: { id: "member-public" },
      body: { email: "NEW@Example.com" },
    } as any,
    response(),
  );
  expect(mocks.identityUpdate).toHaveBeenCalledWith(
    { userId: "member", provider: "PASSWORD" },
    { $set: { providerSubject: "new@example.com" } },
    { session },
  );
  expect(mocks.sessions.mock.calls[0][0]).toEqual({
    userId: "member",
    revokedAt: null,
  });
  expect(mocks.resetGrants).toHaveBeenCalledWith(
    { userId: "member", consumedAt: null },
    { $set: { consumedAt: expect.any(Date) } },
    { session },
  );
});
it.each(["DISABLED", "BLOCKED", "ACTIVE"])(
  "consumes all outstanding reset grants when account status changes to %s",
  async (status) => {
    mocks.user.mockReturnValue(
      query({
        _id: "member",
        publicId: "member-public",
        roles: ["USER"],
        status: status === "ACTIVE" ? "DISABLED" : "ACTIVE",
        save: vi.fn(),
      }),
    );
    await updateAccount(
      { params: { id: "member-public" }, body: { status } } as any,
      response(),
    );
    expect(mocks.resetGrants).toHaveBeenCalledWith(
      { userId: "member", consumedAt: null },
      { $set: { consumedAt: expect.any(Date) } },
      { session },
    );
  },
);
it("fails the account-change transaction if recovery grants cannot be invalidated", async () => {
  mocks.user.mockReturnValue(
    query({
      _id: "member",
      publicId: "member-public",
      roles: ["USER"],
      status: "ACTIVE",
      save: vi.fn(),
    }),
  );
  const failure = new Error("Grant invalidation failed");
  mocks.resetGrants.mockRejectedValue(failure);
  const res = response();
  await expect(
    updateAccount(
      { params: { id: "member-public" }, body: { status: "BLOCKED" } } as any,
      res,
    ),
  ).rejects.toBe(failure);
  expect(mocks.audit).not.toHaveBeenCalled();
  expect(res.json).not.toHaveBeenCalled();
});
it.each([
  { status: "DISABLED" },
  { status: "BLOCKED" },
  { phone: "+919876543211" },
])(
  "protects the administrator's access and identities from generic account editing: %j",
  async (body) => {
    const user = {
      _id: "only-admin",
      publicId: "admin",
      roles: ["USER", "ADMIN"],
      status: "ACTIVE",
      phone: "+919876543210",
      save: vi.fn(),
    };
    mocks.user.mockReturnValue(query(user));
    await expect(
      updateAccount({ params: { id: "admin" }, body } as any, response()),
    ).rejects.toMatchObject({ code: "ADMIN_ACCOUNT_PROTECTED" });
    expect(user.save).not.toHaveBeenCalled();
    expect(mocks.sessions).not.toHaveBeenCalled();
    expect(mocks.resetGrants).not.toHaveBeenCalled();
  },
);
it.each(["PENDING_VERIFICATION", "DISABLED", "BLOCKED"])(
  "does not enable tenant roles for an account with status %s",
  async (status) => {
    const user = {
      _id: "user",
      publicId: "user-public",
      roles: ["USER"],
      status,
      save: vi.fn(),
    };
    mocks.user.mockReturnValue(query(user));
    mocks.gym.mockReturnValue(
      query({
        _id: "gym",
        status: "ACTIVE",
        platformSubscriptionStatus: "ACTIVE",
      }),
    );
    await expect(
      assignRole(
        {
          params: { id: "user-public" },
          body: { role: "TRAINER", gymId: "gym-public", active: true },
        } as any,
        response(),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });
    expect(mocks.roleUpdate).not.toHaveBeenCalled();
    expect(mocks.trainerUpdate).not.toHaveBeenCalled();
    expect(user.save).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  "revokes a blocked trainer's gym access while preserving other active gym assignments when present=%s",
  async (remaining) => {
    const user = {
      _id: "user",
      publicId: "user-public",
      name: "Trainer",
      roles: ["USER", "TRAINER"],
      activeRole: "TRAINER",
      status: "BLOCKED",
      save: vi.fn(),
    };
    mocks.user.mockReturnValue(query(user));
    mocks.gym.mockReturnValue(
      query({
        _id: "gym",
        status: "ACTIVE",
        platformSubscriptionStatus: "ACTIVE",
      }),
    );
    mocks.roleExists.mockReturnValue(
      query(remaining ? { _id: "other-gym-assignment" } : null),
    );
    await assignRole(
      {
        params: { id: "user-public" },
        body: { role: "TRAINER", gymId: "gym-public", active: false },
      } as any,
      response(),
    );
    expect(user.roles.includes("TRAINER")).toBe(remaining);
    expect(user.activeRole).toBe(remaining ? "TRAINER" : "USER");
    expect(mocks.trainerUpdate).toHaveBeenCalledWith(
      { userId: "user", gymId: "gym" },
      expect.objectContaining({
        $set: { name: "Trainer", status: "INACTIVE" },
      }),
      { upsert: false, session },
    );
    expect(mocks.sessions).toHaveBeenCalledWith(
      {
        userId: "user",
        activeRole: "TRAINER",
        activeGymId: "gym",
        revokedAt: null,
      },
      expect.any(Object),
      { session },
    );
    expect(mocks.userUpdate).toHaveBeenCalledWith(
      { _id: "user" },
      {
        $set: {
          roles: remaining ? ["USER", "TRAINER"] : ["USER"],
          activeRole: remaining ? "TRAINER" : "USER",
        },
        $inc: { version: 1 },
      },
      { session, runValidators: true },
    );
  },
);
it.each(["PENDING_VERIFICATION", "DISABLED", "BLOCKED"])(
  "does not activate a trainer whose linked account is %s",
  async (status) => {
    const trainer = {
      publicId: "trainer-public",
      userId: "user",
      gymId: "gym",
      save: vi.fn(),
    };
    mocks.trainer.mockReturnValue(query(trainer));
    mocks.gym.mockReturnValue(query({ _id: "gym" }));
    mocks.userById.mockReturnValue(query({ _id: "user", status }));
    await expect(
      updateTrainer(
        {
          params: { id: "trainer-public" },
          body: { name: "Trainer Name", status: "ACTIVE" },
        } as any,
        response(),
      ),
    ).rejects.toMatchObject({ code: "ACCOUNT_NOT_ACTIVE" });
    expect(trainer.save).not.toHaveBeenCalled();
    expect(mocks.roleUpdate).not.toHaveBeenCalled();
  },
);
it("keeps existing gym address and contact siblings when editing a nested field", async () => {
  mocks.gymUpdate.mockResolvedValue({ publicId: "gym-public" });
  await editGym(
    {
      params: { id: "gym-public" },
      body: {
        address: { city: "Pune" },
        contact: { phone: "+919876543210" },
        logoUrl: "https://untrusted.test/logo.png",
      },
    } as any,
    response(),
  );
  expect(mocks.gymUpdate.mock.calls[0][1]).toEqual({
    $set: { "address.city": "Pune", "contact.phone": "+919876543210" },
  });
});
it("does not approve a pending gym join request through the generic member status editor", async () => {
  mocks.memberUpdate.mockResolvedValue(null);
  mocks.memberExists.mockResolvedValue({ _id: "pending" });
  await expect(
    updateMember(
      { params: { id: "pending" }, body: { status: "ACTIVE" } } as any,
      response(),
    ),
  ).rejects.toMatchObject({ code: "JOIN_REVIEW_REQUIRED" });
  expect(mocks.memberUpdate.mock.calls[0][0]).toEqual({
    publicId: "pending",
    status: { $ne: "JOIN_REQUESTED" },
  });
});
it("reactivates a trainer account and gym assignment together", async () => {
  const trainer = {
    _id: "trainer",
    publicId: "trainer-public",
    userId: "user",
    gymId: "gym",
    save: vi.fn(),
  };
  const user = {
    _id: "user",
    roles: ["USER"],
    activeRole: "USER",
    status: "ACTIVE",
    save: vi.fn(),
  };
  mocks.trainer.mockReturnValue(query(trainer));
  mocks.gym.mockReturnValue(query({ _id: "gym" }));
  mocks.userById.mockReturnValue(query(user));
  await updateTrainer(
    {
      params: { id: trainer.publicId },
      body: { name: "Trainer Name", status: "ACTIVE" },
    } as any,
    response(),
  );
  expect(user.roles).toContain("TRAINER");
  expect(mocks.roleUpdate.mock.calls[0][0]).toEqual({
    userId: "user",
    gymId: "gym",
    role: "TRAINER",
  });
  expect(mocks.roleUpdate.mock.calls[0][1].$set.status).toBe("ACTIVE");
  expect(mocks.userUpdate).toHaveBeenCalledWith(
    { _id: "user" },
    {
      $set: { roles: ["USER", "TRAINER"], activeRole: "USER" },
      $inc: { version: 1 },
    },
    { session, runValidators: true },
  );
  expect(trainer.save).toHaveBeenCalledWith({ session });
});
it("does not reactivate a trainer belonging to an inactive gym", async () => {
  const trainer = {
    publicId: "trainer-public",
    userId: "user",
    gymId: "gym",
    save: vi.fn(),
  };
  mocks.trainer.mockReturnValue(query(trainer));
  mocks.gym.mockReturnValue(query(null));
  await expect(
    updateTrainer(
      {
        params: { id: trainer.publicId },
        body: { name: "Trainer Name", status: "ACTIVE" },
      } as any,
      response(),
    ),
  ).rejects.toMatchObject({ code: "GYM_INACTIVE" });
  expect(trainer.save).not.toHaveBeenCalled();
  expect(mocks.roleUpdate).not.toHaveBeenCalled();
});
it("deactivates a legacy standalone trainer without issuing an unscoped user or role write", async () => {
  mocks.trainer.mockReturnValue(
    query({ publicId: "legacy", gymId: "gym", save: vi.fn() }),
  );
  await updateTrainer(
    {
      params: { id: "legacy" },
      body: { name: "Legacy Trainer", status: "INACTIVE" },
    } as any,
    response(),
  );
  expect(mocks.userById).not.toHaveBeenCalled();
  expect(mocks.roleUpdate).not.toHaveBeenCalled();
  expect(mocks.sessions).not.toHaveBeenCalled();
});
