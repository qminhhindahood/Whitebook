import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { stagePublicationVisuals } from "../scripts/stage-publication-visuals.mjs";

test("release staging copies and verifies every manifest visual", async () => {
  const root = await mkdtemp(join(tmpdir(), "whitebook-stage-test-"));
  try {
    const source = join(root, "private");
    const dist = join(root, "dist");
    const bytes = Buffer.from("sample image");
    const asset = { revisionId: "revision", questionId: "question", name: "image.png",
      sha256: createHash("sha256").update(bytes).digest("hex"), byteSize: bytes.length };
    const path = join(source, "prepared", "assets", "content", "revision", "question", "image.png");
    await mkdir(join(source, "bundle"), { recursive: true });
    await mkdir(join(source, "prepared", "assets", "content", "revision", "question"), { recursive: true });
    await writeFile(join(source, "bundle", "manifest.json"), JSON.stringify({
      releaseId: "reviewed-five-20260927", assets: [asset],
    }));
    await writeFile(path, bytes);

    const result = await stagePublicationVisuals(source, dist, { expectedCount: 1 });
    assert.deepEqual(result, { releaseId: "reviewed-five-20260927", files: 1, bytes: bytes.length });
    assert.deepEqual(await readFile(join(dist, "content", "revision", "question", "image.png")), bytes);

    await writeFile(path, "corrupted");
    await assert.rejects(stagePublicationVisuals(source, dist, { expectedCount: 1 }), /hash|size/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a release build cannot stage visuals without a private bundle", () => {
  const env = { ...process.env };
  delete env.WHITEBOOK_PRIVATE_PUBLICATION_DIR;
  const result = spawnSync(process.execPath, [resolve(import.meta.dirname, "../scripts/stage-publication-visuals.mjs")],
    { env, encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /private publication bundle is required/i);
});
