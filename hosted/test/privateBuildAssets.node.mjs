import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { downloadVerifiedObject } from "../scripts/private-release-r2.mjs";

test("R2 input restoration verifies the downloaded object hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "whitebook-r2-input-"));
  try {
    const content = Buffer.from("private release fixture");
    const expectedSha256 = createHash("sha256").update(content).digest("hex");
    const destination = join(root, "release.tar.gz");
    let requestedKey;

    await downloadVerifiedObject({
      key: "releases/test/release.tar.gz",
      destination,
      expectedSha256,
      download: async (key, target) => {
        requestedKey = key;
        await writeFile(target, content);
      },
    });

    assert.equal(requestedKey, "releases/test/release.tar.gz");
    assert.deepEqual(await readFile(destination), content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("R2 input restoration rejects an object with the wrong hash", async () => {
  const root = await mkdtemp(join(tmpdir(), "whitebook-r2-input-"));
  try {
    const destination = join(root, "release.tar.gz");
    await assert.rejects(downloadVerifiedObject({
      key: "releases/test/release.tar.gz",
      destination,
      expectedSha256: "0".repeat(64),
      download: async (_key, target) => writeFile(target, "tampered"),
    }), /SHA-256/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
