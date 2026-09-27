import { expect, it } from "vitest";
import { addCalendarDays, gymCalendarDate } from "./gymCalendar";
it("defaults date-only member/payment fields to gym-local today, including after midnight in India", () => {
  expect(gymCalendarDate(new Date("2026-09-26T19:00:00Z"), "Asia/Kolkata")).toBe("2026-09-27");
  expect(gymCalendarDate(new Date("2026-09-27T01:00:00Z"), "America/New_York")).toBe("2026-09-26");
});
it("previews calendar duration without browser timezone or daylight-saving shifts", () => {
  expect(addCalendarDays("2026-11-01", 1)).toBe("2026-11-02");
  expect(addCalendarDays("2026-09-27", 30)).toBe("2026-10-27");
});
