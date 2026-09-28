import { strict as assert } from "node:assert";
import { test } from "node:test";
import { retryLoad } from "../scripts/retry-load.mjs";

test("retries transient visual failures but not authorization failures", async () => {
  let attempts = 0;
  const value = await retryLoad(async () => {
    attempts++;
    if (attempts < 3) throw Object.assign(new Error("service unavailable"), { status: 503 });
    return "ready";
  }, { delayMs: 0 });
  assert.equal(value, "ready");
  assert.equal(attempts, 3);

  attempts = 0;
  await assert.rejects(retryLoad(async () => {
    attempts++;
    throw Object.assign(new Error("signed out"), { status: 401 });
  }, { delayMs: 0 }), /signed out/);
  assert.equal(attempts, 1);
});
