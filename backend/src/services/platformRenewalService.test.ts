import { expect, it } from "vitest";
import { renewalEnd } from "./platformRenewalService.js";
it("preserves unused active platform days on renewal", () => {
  expect(
    renewalEnd(
      { status: "ACTIVE", endsAt: new Date("2026-10-10T12:00:00Z") },
      30,
      new Date("2026-10-01T12:00:00Z"),
    ),
  ).toEqual(new Date("2026-11-09T12:00:00Z"));
});
it("starts expired or cancelled renewal from payment capture time", () => {
  const now = new Date("2026-10-01T12:00:00Z");
  expect(
    renewalEnd(
      { status: "EXPIRED", endsAt: new Date("2026-09-01T12:00:00Z") },
      30,
      now,
    ),
  ).toEqual(new Date("2026-10-31T12:00:00Z"));
  expect(
    renewalEnd(
      { status: "CANCELLED", endsAt: new Date("2027-09-01T12:00:00Z") },
      30,
      now,
    ),
  ).toEqual(new Date("2026-10-31T12:00:00Z"));
});
it.each([0, -1, 10000, 2.5, NaN])(
  "rejects invalid platform plan duration %s",
  (duration) => expect(() => renewalEnd(null, duration)).toThrow(),
);
