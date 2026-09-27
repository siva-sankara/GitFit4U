/** Calendar operations use the gym's IANA timezone, never the server timezone. */
export function calendarDate(date: Date, timeZone = "UTC") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  return ["year", "month", "day"]
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join("-");
}
export function shiftCalendarDate(date: string, days: number) {
  return new Date(Date.parse(date + "T00:00:00Z") + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
export function calendarDaysRemaining(
  endsAt: Date,
  now: Date,
  timeZone: string,
) {
  return Math.round(
    (Date.parse(calendarDate(endsAt, timeZone)) -
      Date.parse(calendarDate(now, timeZone))) /
      86400000,
  );
}
export function zonedDayStart(date: string, timeZone = "UTC") {
  const target = Date.parse(`${date}T00:00:00Z`);
  let instant = target;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  for (let i = 0; i < 4; i++) {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: string) =>
      Number(parts.find((value) => value.type === type)!.value);
    const local = Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    );
    const correction = target - local;
    if (!correction) break;
    instant += correction;
  }
  return new Date(instant);
}
