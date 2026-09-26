import { describe, expect, it } from "vitest";
import {
  addCalendarDays, isCardRating, isDue, isValidZone, localCalendarDate, nextDueDate,
} from "../src/schedule";

/** 2026-10-01 23:59:30 in America/New_York (UTC-4, before the zone's midnight). */
const LATE_EVENING_NY = Date.parse("2026-10-02T03:59:30Z");
/** 2026-10-02 00:00:30 in America/New_York — just past the zone's local midnight. */
const JUST_PAST_MIDNIGHT_NY = Date.parse("2026-10-02T04:00:30Z");
/** 2026-03-08 01:30 America/New_York, inside the spring-forward gap (clocks jump 02:00->03:00). */
const DST_SPRING_FORWARD = Date.parse("2026-03-08T06:30:00Z");

describe("localCalendarDate", () => {
  it("evaluates the same instant to different local dates across zones", () => {
    expect(localCalendarDate(LATE_EVENING_NY, "America/New_York")).toBe("2026-10-01");
    expect(localCalendarDate(LATE_EVENING_NY, "Asia/Ho_Chi_Minh")).toBe("2026-10-02");
    expect(localCalendarDate(LATE_EVENING_NY, "UTC")).toBe("2026-10-02");
  });

  it("crosses the local midnight boundary at the zone's own midnight, not UTC's", () => {
    expect(localCalendarDate(LATE_EVENING_NY, "America/New_York")).toBe("2026-10-01");
    expect(localCalendarDate(JUST_PAST_MIDNIGHT_NY, "America/New_York")).toBe("2026-10-02");
  });

  it("handles DST transition days without shifting the wall-clock date", () => {
    expect(localCalendarDate(DST_SPRING_FORWARD, "America/New_York")).toBe("2026-03-08");
    expect(localCalendarDate(Date.parse("2026-11-01T05:30:00Z"), "America/New_York")).toBe("2026-11-01");
  });
});

describe("addCalendarDays", () => {
  it("adds days across month and year boundaries", () => {
    expect(addCalendarDays("2026-10-30", 4)).toBe("2026-11-03");
    expect(addCalendarDays("2026-12-30", 4)).toBe("2027-01-03");
    expect(addCalendarDays("2028-02-27", 1)).toBe("2028-02-28"); // leap year
    expect(addCalendarDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("nextDueDate", () => {
  it("makes Not sure due the next local calendar day", () => {
    expect(nextDueDate("not_sure", "2026-10-01")).toBe("2026-10-02");
  });

  it("makes Sure due four calendar days later", () => {
    expect(nextDueDate("sure", "2026-10-01")).toBe("2026-10-05");
  });

  it("uses calendar days, so the rating-time clock time never leaks into the due date", () => {
    expect(nextDueDate("not_sure", localCalendarDate(LATE_EVENING_NY, "America/New_York"))).toBe("2026-10-02");
    expect(nextDueDate("sure", localCalendarDate(JUST_PAST_MIDNIGHT_NY, "America/New_York"))).toBe("2026-10-06");
  });
});

describe("isDue", () => {
  it("treats a card that was never rated as due", () => {
    expect(isDue(null, "2026-10-01")).toBe(true);
  });

  it("counts overdue cards as due today", () => {
    expect(isDue("2026-09-20", "2026-10-01")).toBe(true);
  });

  it("is due on the stored date itself and not after it", () => {
    expect(isDue("2026-10-01", "2026-10-01")).toBe(true);
    expect(isDue("2026-10-02", "2026-10-01")).toBe(false);
  });
});

describe("zone and rating validation", () => {
  it("accepts real IANA zones and rejects junk", () => {
    expect(isValidZone("Asia/Ho_Chi_Minh")).toBe(true);
    expect(isValidZone("America/New_York")).toBe(true);
    expect(isValidZone("UTC")).toBe(true);
    expect(isValidZone("Mars/Olympus")).toBe(false);
    expect(isValidZone("")).toBe(false);
    expect(isValidZone("../../etc")).toBe(false);
    expect(isValidZone(42)).toBe(false);
    expect(isValidZone(undefined)).toBe(false);
  });

  it("accepts only the two agreed ratings", () => {
    expect(isCardRating("not_sure")).toBe(true);
    expect(isCardRating("sure")).toBe(true);
    expect(isCardRating("easy")).toBe(false);
    expect(isCardRating(null)).toBe(false);
  });
});
