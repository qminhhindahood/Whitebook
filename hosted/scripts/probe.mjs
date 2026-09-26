import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const base = (process.env.WHITEBOOK_STAGING_URL ?? "http://127.0.0.1:8787").replace(/\/$/, "");
const accessCode = process.env.WHITEBOOK_STAGING_ACCESS_CODE;
if (!accessCode) throw new Error("Set WHITEBOOK_STAGING_ACCESS_CODE for the staging probe.");

const limits = {
  workerRequestsPerDay: 100_000,
  workerCpuMsPerRequest: 10,
  d1RowsReadPerDay: 5_000_000,
  d1RowsWrittenPerDay: 100_000,
  staticAssetFiles: 20_000,
  staticAssetBytesPerFile: 25 * 1024 * 1024,
};
const contentPath = "/content/v1/fixture-1/triangle.svg";
const questionPath = "/api/staging/questions/v1/fixture-1";
const samples = [];
let rowsRead = 0;
let rowsWritten = 0;
let requests = 0;
let protectedAssetRequests = 0;

async function request(path, init = {}) {
  const started = performance.now();
  const response = await fetch(base + path, { redirect: "manual", ...init });
  samples.push({ path, status: response.status, wallMs: +(performance.now() - started).toFixed(2) });
  requests += 1;
  if (path.startsWith("/content/")) protectedAssetRequests += 1;
  rowsRead += Number(response.headers.get("x-staging-d1-rows-read") ?? 0);
  rowsWritten += Number(response.headers.get("x-staging-d1-rows-written") ?? 0);
  return response;
}

for (const path of [
  contentPath,
  `${contentPath}?download=1`,
  "/content/v1/fixture-1/%74riangle.svg",
  `${contentPath}/extra`,
  "/content/v1/fixture-1/source.pdf",
  "/source.pdf",
]) {
  assert.equal((await request(path)).status, 404, `Unprotected path: ${path}`);
}
assert.equal((await request(contentPath, { headers: { Host: "preview.example.test" } })).status, 404);
assert.equal((await request(contentPath, { headers: { Host: "alternate.example.test" } })).status, 404);
assert.equal((await request(questionPath)).status, 404);

const login = await request("/api/staging/session", {
  method: "POST",
  headers: { Origin: base, "Content-Type": "application/json" },
  body: JSON.stringify({ accessCode }),
});
assert.equal(login.status, 204);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
assert.ok(cookie, "Missing staging cookie");
assert.match(login.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Strict/);

const auth = { Cookie: cookie };
const question = await request(questionPath, { headers: auth });
assert.equal(question.status, 200);
const payload = await question.json();
assert.equal(payload.revisionId, "v1");
assert.equal(payload.questionId, "fixture-1");
assert.equal(payload.presentation.stem[1].src, contentPath);
assert.doesNotMatch(JSON.stringify(payload), /accepted|sourcePdf|\.pdf/i);
const visual = await request(contentPath, { headers: auth });
assert.equal(visual.status, 200);
assert.equal(visual.headers.get("cache-control"), "private, no-store");
const visualHash = createHash("sha256").update(Buffer.from(await visual.arrayBuffer())).digest("hex");
assert.equal(visualHash, "9255733aaf9f78b49f5f49474cc16c8cfa79b97e2543527dc1240e82ed157fc2");
assert.equal((await request("/content/v1/fixture-1/source.pdf", { headers: auth })).status, 404);

const concurrentClients = 30;
await Promise.all(Array.from({ length: concurrentClients }, async () => {
  const [questionResponse, visualResponse] = await Promise.all([
    request(questionPath, { headers: auth }),
    request(contentPath, { headers: auth }),
  ]);
  assert.equal(questionResponse.status, 200);
  assert.equal(visualResponse.status, 200);
  await questionResponse.arrayBuffer();
  await visualResponse.arrayBuffer();
}));

const dist = join(import.meta.dirname, "..", "dist");
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [{ path: relative(dist, path).replaceAll("\\", "/"), bytes: statSync(path).size }];
  });
}
const assets = files(dist);
assert.ok(assets.every((asset) => !asset.path.toLowerCase().endsWith(".pdf")));
for (const asset of assets.filter((entry) => /\.(?:js|html)$/.test(entry.path)))
  assert.doesNotMatch(readFileSync(join(dist, asset.path), "utf8"), /sourcePdfUrl|source\.pdf|acceptedAnswers|accepted_answers/i);
assert.deepEqual(assets.filter((asset) => asset.path.startsWith("content/")), [
  { path: "content/v1/fixture-1/triangle.svg", bytes: 714 },
]);
assert.equal(createHash("sha256").update(readFileSync(join(dist, "content/v1/fixture-1/triangle.svg"))).digest("hex"), visualHash);
assert.ok(assets.length <= limits.staticAssetFiles);
assert.ok(assets.every((asset) => asset.bytes <= limits.staticAssetBytesPerFile));

const durations = samples.map((sample) => sample.wallMs).sort((a, b) => a - b);
const result = {
  mode: base.startsWith("http://127.0.0.1") ? "local-workerd-and-D1" : "remote-staging",
  base,
  timestamp: new Date().toISOString(),
  concurrentClients,
  workerRequests: requests,
  protectedAssetRequests,
  d1RowsRead: rowsRead,
  d1RowsWritten: rowsWritten,
  requestWallMsP95: durations[Math.ceil(durations.length * .95) - 1],
  requestCpuMs: null,
  cpuNote: "Local Worker traces expose elapsed duration, not billed CPU. Read remote Workers analytics after staging deployment.",
  staticAssetFiles: assets.length,
  staticAssetBytes: assets.reduce((sum, asset) => sum + asset.bytes, 0),
  largestAssetBytes: Math.max(...assets.map((asset) => asset.bytes)),
  assets,
  limits,
};
console.log(JSON.stringify(result, null, 2));
