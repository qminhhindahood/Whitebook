import { expect, it } from "vitest";
import { calculate } from "./scientific";

it.each([
  ["2+3*4", "14"],
  ["(2+3)^2", "25"],
  ["2^3^2", "512"],
  ["sqrt(81)", "9"],
  ["sin(30)", "0.5"],
  ["cos(60)", "0.5"],
  ["log(1000)", "3"],
  ["ln(e)", "1"],
  ["-2^2", "-4"],
  [".5+1/2", "1"],
  ["1/0", "Check expression"],
  ["sqrt(-1)", "Check expression"],
  ["window.alert(1)", "Check expression"],
])("calculates %s safely", (expression, expected) =>
  expect(calculate(expression)).toBe(expected),
);

it("supports radians explicitly", () =>
  expect(calculate("sin(pi/2)", "radians")).toBe("1"));
