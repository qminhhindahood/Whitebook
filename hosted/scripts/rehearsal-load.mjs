#!/usr/bin/env node
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { mapLimited } from "./map-limited.mjs";
import { retryLoad } from "./retry-load.mjs";

const HOSTED = resolve(import.meta.dirname, "..");
const WORKER = resolve(HOSTED, "node_modules", "wrangler", "bin", "wrangler.js");
const DATABASE = "whitebook-ticket-03-staging";
const DEFAULT_ORIGIN = "https://whitebook.docai.dpdns.org";
const RELIABILITY_ORIGIN = "https://whitebook-reliability-staging.anothermiralph.workers.dev";
const origin = new URL(process.env.WHITEBOOK_STAGING_URL || DEFAULT_ORIGIN);
if (![DEFAULT_ORIGIN, RELIABILITY_ORIGIN].includes(origin.origin)) {
  throw new Error("This rehearsal only runs against the configured staging Worker.");
}

const diagnostic = process.env.WHITEBOOK_REHEARSAL_DIAGNOSTIC === "1";
const learnerCount = Number(process.env.WHITEBOOK_REHEARSAL_LEARNERS || (diagnostic ? 1 : 24));
if (!Number.isInteger(learnerCount) || (diagnostic ? learnerCount !== 1 : learnerCount < 20 || learnerCount > 30)) {
  throw new Error(diagnostic
    ? "A diagnostic run uses exactly one synthetic learner."
    : "Set WHITEBOOK_REHEARSAL_LEARNERS to an integer from 20 to 30.");
}

