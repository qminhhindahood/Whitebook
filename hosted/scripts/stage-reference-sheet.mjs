import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const checkoutRoot = resolve(scriptDirectory, "../..");
const ownerWorkspaceRoot = resolve(checkoutRoot, "../..");
const candidates = [
  resolve(checkoutRoot, "ref/reference-sheet.png"),
  resolve(ownerWorkspaceRoot, "ref/reference-sheet.png"),
];

export async function stageReferenceSheet(source, destination) {
  const bytes = await readFile(source);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length < pngSignature.length || !bytes.subarray(0, pngSignature.length).equals(pngSignature))
    throw new Error(`Reference Sheet is not a valid PNG: ${source}`);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
  process.stdout.write(`Staged Math Reference Sheet: ${destination}\n`);
}

export async function findReferenceSheet() {
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // A linked worktree may keep owner assets at the containing workspace root.
    }
  }
  throw new Error(`Reference Sheet not found. Expected one of: ${candidates.join(", ")}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = await findReferenceSheet();
  await stageReferenceSheet(source, resolve(checkoutRoot, "hosted/dist/assets/reference-sheet.png"));
}
