export type CountdownState =
  | { kind: "none" }
  | { kind: "countdown"; days: number; target: string }
  | { kind: "test-day"; target: string }
  | { kind: "passed"; target: string };

/** The device's IANA time zone. The learner's saved zone supersedes this once accounts store one. */
export function deviceZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function partsDate(parts: Intl.DateTimeFormatPart[]): string {
  const value = (type: string) => Number(parts.find((part) => type === part.type)!.value);
  return String(value("year")).padStart(4, "0") + "-" + String(value("month")).padStart(2, "0") + "-" + String(value("day")).padStart(2, "0");
}

/** The calendar date (YYYY-MM-DD) at the given instant in an IANA time zone. */
export function localDateInZone(instant: Date, zone: string): string {
  return partsDate(new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant));
}

/**
 * Calendar-date difference in an IANA time zone: today's local date versus the
 * selected date. Test day is the date itself in that zone; the day after it
 * passes, the learner is prompted to choose a later target.
 */
export function satCountdown(target: string | null, now: Date, zone: string = deviceZone()): CountdownState {
  if (!target) return { kind: "none" };
  const today = localDateInZone(now, zone);
  if (today > target) return { kind: "passed", target };
  if (today === target) return { kind: "test-day", target };

  const [targetYear, targetMonth, targetDay] = target.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  const days = Math.round(
    (Date.UTC(targetYear, targetMonth - 1, targetDay) - Date.UTC(todayYear, todayMonth - 1, todayDay)) / 86_400_000,
  );
  return { kind: "countdown", days, target };
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
