import { expect, it } from "vitest";
import { suggestRegion } from "./region-suggestions";

it("suggests an unconfirmed region ending before the next numbered question", () => {
  const region = suggestRegion(
    [
      { text: "1. Question", x: 0.08, y: 0.1 },
      { text: "2. Next", x: 0.08, y: 0.6 },
    ],
    1,
    1,
  )!;
  expect(region.confirmed).toBe(false);
  expect(region.y + region.height).toBeCloseTo(0.58);
});
it("leaves scanned, ambiguous, and right-column content to manual mapping", () => {
  expect(suggestRegion([], 1, 1)).toBeNull();
  expect(
    suggestRegion(
      [
        { text: "1. Q", x: 0.08, y: 0.1 },
        { text: "1. Q", x: 0.08, y: 0.4 },
      ],
      1,
      1,
    ),
  ).toBeNull();
  expect(suggestRegion([{ text: "1. Q", x: 0.6, y: 0.1 }], 1, 1)).toBeNull();
});
