import { mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { findReferenceSheet, stageReferenceSheet } from "./stage-reference-sheet.mjs";
import { restorePrivateRelease } from "./private-release-r2.mjs";
import { stagePublicationVisuals } from "./stage-publication-visuals.mjs";

const scriptDirectory = fileURLToPath(new URL(".", import.meta.url));
const hostedRoot = resolve(scriptDirectory, "..");
const distDirectory = resolve(hostedRoot, "dist");
const tempPrefix = join(hostedRoot, ".private-build-inputs-");
const useR2 = process.env.WORKERS_CI === "1" || process.argv.includes("--r2");

let privateDirectory;
let referenceSheetPath;
let temporaryDirectory;

try {
  if (useR2) {
    temporaryDirectory = await mkdtemp(tempPrefix);
    const release = await restorePrivateRelease(temporaryDirectory);
    privateDirectory = release.privateDirectory;
    referenceSheetPath = release.referenceSheetPath;
    process.stdout.write(`Fetched pinned private release ${release.releaseId} (${release.archiveBytes} archive bytes, ${release.referenceSheetBytes} reference-sheet bytes).\n`);
  } else {
    privateDirectory = process.env.WHITEBOOK_PRIVATE_PUBLICATION_DIR;
    if (!privateDirectory) throw new Error("The private publication bundle is required for a release build.");
    referenceSheetPath = await findReferenceSheet();
  }

  await stageReferenceSheet(referenceSheetPath, resolve(distDirectory, "assets/reference-sheet.png"));
  const result = await stagePublicationVisuals(privateDirectory, distDirectory);
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}
