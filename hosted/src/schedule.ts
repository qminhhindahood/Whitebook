/**
 * Flashcard scheduling rules (ticket 10). Everything here is pure calendar
 * math over date-only values so that a stored due date never depends on the
 * zone it was computed in: "today" is evaluated in the effective zone at
 * read/rating time, and the stored YYYY-MM-DD due date is never rewritten.
 */
export type CardRating = "not_sure" | "sure";

/** Not sure returns the next local calendar day; Sure returns four days later. */
const RATING_DAY_OFFSETS: Record<CardRating, number> = { not_sure: 1, sure: 4 };

export function isCardRating(value: unknown): value is CardRating {
  return value === "not_sure" || value === "sure";
}

export function isValidZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || !zone || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The local calendar date (YYYY-MM-DD) at the given instant in an IANA zone. */
export function localCalendarDate(epochMs: number, zone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date(epochMs));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year").padStart(4, "0")}-${value("month").padStart(2, "0")}-${value("day").padStart(2, "0")}`;
}

/** Pure date-only arithmetic across months and years; never touches zones. */
export function addCalendarDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  if (!year || !month || !day) throw new Error(`Invalid date-only value: ${ymd}`);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** Not sure -> next local calendar day, Sure -> four calendar days later. */
export function nextDueDate(rating: CardRating, todayYmd: string): string {
  return addCalendarDays(todayYmd, RATING_DAY_OFFSETS[rating]);
}

/** A card is due when it has never been rated, or when its due date is today or earlier (overdue counts as due today). */
export function isDue(dueDate: string | null, todayYmd: string): boolean {
  return dueDate === null || dueDate <= todayYmd;
}
