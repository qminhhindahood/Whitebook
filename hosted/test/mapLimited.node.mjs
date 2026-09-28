import { strict as assert } from "node:assert";
import { test } from "node:test";
import { mapLimited } from "../scripts/map-limited.mjs";

test("rehearsal requests stay bounded and preserve question order", async () => {
  let active = 0;
  let peak = 0;
  const result = await mapLimited(Array.from({ length: 12 }, (_, index) => index), 4, async (index) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, (12 - index) % 4));
    active--;
    return index * 2;
  });
  assert.equal(peak, 4);
  assert.deepEqual(result, Array.from({ length: 12 }, (_, index) => index * 2));
});

test("a failed request waits for in-flight requests before cleanup", async () => {
  let completed = 0;
  await assert.rejects(mapLimited([0, 1, 2], 2, async (index) => {
    if (index === 0) throw new Error("failed request");
    await new Promise((resolve) => setTimeout(resolve, 10));
    completed++;
  }), /failed request/);
  assert.equal(completed, 1);
});
