// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import {
  gymDate,
  MembershipStatusDot,
  membershipPresentation,
} from "./MembershipStatusDot";
const timezone = "Asia/Kolkata";
const now = new Date("2026-09-26T20:00:00Z");
const member = {
  status: "ACTIVE",
  currentSubscriptionId: {
    status: "ACTIVE",
    planSnapshot: { name: "Gold annual" },
    startsAt: "2026-09-01T00:00:00Z",
    endsAt: "2026-10-03T20:00:00Z",
  },
};
afterEach(() => document.body.replaceChildren());
it("uses gym-local calendar dates for the inclusive seven-day expiry highlight", () => {
  expect(membershipPresentation(member, timezone, now)).toMatchObject({
    state: "EXPIRING",
    daysRemaining: 7,
  });
  expect(
    membershipPresentation(
      {
        ...member,
        currentSubscriptionId: {
          ...member.currentSubscriptionId,
          endsAt: "2026-10-04T20:00:00Z",
        },
      },
      timezone,
      now,
    ).state,
  ).toBe("ACTIVE");
  expect(gymDate("2026-09-26T20:00:00Z", timezone)).toBe("27 Sept 2026");
});
it("does not classify frozen or deactivated access as active merely because dates are valid", () => {
  expect(
    membershipPresentation(
      {
        ...member,
        currentSubscriptionId: {
          ...member.currentSubscriptionId,
          status: "FROZEN",
        },
      },
      timezone,
      now,
    ).state,
  ).toBe("FROZEN");
  expect(
    membershipPresentation({ ...member, status: "ARCHIVED" }, timezone, now)
      .state,
  ).toBe("CANCELLED");
});
it("exposes status and plan to keyboard and touch users without a large status badge", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <MembershipStatusDot member={member} timezone={timezone} now={now} />,
    ),
  );
  const button = host.querySelector("button")!;
  expect(button.getAttribute("aria-label")).toContain(
    "Expiring soon. Gold annual",
  );
  await act(async () => button.focus());
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain(
    "Expires in 7 days",
  );
  await act(async () =>
    button.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    ),
  );
  expect(document.querySelector('[role="tooltip"]')).toBeNull();
  await act(async () => button.click());
  expect(document.querySelector('[role="tooltip"]')).not.toBeNull();
  expect(host.querySelector(".status-badge")).toBeNull();
  await act(async () => root.unmount());
});