const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(8).toString("hex")}`;
const providerPrefix = `ticket03-rehearsal-${runId}`;
const nowSeconds = Math.floor(Date.now() / 1000);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const learners = Array.from({ length: learnerCount }, (_, index) => {
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  return {
    accountId: randomUUID(),
    providerSubject: `${providerPrefix}-${index + 1}`,
    email: `${providerPrefix}-${index + 1}@example.invalid`,
    token,
    csrf,
    tokenHash: sha256(token),
    csrfHash: sha256(csrf),
    section: index % 2 === 0 ? "Math" : "Reading and Writing",
    requestCount: 0,
  };
});

function runWrangler(args) {
  const result = spawnSync(process.execPath, [WORKER, ...args], {
    cwd: HOSTED,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error("The staging rehearsal database operation failed.");
  }
}

function readD1Insights() {
  const result = spawnSync(process.execPath, [WORKER, "d1", "insights", DATABASE,
    "--sort-type=sum", "--sort-by=reads", "--limit=1000", "--time-period=1d", "--json"], {
    cwd: HOSTED, encoding: "utf8", windowsHide: true, timeout: 20_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  try {
    const entries = JSON.parse(result.stdout);
    return {
      queryPatterns: entries.length,
      rowsRead: entries.reduce((sum, entry) => sum + Number(entry.totalRowsRead || 0), 0),
      rowsWritten: entries.reduce((sum, entry) => sum + Number(entry.totalRowsWritten || 0), 0),
    };
  } catch {
    return null;
  }
}

function readDatabaseSizeBytes() {
  const result = spawnSync(process.execPath, [WORKER, "d1", "execute", DATABASE,
    "--remote", "--json", "--command", "SELECT 1 AS rehearsal_probe"], {
    cwd: HOSTED, encoding: "utf8", windowsHide: true, maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout)[0]?.meta?.size_after ?? null;
  } catch {
    return null;
  }
}

async function seedLearners() {
  const statements = learners.flatMap((learner) => [
    `INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, created_at) VALUES (${sqlText(learner.accountId)}, 'google', ${sqlText(learner.providerSubject)}, ${sqlText(learner.email)}, 'Ticket 03 rehearsal', ${nowSeconds});`,
    `INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (${sqlText(learner.tokenHash)}, ${sqlText(learner.accountId)}, ${sqlText(learner.csrfHash)}, ${nowSeconds + 3600}, ${nowSeconds});`,
  ]);
  const directory = await mkdtemp(resolve(tmpdir(), "whitebook-ticket03-seed-"));
  const file = resolve(directory, "seed.sql");
  try {
    await writeFile(file, `${statements.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
    runWrangler(["d1", "execute", DATABASE, "--remote", "--file", file, "--yes"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const requests = [];
const cleanupResults = [];
const failureCodes = {};
const transportFailureKinds = { fetch: {}, body: {} };
const runChecks = { questionCountCreated: 0, timerChecksPassed: 0, takeoverChecksPassed: 0 };
let errorResponseLeakedSensitiveMaterial = false;
let answerMaterialLeakedByLearnerRead = false;
let d1Before = null;
let d1After = null;
let databaseBytesBefore = null;
let databaseBytesPeak = null;
async function call(learner, pathname, {
  method = "GET", body, expected = [200], parse = "json", phase = "load", operation = "learner request",
} = {}) {
  const headers = { Cookie: `__Host-wb_session=${learner.token}` };
  if (method !== "GET") {
    headers.Origin = origin.origin;
    headers["X-CSRF-Token"] = learner.csrf;
    if (body !== undefined) headers["Content-Type"] = "application/json";
  }
  const started = performance.now();
  let response;
  try {
    response = await fetch(new URL(pathname, origin), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual", signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const kind = error instanceof Error ? error.name : "unknown";
    transportFailureKinds.fetch[kind] = (transportFailureKinds.fetch[kind] || 0) + 1;
    if (phase === "load") requests.push({ status: "transport_error", elapsedMs: performance.now() - started, operation });
    const failure = new Error(`A staging request failed during ${phase}.`);
    failure.status = 0;
    throw failure;
  }
  const elapsedMs = performance.now() - started;
  const record = { status: response.status, elapsedMs, operation };
  if (phase === "load") {
    requests.push(record);
    learner.requestCount += 1;
  } else {
    cleanupResults.push(response.status);
  }
  if (!expected.includes(response.status)) {
    let code = "unclassified";
    try {
      const payload = await response.json();
      const responseJson = JSON.stringify(payload);
      if (/(acceptedAnswers|answerKeys?|correctAnswers?|sessionToken|csrfToken|editorToken|privateKey|secretKey)/i.test(responseJson) ||
          responseJson.includes(learner.token) || responseJson.includes(learner.csrf)) {
        errorResponseLeakedSensitiveMaterial = true;
        throw new Error("A staging error response included private answer or credential material.");
      }
      if (typeof payload?.error?.code === "string") code = payload.error.code;
    } catch (error) {
      if (error instanceof Error && error.message === "A staging error response included private answer or credential material.") throw error;
      /* The response body can be absent for a platform error. */
    }
    failureCodes[code] = (failureCodes[code] || 0) + 1;
    const error = new Error(`A staging ${operation} returned HTTP ${response.status} (${code}).`);
    error.status = response.status;
    throw error;
  }
  if (parse === "none") {
    await response.body?.cancel();
    return response;
  }
  try {
    if (parse === "text") return { response, text: await response.text() };
    if (parse === "bytes") {
      const bytes = await response.arrayBuffer();
      return bytes.byteLength;
    }
    return response.json();
  } catch (error) {
    const kind = error instanceof Error ? error.name : "unknown";
    transportFailureKinds.body[kind] = (transportFailureKinds.body[kind] || 0) + 1;
    record.status = "body_read_failed";
    if (error && typeof error === "object") error.status = 0;
    throw error;
  }
}

function assertNoAnswerMaterial(value) {
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (/^(acceptedAnswers|answerKey|answerKeys|correctAnswer|correctAnswers)$/i.test(key)) {
      answerMaterialLeakedByLearnerRead = true;
      throw new Error("An answer field appeared in a learner response.");
    }
    assertNoAnswerMaterial(child);
  }
}

function collectVisualPaths(value, revisionId, questionId, paths = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectVisualPaths(item, revisionId, questionId, paths);
  } else if (value && typeof value === "object") {
    const block = value;
    if (block.kind === "image_asset" && typeof block.assetId === "string" &&
        /^[a-f0-9]{64}$/.test(block.assetId)) {
      paths.add(`/content/${revisionId}/${questionId}/${block.assetId}.png`);
    }
    if (block.kind === "asset" && typeof block.src === "string") {
      try {
        const path = new URL(block.src, origin).pathname;
        if (path.startsWith("/content/")) paths.add(path);
      } catch { /* Ignore malformed presentation references. */ }
    }
    for (const child of Object.values(block)) collectVisualPaths(child, revisionId, questionId, paths);
  }
  return paths;
}

async function writeResponse(learner, attemptId, snapshot, editorToken, question) {
  const response = question.responseType === "multiple_choice"
    ? (question.choiceIds?.[0] || "A")
    : "0";
  return call(learner, `/api/attempts/${attemptId}/write`, {
    method: "POST",
    body: {
      expectedStateVersion: snapshot.stateVersion,
      editorToken,
      change: { type: "response", questionId: question.questionId, response },
    },
  });
}

async function runLearner(learner) {
  const account = await call(learner, "/api/account/me", { operation: "account session check" });
  assertNoAnswerMaterial(account);
  const library = await call(learner, "/api/library", { operation: "protected package library" });
  assertNoAnswerMaterial(library);
  if (!Array.isArray(library.packages) || library.packages.length !== 5) {
    throw new Error("The staging account did not receive the protected five-package Library.");
  }
  const selectedPackage = library.packages.find((item) => learner.section === "Math"
    ? /\bMath\b/i.test(item.title)
    : /R\s*&\s*W|Reading and Writing/i.test(item.title));
  if (!selectedPackage) throw new Error(`The protected Library has no ${learner.section} package.`);
  const created = await call(learner, "/api/attempts", {
    method: "POST",
    body: { revisionId: selectedPackage.revisionId, kind: "section_exam", section: learner.section },
    expected: [201],
    operation: `${learner.section} Section Exam creation`,
  });
  assertNoAnswerMaterial(created);
  const attemptId = created.attemptId;
  runChecks.questionCountCreated += created.questions.length;
  const expectedQuestionCount = learner.section === "Math" ? 44 : 54;
  if (created.questions?.length !== expectedQuestionCount) {
    throw new Error("The staging Section Exam did not contain the expected question count.");
  }

  const presentationRows = await mapLimited(created.questions, 1, (question) =>
    retryLoad(() => call(learner, `/api/library/${encodeURIComponent(selectedPackage.revisionId)}/questions/${encodeURIComponent(question.questionId)}`,
      { operation: "question presentation" })));
  presentationRows.forEach(assertNoAnswerMaterial);
  const visualPaths = new Set();
  presentationRows.forEach((row, index) => collectVisualPaths(
    row.presentation, selectedPackage.revisionId, created.questions[index].questionId, visualPaths,
  ));
  const visualResults = await mapLimited([...visualPaths], 1, (path) =>
    retryLoad(() => call(learner, path, { parse: "bytes", operation: "protected publication visual" })));
  if (visualResults.some((size) => size <= 0)) {
    throw new Error("A selected publication visual could not be loaded.");
  }

  const started = await call(learner, `/api/attempts/${attemptId}/start`, { method: "POST", body: {} });
  assertNoAnswerMaterial(started);
  const expectedMinutes = learner.section === "Math" ? 35 : 32;
  if (started.deadlineAt - started.startedAt !== expectedMinutes * 60_000) {
    throw new Error("The Section Exam deadline did not match the configured timer.");
  }
  runChecks.timerChecksPassed += 1;

  const readerSnapshot = await call(learner, `/api/attempts/${attemptId}`);
  assertNoAnswerMaterial(readerSnapshot);
  if (Object.hasOwn(readerSnapshot, "editorToken")) {
    throw new Error("The reader device received an editor token.");
  }
  const takenOver = await call(learner, `/api/attempts/${attemptId}/takeover`, {
    method: "POST", body: {}, operation: "cross-device takeover",
  });
  assertNoAnswerMaterial(takenOver);
  if (!takenOver.editorToken || takenOver.editorToken === started.editorToken) {
    throw new Error("Cross-device takeover did not rotate the editor token.");
  }
  runChecks.takeoverChecksPassed += 1;
  const editorToken = takenOver.editorToken;
  const stale = await call(learner, `/api/attempts/${attemptId}/write`, {
    method: "POST",
    body: {
      expectedStateVersion: started.stateVersion,
      editorToken: started.editorToken,
      change: { type: "response", questionId: created.questions[0].questionId, response: "A" },
    },
      expected: [409],
      parse: "text",
      operation: "stale-editor rejection",
  });
  if (/acceptedAnswers|answerKey|correctAnswer/i.test(stale.text) || stale.text.includes(started.editorToken)) {
    throw new Error("The stale-editor error response leaked private data.");
  }

  let snapshot = takenOver;
  for (const moduleNumber of [1, 2]) {
    for (const question of created.questions.filter((item) => item.module === moduleNumber)) {
      snapshot = await writeResponse(learner, attemptId, snapshot, editorToken, question);
      assertNoAnswerMaterial(snapshot);
    }
    if (moduleNumber === 1) {
      snapshot = await call(learner, `/api/attempts/${attemptId}/finish-module`, {
        method: "POST",
        body: { expectedStateVersion: snapshot.stateVersion, editorToken },
      });
      assertNoAnswerMaterial(snapshot);
      snapshot = await call(learner, `/api/attempts/${attemptId}/continue`, {
        method: "POST",
        body: { expectedStateVersion: snapshot.stateVersion, editorToken },
      });
      assertNoAnswerMaterial(snapshot);
    } else {
      // Closing the final Section Exam module returns grading detail to the
      // client. Discard its body without parsing or logging it.
      await call(learner, `/api/attempts/${attemptId}/finish-module`, {
        method: "POST",
        body: { expectedStateVersion: snapshot.stateVersion, editorToken },
        parse: "none",
      });
    }
  }
  const history = await call(learner, "/api/attempts");
  assertNoAnswerMaterial(history);
  if (!history.attempts?.some((item) => item.attemptId === attemptId && item.status === "completed")) {
    throw new Error("The staged Section Exam did not complete.");
  }
  return { section: learner.section, questionCount: expectedQuestionCount, visualCount: visualPaths.size };
}

function percentile(values, percentage) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return Number(sorted[Math.min(sorted.length - 1, Math.ceil(percentage * sorted.length) - 1)].toFixed(2));
}

async function deleteSyntheticAccounts() {
  for (const learner of learners) {
    try {
      await call(learner, "/api/account/delete", {
        method: "POST",
        body: { confirmation: "DELETE MY ACCOUNT" },
        expected: [204],
        parse: "none",
        phase: "cleanup",
      });
    } catch {
      cleanupResults.push("failed");
    }
  }
}

const startedAt = new Date().toISOString();
let journeys = [];
let runError = null;
try {
  databaseBytesBefore = readDatabaseSizeBytes();
  await seedLearners();
  d1Before = readD1Insights();
  const learnerResults = await Promise.allSettled(learners.map(runLearner));
  d1After = readD1Insights();
  databaseBytesPeak = readDatabaseSizeBytes();
  journeys = learnerResults.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
  const failedLearner = learnerResults.find((result) => result.status === "rejected");
  if (failedLearner) throw failedLearner.reason;
} catch (error) {
  runError = error instanceof Error ? error.message : "Staging rehearsal failed.";
} finally {
  await deleteSyntheticAccounts();
}

const timings = requests.map((item) => item.elapsedMs);
const statuses = requests.reduce((counts, item) => {
  counts[item.status] = (counts[item.status] || 0) + 1;
  return counts;
}, {});
const operationStatuses = requests.reduce((counts, item) => {
  const bucket = counts[item.operation] || (counts[item.operation] = {});
  bucket[item.status] = (bucket[item.status] || 0) + 1;
  return counts;
}, {});
const attemptsCreated = requests.filter((item) => item.operation.endsWith("Section Exam creation") && item.status === 201).length;
const presentationRequests = requests.filter((item) => item.operation === "question presentation");
const visualRequests = requests.filter((item) => item.operation === "protected publication visual");
const output = {
  startedAt,
  finishedAt: new Date().toISOString(),
  target: origin.origin,
  syntheticLearners: learnerCount,
  attemptsCompleted: journeys.length,
  attemptsCreated,
  completedSections: journeys.reduce((counts, item) => {
    counts[item.section] = (counts[item.section] || 0) + 1;
    return counts;
  }, {}),
  questionsInCreatedAttempts: runChecks.questionCountCreated,
  questionPresentationRequests: presentationRequests.length,
  questionPresentationsLoaded: presentationRequests.filter((item) => item.status === 200).length,
  visualFetches: visualRequests.length,
  visualFetchesSucceeded: visualRequests.filter((item) => item.status === 200).length,
  visualFetchesFailed: visualRequests.filter((item) => item.status >= 400).length,
  workerRequests: requests.length,
  workerRequestsPerLearner: Number((requests.length / learnerCount).toFixed(2)),
  workerRequestsPerAttempt: Number((requests.length / Math.max(1, attemptsCreated)).toFixed(2)),
  clientLatencyMs: {
    p50: percentile(timings, 0.50),
    p95: percentile(timings, 0.95),
    p99: percentile(timings, 0.99),
    max: Number((Math.max(0, ...timings)).toFixed(2)),
  },
  http5xxResponses: requests.filter((item) => item.status >= 500).length,
  http1102Responses: requests.filter((item) => item.status === 1102).length,
  statusCounts: statuses,
  statusCountsByOperation: operationStatuses,
  failureCodes,
  transportFailureKinds,
  d1UsageWindow: {
    rowsReadBefore: d1Before?.rowsRead ?? null,
    rowsReadAfter: d1After?.rowsRead ?? null,
    rowsReadDelta: d1Before && d1After ? d1After.rowsRead - d1Before.rowsRead : null,
    rowsWrittenBefore: d1Before?.rowsWritten ?? null,
    rowsWrittenAfter: d1After?.rowsWritten ?? null,
    rowsWrittenDelta: d1Before && d1After ? d1After.rowsWritten - d1Before.rowsWritten : null,
    queryPatternsBefore: d1Before?.queryPatterns ?? null,
    queryPatternsAfter: d1After?.queryPatterns ?? null,
    method: "Wrangler D1 Insights sums observed SQL fingerprints in its rolling 24-hour window.",
  },
  databaseBytesBefore,
  databaseBytesPeak,
  databaseBytesDelta: databaseBytesBefore !== null && databaseBytesPeak !== null
    ? databaseBytesPeak - databaseBytesBefore : null,
  answerMaterialLeakedByLearnerRead,
  errorResponseLeakedSensitiveMaterial,
  timerDurationChecksPassed: runChecks.timerChecksPassed,
  takeoverChecksPassed: runChecks.takeoverChecksPassed,
  syntheticAccountsDeleted: cleanupResults.filter((status) => status === 204).length,
  runError,
};
console.log(JSON.stringify(output, null, 2));
if (runError || output.attemptsCompleted !== learnerCount || output.syntheticAccountsDeleted !== learnerCount) {
  process.exitCode = 1;
}
