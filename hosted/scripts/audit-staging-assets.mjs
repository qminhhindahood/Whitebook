#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const HOSTED = resolve(import.meta.dirname, "..");
const DIST = resolve(HOSTED, "dist");
const PRIMARY = new URL(process.env.WHITEBOOK_STAGING_URL ||
  "https://whitebook.docai.dpdns.org");
const VERSION = process.env.WHITEBOOK_STAGING_VERSION_URL ||
  "https://2c7c78c9-whitebook-hosted-staging.anothermiralph.workers.dev";
const FILE_LIMIT = 20_000;
const BYTE_LIMIT = 25 * 1024 * 1024;

if (PRIMARY.hostname !== "whitebook.docai.dpdns.org" || PRIMARY.protocol !== "https:") {
  throw new Error("The asset audit only runs against the configured staging Worker.");
}

async function walk(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...await walk(path));
    else if (entry.isFile()) output.push({ path, size: (await stat(path)).size });
  }
  return output;
}

const files = await walk(DIST);
const largest = files.reduce((item, file) => file.size > item.size ? file : item, { size: 0 });
const pdfFiles = files.filter((file) => file.path.toLowerCase().endsWith(".pdf"));
const contentFiles = files.filter((file) => relative(join(DIST, "content"), file.path).split(/[\\/]/)[0] !== ".." &&
  file.path.startsWith(join(DIST, "content")));
const relativeAsset = relative(DIST, contentFiles[0]?.path || "").split("\\").join("/");
const protectedAssetPath = `/${relativeAsset}`;

const checks = [];
async function probe(host, path, { hostHeader } = {}) {
  const headers = hostHeader ? { Host: hostHeader } : {};
  let response;
  let body;
  try {
    response = await fetch(new URL(path, host), {
      method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(20_000),
    });
    body = Buffer.from(await response.arrayBuffer());
  } catch {
    checks.push({ host: new URL(host).hostname, path, reachable: false, safe: true });
    return;
  }
  const contentType = response.headers.get("content-type") || "";
  const pdfPayload = contentType.toLowerCase().includes("application/pdf") ||
    body.subarray(0, 5).toString("ascii") === "%PDF-";
  let answerFields = false;
  if (contentType.toLowerCase().includes("json")) {
    try {
      const parsed = JSON.parse(body.toString("utf8"));
      answerFields = /acceptedAnswers|answerKey|answerKeys|correctAnswer|correctAnswers/i.test(JSON.stringify(parsed));
    } catch { /* Non-JSON error pages are safe to classify by MIME and status. */ }
  }
  checks.push({
    host: new URL(host).hostname,
    path,
    status: response.status,
    contentType,
    responseBytes: body.byteLength,
    pdfPayload,
    answerFields,
    safe: !pdfPayload && !answerFields,
  });
}

const candidates = [
  "/source.pdf", "/Source.pdf", "/source.PDF", "/answers.json", "/presentations.json",
  "/manifest.json", "/.publication/answers.json", "/publication/answers.json",
  "/content/reviewed-five-20260927/source.pdf", "/content/reviewed-five-20260927/answers.json",
  "/%2e%2e/source.pdf", "/%252e%252e/source.pdf", "/content%2f..%2fsource.pdf",
  "/content/%2e%2e/%2e%2e/source.pdf", "/content/%252e%252e/source.pdf",
  "/api/answers", "/api/publication/answers", "/api/attempts",
  protectedAssetPath,
];
for (const path of candidates) await probe(PRIMARY, path);

for (const path of ["/source.pdf", "/answers.json", "/api/attempts", protectedAssetPath]) {
  await probe(VERSION, path);
}
for (const path of ["/source.pdf", "/answers.json", protectedAssetPath]) {
  await probe(PRIMARY, path, { hostHeader: "invalid.example" });
}

const extensionCounts = Object.fromEntries([...new Set(files.map((file) => {
  const name = file.path.split(/[\\/]/).pop() || "";
  const index = name.lastIndexOf(".");
  return index < 0 ? "[no extension]" : name.slice(index).toLowerCase();
}))].sort().map((extension) => [extension, {
  files: files.filter((file) => {
    const name = file.path.split(/[\\/]/).pop() || "";
    const index = name.lastIndexOf(".");
    return (index < 0 ? "[no extension]" : name.slice(index).toLowerCase()) === extension;
  }).length,
  bytes: files.filter((file) => {
    const name = file.path.split(/[\\/]/).pop() || "";
    const index = name.lastIndexOf(".");
    return (index < 0 ? "[no extension]" : name.slice(index).toLowerCase()) === extension;
  }).reduce((sum, file) => sum + file.size, 0),
}]));

const output = {
  auditedAt: new Date().toISOString(),
  target: PRIMARY.origin,
  deployedVersionHostTested: new URL(VERSION).hostname,
  fileCount: files.length,
  fileLimit: FILE_LIMIT,
  fileLimitPercent: Number((100 * files.length / FILE_LIMIT).toFixed(2)),
  fileHeadroom: FILE_LIMIT - files.length,
  totalBytes: files.reduce((sum, file) => sum + file.size, 0),
  largestFileBytes: largest.size,
  largestFile: relative(DIST, largest.path).split("\\").join("/"),
  fileByteLimit: BYTE_LIMIT,
  largestFileLimitPercent: Number((100 * largest.size / BYTE_LIMIT).toFixed(2)),
  fileSizes: files.map((file) => ({
    path: relative(DIST, file.path).split("\\").join("/"),
    bytes: file.size,
  })).sort((left, right) => left.path.localeCompare(right.path)),
  pdfFiles: pdfFiles.length,
  contentAssets: contentFiles.length,
  extensionCounts,
  pathChecks: checks,
  unsafeChecks: checks.filter((item) => !item.safe),
};
console.log(JSON.stringify(output, null, 2));
if (output.fileCount > FILE_LIMIT || output.largestFileBytes > BYTE_LIMIT ||
    output.pdfFiles !== 0 || output.unsafeChecks.length !== 0) {
  process.exitCode = 1;
}
