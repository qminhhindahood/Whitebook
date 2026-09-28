import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const hostedRoot = resolve(scriptDirectory, "..");
const releaseLock = JSON.parse(await readFile(join(scriptDirectory, "private-publication-release.json"), "utf8"));

export async function downloadVerifiedObject({ key, destination, expectedSha256, download }) {
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) throw new Error("Private R2 asset lock has an invalid SHA-256 value.");
  await mkdir(dirname(destination), { recursive: true });
  try {
    await download(key, destination);
    const hash = createHash("sha256");
    let bytes = 0;
    for await (const chunk of createReadStream(destination)) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    const actualSha256 = hash.digest("hex");
    if (actualSha256 !== expectedSha256) throw new Error(`Private R2 object failed SHA-256 verification: ${key}`);
    return { bytes, sha256: actualSha256 };
  } catch (error) {
    await rm(destination, { force: true });
    throw error;
  }
}

function downloadWithWrangler(key, destination) {
  const wrangler = resolve(hostedRoot, "node_modules/wrangler/bin/wrangler.js");
  const result = spawnSync(process.execPath, [wrangler, "r2", "object", "get", `${releaseLock.bucket}/${key}`,
    `--file=${destination}`, "--remote"], { cwd: hostedRoot, env: process.env, stdio: "ignore" });
  if (result.error || result.status !== 0)
    throw new Error("Could not fetch a pinned private build input from the R2 bucket.");
}

export async function restorePrivateRelease(directory, { download = downloadWithWrangler } = {}) {
  await mkdir(directory, { recursive: true });
  const archivePath = join(directory, "publication.tar.gz");
  const referenceSheetPath = join(directory, "reference-sheet.png");
  const publicationDirectory = join(directory, "publication");

  const publicationArchive = await downloadVerifiedObject({
    key: releaseLock.publicationArchiveKey,
    destination: archivePath,
    expectedSha256: releaseLock.publicationArchiveSha256,
    download,
  });
  const referenceSheet = await downloadVerifiedObject({
    key: releaseLock.referenceSheetKey,
    destination: referenceSheetPath,
    expectedSha256: releaseLock.referenceSheetSha256,
    download,
  });

  await mkdir(publicationDirectory, { recursive: true });
  const tar = process.platform === "win32" ? "tar.exe" : "tar";
  const extracted = spawnSync(tar, ["-xzf", archivePath, "-C", publicationDirectory], {
    cwd: hostedRoot,
    stdio: "ignore",
  });
  if (extracted.error || extracted.status !== 0)
    throw new Error("Could not unpack the pinned private publication archive.");
  await rm(archivePath, { force: true });

  const manifest = JSON.parse(await readFile(join(publicationDirectory, "bundle", "manifest.json"), "utf8"));
  if (manifest.releaseId !== releaseLock.releaseId || !Array.isArray(manifest.assets) ||
      manifest.assets.length !== releaseLock.expectedVisuals)
    throw new Error("The R2 publication archive does not match the approved release manifest.");

  return {
    privateDirectory: publicationDirectory,
    referenceSheetPath,
    archiveBytes: publicationArchive.bytes,
    referenceSheetBytes: referenceSheet.bytes,
    releaseId: releaseLock.releaseId,
  };
}
