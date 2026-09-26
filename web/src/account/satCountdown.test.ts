import { expect, it } from "vitest";
import { localDateInZone, satCountdown, satDateLabel } from "./satCountdown";

it("formats the calendar date of an instant in an IANA time zone", () => {
  expect(localDateInZone(new Date("2026-10-02T23:30:00Z"), "Pacific/Kiritimati")).toBe("2026-10-03");
  expect(localDateInZone(new Date("2026-10-02T23:30:00Z"), "Pacific/Pago_Pago")).toBe("2026-10-02");
  expect(localDateInZone(new Date("2026-11-01T05:30:00Z"), "America/New_York")).toBe("2026-11-01");
});

it("counts calendar days in the saved zone, not 24-hour blocks", () => {
  // The United States leaves daylight saving on 2026-11-01 (a 25-hour day):
  // three calendar days remain even though fewer than 72 hours pass.
  const now = new Date("2026-10-30T12:00:00Z");
  expect(satCountdown("2026-11-02", "America/New_York", now)).toEqual({ kind: "days", days: 3, target: "2026-11-02" });
});

it("shows Test day on the date and prompts for a new target after it passes", () => {
  const now = new Date("2026-10-02T20:00:00Z");
  expect(satCountdown("2026-10-03", "Asia/Ho_Chi_Minh", now)).toEqual({ kind: "test-day", target: "2026-10-03" });
  expect(satCountdown("2026-10-02", "Asia/Ho_Chi_Minh", now)).toEqual({ kind: "passed", target: "2026-10-02" });
  expect(satCountdown("2026-10-03", "Pacific/Pago_Pago", now)).toEqual({ kind: "days", days: 1, target: "2026-10-03" });
});

it("returns the no-target state and falls back to the browser zone for an invalid saved zone", () => {
  expect(satCountdown("", "Asia/Ho_Chi_Minh", new Date())).toEqual({ kind: "none" });
  const fallback = satCountdown("2026-10-03", "Not/AZone", new Date("2026-09-01T00:00:00Z"));
  expect(fallback).toMatchObject({ kind: "days", days: 32, target: "2026-10-03" });
});

it("labels a date-only value with its weekday and never a time of day", () => {
  expect(satDateLabel("2026-10-03")).toBe("Saturday, 3 October 2026");
  expect(satDateLabel("2028-06-03")).toBe("Saturday, 3 June 2028");
  expect(satDateLabel("2026-10-03")).not.toMatch(/\d(?::\d|am|pm)/);
});
