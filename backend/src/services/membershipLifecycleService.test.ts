import { describe, expect, it } from "vitest";
import { applyMembershipTransition } from "./membershipLifecycleService.js";
const day = 86400000;
const now = new Date("2026-09-20T10:00:00Z");
function membership() {
  return {
    status: "ACTIVE",
    startsAt: new Date("2026-09-01T10:00:00Z"),
    endsAt: new Date("2026-10-01T10:00:00Z"),
    renewalAt: new Date("2026-10-01T10:00:00Z"),
    planSnapshot: { freezeDaysAllowed: 10 },
    freezePeriods: [] as any[],
  };
}
describe("membership lifecycle rules", () => {
  it("returns unused freeze days on early reactivation and preserves the consumed days", () => {
    const member = membership();
    applyMembershipTransition(
      member,
      "freeze",
      { endsAt: new Date(now.getTime() + 7 * day) },
      now,
    );
    expect(member.endsAt.toISOString()).toBe("2026-10-08T10:00:00.000Z");
    applyMembershipTransition(
      member,
      "reactivate",
      {},
      new Date(now.getTime() + 2 * day),
    );
    expect(member.status).toBe("ACTIVE");
    expect(member.endsAt.toISOString()).toBe("2026-10-03T10:00:00.000Z");
    expect(member.freezePeriods[0].extendedDays).toBe(2);
    expect(member.freezePeriods[0].resumedAt).toEqual(
      new Date(now.getTime() + 2 * day),
    );
  });
  it("reactivates legacy freezes using their existing end-date extension", () => {
    const member = membership();
    member.status = "FROZEN";
    member.endsAt = new Date("2026-10-08T10:00:00Z");
    member.freezePeriods = [
      { startsAt: now, endsAt: new Date(now.getTime() + 7 * day) },
    ];
    applyMembershipTransition(
      member,
      "reactivate",
      {},
      new Date(now.getTime() + day),
    );
    expect(member.endsAt.toISOString()).toBe("2026-10-02T10:00:00.000Z");
  });
  it("does not extend dates a second time when a completed freeze resumes", () => {
    const member = membership();
    applyMembershipTransition(
      member,
      "freeze",
      { endsAt: new Date(now.getTime() + 3 * day) },
      now,
    );
    applyMembershipTransition(
      member,
      "activate",
      {},
      new Date(now.getTime() + 4 * day),
    );
    expect(member.endsAt.toISOString()).toBe("2026-10-04T10:00:00.000Z");
    expect(() =>
      applyMembershipTransition(
        member,
        "reactivate",
        {},
        new Date(now.getTime() + 4 * day),
      ),
    ).toThrow();
  });
  it("enforces total freeze allowance across separate periods", () => {
    const member = membership();
    member.freezePeriods = [
      { startsAt: new Date("2026-09-02"), endsAt: new Date("2026-09-10") },
    ];
    expect(() =>
      applyMembershipTransition(
        member,
        "freeze",
        { endsAt: new Date(now.getTime() + 3 * day) },
        now,
      ),
    ).toThrow(/2 freeze days/);
  });
  it("blocks reactivation of cancelled, expired, and unpaid memberships", () => {
    for (const status of ["CANCELLED", "EXPIRED", "PENDING_PAYMENT"]) {
      const member = membership();
      member.status = status;
      expect(() =>
        applyMembershipTransition(member, "activate", {}, now),
      ).toThrow();
    }
  });
  it("requires current membership and valid freeze dates", () => {
    const member = membership();
    member.endsAt = new Date(now.getTime() - day);
    expect(() =>
      applyMembershipTransition(
        member,
        "freeze",
        { endsAt: new Date(now.getTime() + day) },
        now,
      ),
    ).toThrow();
    expect(() =>
      applyMembershipTransition(
        membership(),
        "freeze",
        { endsAt: new Date("invalid") },
        now,
      ),
    ).toThrow();
  });
});
