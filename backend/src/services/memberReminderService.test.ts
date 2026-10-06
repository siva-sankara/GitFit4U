import { describe, expect, it } from "vitest";
import {
  buildMemberReminderMessage,
  memberReminderWhatsAppUrl,
  selectMemberReminderType,
} from "./memberReminderService.js";

describe("member WhatsApp reminders", () => {
  it("selects activation, payment, renewal and direct-access follow-up from current state", () => {
    expect(
      selectMemberReminderType({ invitation: { status: "PENDING" } }),
    ).toBe("activation_invitation");
    expect(
      selectMemberReminderType(
        {},
        { status: "PENDING_PAYMENT", renewalAt: new Date() },
        null,
      ),
    ).toBe("payment_reminder");
    expect(
      selectMemberReminderType(
        {},
        { status: "ACTIVE", renewalAt: new Date() },
        { status: "CAPTURED" },
      ),
    ).toBe("renewal_reminder");
    expect(selectMemberReminderType({ directAccess: true }, null, null)).toBe(
      "general_followup",
    );
  });

  it("builds server-owned copy with the secure activation link and renewal data", () => {
    expect(
      buildMemberReminderMessage({
        type: "activation_invitation",
        memberName: "Mark",
        gymName: "Gym Two",
        activationLink: "https://app.example/activate-account#token=secret",
        gymOwnerPhone: "+91 90000 00000",
      }),
    ).toContain(
      "verify and activate your account using this link: https://app.example/activate-account#token=secret",
    );
    const renewal = buildMemberReminderMessage({
      type: "renewal_reminder",
      memberName: "Karthik",
      gymName: "Gym Two",
      planName: "Monthly",
      renewalDate: "2026-12-31T12:00:00.000Z",
      timezone: "Asia/Kolkata",
    });
    expect(renewal).toContain("membership plan Monthly");
    expect(renewal).toContain("31 Dec 2026");
  });

  it("normalizes Indian fallback numbers and safely encodes the prefilled message", () => {
    expect(memberReminderWhatsAppUrl("(98765) 43210", "Hi Mark & welcome"))
      .toBe("https://wa.me/919876543210?text=Hi%20Mark%20%26%20welcome");
  });
});
