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

export type LiveCountdown = {
  days: number; hours: number; minutes: number; seconds: number;
  isPassed: boolean; isSet: boolean; targetInstant: number | null;
};

/**
 * Milliseconds remaining until 7:45 AM GMT+7 on the target exam date.
 * The target instant is `${targetYmd}T07:45:00+07:00` (00:45:00 UTC).
 * Ticks live every second in the browser via DashboardClock.
 */
export function satTimeRemaining(targetYmd: string | null, now: Date = new Date()): LiveCountdown {
  if (!targetYmd || !/^\d{4}-\d{2}-\d{2}$/.test(targetYmd))
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isPassed: false, isSet: false, targetInstant: null };
  const targetInstant = Date.parse(`${targetYmd}T07:45:00+07:00`);
  if (Number.isNaN(targetInstant))
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isPassed: false, isSet: false, targetInstant: null };
  const diff = targetInstant - now.getTime();
  if (diff <= 0)
    return { days: 0, hours: 0, minutes: 0, seconds: 0, isPassed: true, isSet: true, targetInstant };
  const totalSeconds = Math.floor(diff / 1000);
  return {
    days: Math.floor(totalSeconds / 86_400),
    hours: Math.floor(totalSeconds % 86_400 / 3600),
    minutes: Math.floor(totalSeconds % 3600 / 60),
    seconds: totalSeconds % 60,
    isPassed: false, isSet: true, targetInstant,
  };
}
