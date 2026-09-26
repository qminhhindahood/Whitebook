export type CountdownState =
  | { kind: "none" }
  | { kind: "days"; days: number; target: string }
  | { kind: "test-day"; target: string }
  | { kind: "passed"; target: string };

/** The calendar date (YYYY-MM-DD) at the given instant in an IANA time zone. */
export function localDateInZone(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(instant);
}

function calendarDaysBetween(fromYmd: string, toYmd: string): number {
  const [fromYear, fromMonth, fromDay] = fromYmd.split("-").map(Number);
  const [toYear, toMonth, toDay] = toYmd.split("-").map(Number);
  return Math.round((Date.UTC(toYear, toMonth - 1, toDay) - Date.UTC(fromYear, fromMonth - 1, fromDay)) / 86400000);
}

/**
 * Calendar-day countdown to an SAT test date in the learner's saved IANA time
 * zone. A date-only difference: on the test date itself this is Test day, and
 * after it the learner is prompted to pick a new target. No time of day is
 * attached to the administration.
 */
export function satCountdown(target: string, zone: string, now: Date): CountdownState {
  if (!target) return { kind: "none" };
  let today: string;
  try {
    today = localDateInZone(now, zone);
  } catch {
    today = localDateInZone(now, Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }
  const days = calendarDaysBetween(today, target);
  if (days > 0) return { kind: "days", days, target };
  if (days === 0) return { kind: "test-day", target };
  return { kind: "passed", target };
}

/** Saturday-aware long label for a date-only value, e.g. "Saturday, 3 October 2026". */
export function satDateLabel(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
