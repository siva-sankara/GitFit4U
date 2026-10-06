import mongoose from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberProfile } from "../models/Member.js";
import { Subscription } from "../models/Commerce.js";
vi.mock("../services/auditService.js", () => ({ writeAudit: vi.fn() }));
import { deleteMember, offlinePlanQuote, memberInputDate } from "./memberManagementController.js";
import {
  ownerMemberCreateInput,
  ownerTrainerInput,
  ownerMemberUpdateInput,
} from "../routes/memberManagementSchemas.js";
afterEach(() => vi.restoreAllMocks());
describe("owner member creation contract", () => {
  it("interprets calendar dates in the gym timezone and preserves legacy explicit instants", () => {
    expect(memberInputDate("2026-09-27", "America/New_York").toISOString()).toBe("2026-09-27T04:00:00.000Z");
    expect(memberInputDate("2026-09-27", "Asia/Kolkata").toISOString()).toBe("2026-09-26T18:30:00.000Z");
    const legacy = new Date("2026-09-27T10:15:00Z");
    expect(memberInputDate(legacy, "America/New_York")).toBe(legacy);
    const result = offlinePlanQuote({ priceMinor: 100, durationDays: 1 }, memberInputDate("2026-11-01", "America/New_York"), "America/New_York");
    expect(result.endsAt.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
  it("accepts date-only entry without coercing it to UTC and rejects invalid dates", () => {
    const body = { name: "Member One", phone: "+919876543210", planId: "gold", startsAt: "2026-09-27", payment: { amountMinor: 100, method: "CASH", paidAt: "2026-09-27" } };
    expect(ownerMemberCreateInput.parse(body).startsAt).toBe("2026-09-27");
    expect(ownerMemberCreateInput.safeParse({ ...body, startsAt: "2026-02-30" }).success).toBe(false);
    expect(ownerMemberCreateInput.parse({ ...body, startsAt: "2026-09-27T00:00:00Z" }).startsAt).toBeInstanceOf(Date);
  });
  it("accepts authorized image references/removal but rejects new arbitrary avatar URLs", () => {
    expect(ownerMemberUpdateInput.parse({ avatarAttachmentId: null })).toEqual({ avatarAttachmentId: null });
    expect(ownerMemberUpdateInput.safeParse({ avatarUrl: "https://untrusted.test/photo.jpg" }).success).toBe(false);
  });
  it("calculates tax after discount and derives membership end from plan duration", () => {
    const result = offlinePlanQuote(
      {
        priceMinor: 200000,
        discountMinor: 20000,
        taxRateBasisPoints: 1800,
        durationDays: 30,
      },
      new Date("2026-09-01T00:00:00Z"),
    );
    expect(result.totalMinor).toBe(212400);
    expect(result.endsAt.toISOString()).toBe("2026-10-01T00:00:00.000Z");
  });
  it("requires a real selected plan and offline payment details", () => {
    expect(
      ownerMemberCreateInput.safeParse({
        name: "Member Name",
        email: "member@example.com",
      }).success,
    ).toBe(false);
    expect(
      ownerMemberCreateInput.safeParse({
        name: "Member Name",
        phone: "bad",
        planId: "plan",
        startsAt: new Date(),
        payment: { amountMinor: 100, method: "RAZORPAY", paidAt: new Date() },
      }).success,
    ).toBe(false);
  });
  it("rejects invalid trainer contacts and backwards availability", () => {
    expect(
      ownerTrainerInput.safeParse({
        name: "Trainer Name",
        email: "invalid",
        phone: "abc",
      }).success,
    ).toBe(false);
    expect(
      ownerTrainerInput.safeParse({
        name: "Trainer Name",
        email: "trainer@example.com",
        availability: [{ day: 1, from: "18:00", to: "09:00" }],
      }).success,
    ).toBe(false);
  });
});

describe("owner member removal", () => {
  it("soft deletes only a deactivated tenant member and keeps historical records", async () => {
    const member: any = {
      publicId: "member-public",
      status: "INACTIVE",
      directAccess: false,
      currentSubscriptionId: null,
      save: vi.fn(),
    };
    vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (work: any) => work({}));
    vi.spyOn(MemberProfile, "findOne").mockReturnValue({ session: vi.fn().mockResolvedValue(member) } as any);
    vi.spyOn(Subscription, "exists").mockReturnValue({ session: vi.fn().mockResolvedValue(false) } as any);
    const req: any = {
      auth: { gymId: "507f1f77bcf86cd799439012", userId: "507f1f77bcf86cd799439011" },
      params: { id: "member-public" },
      requestId: "request-id",
      header: vi.fn(),
    };
    const res: any = { json: vi.fn() };
    await deleteMember(req, res);
    expect(member.status).toBe("ARCHIVED");
    expect(member.isDeleted).toBe(true);
    expect(member.deletedAt).toBeInstanceOf(Date);
    expect(member.save).toHaveBeenCalledWith({ session: {} });
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: expect.objectContaining({ publicId: "member-public" }),
    });
  });

  it("refuses to delete an active member", async () => {
    vi.spyOn(mongoose.connection, "transaction").mockImplementation(async (work: any) => work({}));
    vi.spyOn(MemberProfile, "findOne").mockReturnValue({
      session: vi.fn().mockResolvedValue({ status: "ACTIVE" }),
    } as any);
    const req: any = {
      auth: { gymId: "507f1f77bcf86cd799439012", userId: "507f1f77bcf86cd799439011" },
      params: { id: "member-public" },
    };
    await expect(deleteMember(req, { json: vi.fn() } as any)).rejects.toMatchObject({
      code: "MEMBER_DEACTIVATION_REQUIRED",
      statusCode: 409,
    });
  });
});
