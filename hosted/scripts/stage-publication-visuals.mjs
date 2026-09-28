#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASE = "reviewed-five-20260927";
const EXPECTED_VISUALS = 2272;

async function listFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

export async function stagePublicationVisuals(privateDirectory, distDirectory, { expectedCount = EXPECTED_VISUALS } = {}) {
  if (!privateDirectory) throw new Error("The private publication bundle is required for a release build.");
  const manifest = JSON.parse(await readFile(join(privateDirectory, "bundle", "manifest.json"), "utf8"));
  if (manifest.releaseId !== RELEASE || !Array.isArray(manifest.assets) || manifest.assets.length !== expectedCount)
    throw new Error(`Expected the approved ${RELEASE} publication with ${expectedCount} visuals.`);

  const sourceRoot = join(privateDirectory, "prepared", "assets", "content");
  const targetRoot = join(distDirectory, "content");
  const paths = new Set();
  let totalBytes = 0;
  for (const asset of manifest.assets) {
    if (![asset.revisionId, asset.questionId].every((part) => typeof part === "string" && /^[A-Za-z0-9_-]+$/.test(part)) ||
        typeof asset.name !== "string" || !/^[A-Za-z0-9_-]+\.png$/.test(asset.name) ||
        typeof asset.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(asset.sha256) ||
        !Number.isSafeInteger(asset.byteSize) || asset.byteSize <= 0)
      throw new Error("The private publication manifest contains an invalid visual entry.");
    const path = join(asset.revisionId, asset.questionId, asset.name);
    if (paths.has(path)) throw new Error("The private publication manifest repeats a visual path.");
    paths.add(path);
    const sourceBytes = await readFile(join(sourceRoot, path));
    const sourceHash = createHash("sha256").update(sourceBytes).digest("hex");
    if (sourceBytes.length !== asset.byteSize || sourceHash !== asset.sha256)
      throw new Error("A private publication visual has the wrong size or hash.");
    const destination = join(targetRoot, path);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(join(sourceRoot, path), destination);
    const stagedBytes = await readFile(destination);
    if (stagedBytes.length !== asset.byteSize || createHash("sha256").update(stagedBytes).digest("hex") !== asset.sha256)
      throw new Error("A staged publication visual has the wrong size or hash.");
    totalBytes += stagedBytes.length;
  }

  const stagedPaths = (await listFiles(targetRoot)).filter((path) => path.toLowerCase().endsWith(".png"));
  if (stagedPaths.length !== paths.size || stagedPaths.some((path) => !paths.has(relative(targetRoot, path))))
    throw new Error("The staged publication visual set differs from the approved manifest.");
  return { releaseId: RELEASE, files: paths.size, bytes: totalBytes };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const privateDirectory = process.env.WHITEBOOK_PRIVATE_PUBLICATION_DIR;
  const distDirectory = resolve(import.meta.dirname, "../dist");
  const result = await stagePublicationVisuals(privateDirectory, distDirectory);
  console.log(JSON.stringify(result));
}
