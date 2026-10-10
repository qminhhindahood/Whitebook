import { expect, it } from "vitest";
import { localDateInZone, satCountdown, satDateLabel, satDateShortLabel, satTimeRemaining } from "./satCountdown";

it("formats the calendar date of an instant in an IANA time zone", () => {
  expect(localDateInZone(new Date("2026-10-02T23:30:00Z"), "Asia/Bangkok")).toBe("2026-10-03");
  expect(localDateInZone(new Date("2026-10-02T23:30:00Z"), "America/New_York")).toBe("2026-10-02");
});

it("computes days remaining until the target SAT date in the given time zone", () => {
  // Morning of 2026-09-01 in Bangkok (+07:00).
  const morning = new Date("2026-09-01T01:00:00Z");
  expect(satCountdown("2026-10-03", morning, "Asia/Bangkok")).toEqual({
    kind: "countdown",
    days: 32,
    target: "2026-10-03",
  });
});

it("identifies test day", () => {
  const testMorning = new Date("2026-10-03T01:00:00Z");
  expect(satCountdown("2026-10-03", testMorning, "Asia/Bangkok")).toEqual({
    kind: "test-day",
    target: "2026-10-03",
  });
});

it("identifies passed dates so the learner can pick their next target", () => {
  const dayAfter = new Date("2026-10-04T01:00:00Z");
  expect(satCountdown("2026-10-03", dayAfter, "Asia/Bangkok")).toEqual({
    kind: "passed",
    target: "2026-10-03",
  });
});

it("returns none when no target has been selected", () => {
  expect(satCountdown(null, new Date(), "Asia/Bangkok")).toEqual({ kind: "none" });
});

it("labels a date-only value with its weekday", () => {
  expect(satDateLabel("2026-10-03")).toBe("Saturday, 3 October 2026");
  expect(satDateLabel("2027-03-06")).toBe("Saturday, 6 March 2027");
});

it("formats the selected exam date compactly for the countdown banner", () => {
  expect(satDateShortLabel("2026-10-03")).toBe("Sat, Oct 3, 2026");
});

it("counts down live to 7:45 AM GMT+7 on test day", () => {
  // 2026-10-03T07:45:00+07:00 is 2026-10-03T00:45:00Z.
  expect(satTimeRemaining("2026-10-03", new Date("2026-10-02T00:45:00Z"))).toMatchObject({
    days: 1, hours: 0, minutes: 0, seconds: 0, isPassed: false, isSet: true,
  });
  expect(satTimeRemaining("2026-10-03", new Date("2026-10-02T23:44:59Z"))).toMatchObject({
    days: 0, hours: 1, minutes: 0, seconds: 1, isPassed: false, isSet: true,
  });
  expect(satTimeRemaining("2026-10-03", new Date("2026-10-03T00:45:01Z")).isPassed).toBe(true);
  expect(satTimeRemaining(null).isSet).toBe(false);
});
