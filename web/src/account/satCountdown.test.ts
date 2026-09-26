import { expect, it } from "vitest";
import { localDateInZone, satCountdown, satDateLabel, satDateShortLabel } from "./satCountdown";

it("formats the calendar date of an instant in an IANA time zone", () => {
  expect(localDateInZone(new Date("2026-10-02T23:30:00Z"), "Asia/Bangkok")).toBe("2026-10-03");
  expect(localDateInZone(new Date("2026-10-02T23:30:00Z"), "Pacific/Pago_Pago")).toBe("2026-10-02");
});

it("counts down to 8:00 a.m. GMT+7 on the selected date", () => {
  expect(satCountdown("2026-10-03", new Date("2026-10-02T16:17:29Z"))).toEqual({
    kind: "countdown", days: 0, hours: 8, minutes: 42, seconds: 31, target: "2026-10-03",
  });
});

it("shows Test day at 8:00 a.m. GMT+7 and prompts after the selected date passes", () => {
  expect(satCountdown("2026-10-03", new Date("2026-10-03T00:59:59Z"))).toEqual({
    kind: "countdown", days: 0, hours: 0, minutes: 0, seconds: 1, target: "2026-10-03",
  });
  expect(satCountdown("2026-10-03", new Date("2026-10-03T01:00:00Z"))).toEqual({ kind: "test-day", target: "2026-10-03" });
  expect(satCountdown("2026-10-03", new Date("2026-10-03T17:00:00Z"))).toEqual({ kind: "passed", target: "2026-10-03" });
});

it("returns the no-target state", () => {
  expect(satCountdown(null, new Date("2026-09-01T00:00:00Z"))).toEqual({ kind: "none" });
});

it("labels a date-only value with its weekday", () => {
  expect(satDateLabel("2026-10-03")).toBe("Saturday, 3 October 2026");
  expect(satDateLabel("2028-06-03")).toBe("Saturday, 3 June 2028");
  expect(satDateLabel("2026-10-03")).not.toMatch(/\d(?::\d|am|pm)/);
});

it("formats the selected exam date compactly for the countdown banner", () => {
  expect(satDateShortLabel("2026-10-03")).toBe("Sat, Oct 3, 2026");
});
