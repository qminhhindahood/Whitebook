export type CountdownState =
  | { kind: "none" }
  | { kind: "countdown"; days: number; hours: number; minutes: number; seconds: number; target: string }
  | { kind: "test-day"; target: string }
  | { kind: "passed"; target: string };

const DAY_MS = 86_400_000;
const COUNTDOWN_ZONE = "Asia/Bangkok";
const EXAM_HOUR_GMT7 = 8;
const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: COUNTDOWN_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

function partsDate(parts: Intl.DateTimeFormatPart[]): string {
  const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return String(value("year")).padStart(4, "0") + "-" + String(value("month")).padStart(2, "0") + "-" + String(value("day")).padStart(2, "0");
}

/** The calendar date (YYYY-MM-DD) at the given instant in an IANA time zone. */
export function localDateInZone(instant: Date, zone: string): string {
  const formatter = zone === COUNTDOWN_ZONE ? dateFormatter : new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  });
  return partsDate(formatter.formatToParts(instant));
}

/**
 * Counts down to 8:00 a.m. GMT+7 on the selected SAT date. The countdown uses
 * the same fixed Asia/Bangkok calendar on every device; on the date it changes
 * to Test day at the countdown cutoff and prompts for a later target afterward.
 */
export function satCountdown(target: string | null, now: Date): CountdownState {
  if (!target) return { kind: "none" };
  const today = localDateInZone(now, COUNTDOWN_ZONE);
  if (today > target) return { kind: "passed", target };

  const [year, month, day] = target.split("-").map(Number);
  // Bangkok stays at UTC+7 year-round, so 08:00 local is 01:00 UTC.
  const deadline = Date.UTC(year, month - 1, day, EXAM_HOUR_GMT7 - 7);
  if (now.getTime() >= deadline) return { kind: "test-day", target };

  const secondsRemaining = Math.max(0, Math.ceil((deadline - now.getTime()) / 1_000));
  const days = Math.floor(secondsRemaining / (DAY_MS / 1_000));
  const remainderAfterDays = secondsRemaining % (DAY_MS / 1_000);
  const hours = Math.floor(remainderAfterDays / 3_600);
  const remainderAfterHours = remainderAfterDays % 3_600;
  const minutes = Math.floor(remainderAfterHours / 60);
  const seconds = remainderAfterHours % 60;
  return { kind: "countdown", days, hours, minutes, seconds, target };
}

/** Saturday-aware long label for a date-only value, e.g. "Saturday, 3 October 2026". */
export function satDateLabel(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Compact date for the Dashboard countdown banner, e.g. "Sat, Oct 3, 2026". */
export function satDateShortLabel(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}
