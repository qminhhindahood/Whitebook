import { expect, it, vi } from "vitest";
import worker from "../src/worker";

const origin = "https://whitebook.test";
type Credential = { accountId: string; token: string; csrf: string };
type QuestionRow = {
  revision_id: string; question_id: string; ordinal: number; section: string;
  module: number; question_number: number; response_type: string; presentation_json: string;
};
type AttemptRow = {
  id: string; account_id: string; revision_id: string; kind: string; status: string;
  config_json: string; questions_json: string; state_json: string; state_version: number;
  created_at_ms: number; started_at_ms: number | null; deadline_at_ms: number | null;
  completed_at_ms: number | null; result_json: string | null;
  editor_token_hash: string | null; editor_lease_expires_at_ms: number | null;
};

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fixture() {
  const credentials: Credential[] = [
    { accountId: "learner-a", token: "a".repeat(64), csrf: "c".repeat(64) },
    { accountId: "learner-b", token: "b".repeat(64), csrf: "d".repeat(64) },
    { accountId: "learner-a", token: "e".repeat(64), csrf: "f".repeat(64) },
  ];
  const sessions = new Map<string, { token_hash: string; csrf_hash: string; account_id: string; expires_at: number }>();
  for (const item of credentials) sessions.set(await sha256(item.token), {
    token_hash: await sha256(item.token), csrf_hash: await sha256(item.csrf),
    account_id: item.accountId, expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  const questions: QuestionRow[] = [1, 2, 3].map((n) => ({
    revision_id: "reviewed-rw", question_id: `q${n}`, ordinal: n,
    section: "Reading and Writing", module: n === 3 ? 2 : 1,
    question_number: n, response_type: "multiple_choice",
    presentation_json: JSON.stringify({ version: 1, stimulus: [], stem: [{ kind: "text", text: `Question ${n}` }],
      choices: [{ id: "A", content: [] }, { id: "B", content: [] }] }),
  }));
  const answers = questions.map((question, index) => ({
    question_id: question.question_id,
    accepted_answers_json: JSON.stringify([index === 1 ? "A" : "B"]),
  }));
  const attempts = new Map<string, AttemptRow>();
  const publicRevisions = new Set(["reviewed-rw"]);
  const privateEntitlements = new Set(["learner-a:private-rw"]);
  const db = {
    async batch() { throw new Error("Unexpected D1 batch"); },
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first<T>() {
          if (sql.includes("FROM learner_sessions")) {
            const row = sessions.get(String(args[0]));
            return (row && row.expires_at > Number(args[1]) ? row : null) as T | null;
          }
          if (sql.includes("FROM package_revisions p WHERE p.id")) {
            const revisionId = String(args[0]);
            const accountId = String(args[1]);
            return (publicRevisions.has(revisionId) || privateEntitlements.has(`${accountId}:${revisionId}`)
              ? { id: revisionId } : null) as T | null;
          }
          if (sql.includes("FROM learner_attempts")) {
            const row = attempts.get(String(args[0]));
            return (row && row.account_id === String(args[1]) ? row : null) as T | null;
          }
          return null;
        },
        async all() {
          if (sql.includes("FROM publication_questions")) {
            const revisionId = String(args[0]);
            const section = String(args[1]);
            const modules = args.slice(2).map(Number);
            const rows = questions.filter((row) => row.revision_id === revisionId && row.section === section && modules.includes(row.module));
            return { results: rows, meta: { rows_read: rows.length, rows_written: 0 } };
          }
          if (sql.includes("FROM learner_attempts")) {
            const rows = [...attempts.values()].filter((row) => row.account_id === String(args[0]));
            return { results: rows, meta: { rows_read: rows.length, rows_written: 0 } };
          }
          if (sql.includes("FROM publication_answers")) {
            const revisionId = String(args[0]);
            return { results: answers.filter((answer) => questions.find((question) => question.question_id === answer.question_id)?.revision_id === revisionId), meta: { rows_read: answers.length, rows_written: 0 } };
          }
          return { results: [], meta: { rows_read: 0, rows_written: 0 } };
        },
        async run() {
          if (sql.includes("INSERT INTO learner_attempts")) {
            const [id, accountId, revisionId, configJson, questionsJson, stateJson, createdAt] = args;
            attempts.set(String(id), {
              id: String(id), account_id: String(accountId), revision_id: String(revisionId),
              kind: "practice", status: "preparing", config_json: String(configJson),
              questions_json: String(questionsJson), state_json: String(stateJson), state_version: 0,
              created_at_ms: Number(createdAt), started_at_ms: null, deadline_at_ms: null,
              completed_at_ms: null, result_json: null, editor_token_hash: null,
              editor_lease_expires_at_ms: null,
            });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("UPDATE learner_attempts SET state_json =")) {
            const [stateJson, leaseExpiry, id, accountId, expectedVersion, tokenHash, now] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion) || row.editor_token_hash !== String(tokenHash) ||
                row.editor_lease_expires_at_ms === null || row.editor_lease_expires_at_ms <= Number(now))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { state_json: String(stateJson), state_version: row.state_version + 1,
              editor_lease_expires_at_ms: Number(leaseExpiry) });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET state_version = state_version + 1, editor_lease_expires_at_ms")) {
            const [leaseExpiry, id, accountId, expectedVersion, tokenHash, now] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion) || row.editor_token_hash !== String(tokenHash) ||
                row.editor_lease_expires_at_ms === null || row.editor_lease_expires_at_ms <= Number(now))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { state_version: row.state_version + 1, editor_lease_expires_at_ms: Number(leaseExpiry) });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET editor_token_hash = ?, editor_lease_expires_at_ms = ?")) {
            const [tokenHash, leaseExpiry, id, accountId, expectedVersion] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { editor_token_hash: String(tokenHash), editor_lease_expires_at_ms: Number(leaseExpiry),
              state_version: row.state_version + 1 });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET status = 'completed'")) {
            const [completedAt, resultJson, id, accountId, expectedVersion, tokenHash, now] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion) || row.editor_token_hash !== String(tokenHash) ||
                row.editor_lease_expires_at_ms === null || row.editor_lease_expires_at_ms <= Number(now))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { status: "completed", completed_at_ms: Number(completedAt), result_json: String(resultJson),
              editor_token_hash: null, editor_lease_expires_at_ms: null, state_version: row.state_version + 1 });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("UPDATE learner_attempts SET status = 'active'")) {
            const [startedAt, deadlineAt, tokenHash, leaseExpiresAt, id, accountId] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "preparing")
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, {
              status: "active", started_at_ms: Number(startedAt),
              deadline_at_ms: deadlineAt === null ? null : Number(deadlineAt),
              editor_token_hash: String(tokenHash), editor_lease_expires_at_ms: Number(leaseExpiresAt),
              state_version: row.state_version + 1,
            });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          throw new Error(`Unexpected write: ${sql}`);
        },
      };
    },
  };
  const env = {
    APP_ORIGIN: origin,
    DB: db,
    ASSETS: { async fetch() { return new Response(null, { status: 404 }); } },
    STAGING_ACCESS_CODE: "test-only",
  };
  async function call(path: string, options: { method?: string; who?: Credential; body?: unknown; csrf?: boolean; origin?: string } = {}) {
    const method = options.method ?? "GET";
    const headers = new Headers();
    if (options.who) headers.set("Cookie", `__Host-wb_session=${options.who.token}`);
    if (method !== "GET") {
      headers.set("Content-Type", "application/json");
      headers.set("Origin", options.origin ?? origin);
      if (options.csrf !== false && options.who) headers.set("X-CSRF-Token", options.who.csrf);
    }
    return worker.fetch(new Request(`${origin}${path}`, {
      method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }), env as never);
  }
  return { env, credentials, attempts, call };
}

it("requires same-origin CSRF protection for Attempt creation", async () => {
  const { credentials, call } = await fixture();
  const response = await call("/api/attempts", {
    method: "POST", who: credentials[0], csrf: false,
    body: { revisionId: "reviewed-rw" },
  });

  expect(response.status).toBe(403);
  expect(await response.json()).toMatchObject({ error: { code: "invalid_csrf" } });
});

it("creates and lists a private Attempt from one entitled revision only", async () => {
  const { credentials, call } = await fixture();
  const createdResponse = await call("/api/attempts", {
    method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-rw", section: "Reading and Writing", modules: [1], count: 2, ordering: "source", timing: { mode: "elapsed" } },
  });

  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json() as { attemptId: string; revisionId: string; status: string; questionIds: string[]; stateVersion: number; startedAt: number | null; deadlineAt: number | null };
  expect(created).toMatchObject({
    revisionId: "reviewed-rw", status: "preparing", questionIds: ["q1", "q2"],
    stateVersion: 0, startedAt: null, deadlineAt: null,
  });
  expect(JSON.stringify(created)).not.toMatch(/acceptedAnswers|answerKey|sourcePdf|correctAnswer/);

  const accountAList = await call("/api/attempts", { who: credentials[0] });
  const accountBList = await call("/api/attempts", { who: credentials[1] });
  expect((await accountAList.json() as { attempts: unknown[] }).attempts).toHaveLength(1);
  expect((await accountBList.json() as { attempts: unknown[] }).attempts).toHaveLength(0);
  expect((await call(`/api/attempts/${created.attemptId}`, { who: credentials[1] })).status).toBe(404);
});

it("hides an unentitled revision when creating a Practice Attempt", async () => {
  const { credentials, call } = await fixture();
  const response = await call("/api/attempts", {
    method: "POST", who: credentials[1],
    body: { revisionId: "private-rw", section: "Reading and Writing", modules: [1], count: 1, ordering: "source", timing: { mode: "elapsed" } },
  });

  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: "not_found" } });
});

it("rejects counts that exceed the selected Section and Module pool", async () => {
  const { credentials, call } = await fixture();
  const response = await call("/api/attempts", {
    method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-rw", section: "Reading and Writing", modules: [1], count: 3, ordering: "source", timing: { mode: "elapsed" } },
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "invalid_attempt" } });
});

it("starts the server clock and editor lease only after the Loading Gate", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-27T01:00:00.000Z"));
  try {
    const { credentials, call } = await fixture();
    const preparing = await call("/api/attempts", {
      method: "POST", who: credentials[0],
      body: { revisionId: "reviewed-rw", section: "Reading and Writing", modules: [1], count: 1, ordering: "source", timing: { mode: "custom", durationSeconds: 300 } },
    });
    const attempt = await preparing.json() as { attemptId: string; status: string; startedAt: number | null; deadlineAt: number | null };
    expect(attempt).toMatchObject({ status: "preparing", startedAt: null, deadlineAt: null });

    const started = await call(`/api/attempts/${attempt.attemptId}/start`, { method: "POST", who: credentials[0], body: {} });
    expect(started.status).toBe(200);
    const result = await started.json() as { status: string; startedAt: number; deadlineAt: number; serverNow: number; editorToken: string };
    expect(result).toMatchObject({
      status: "active", startedAt: Date.now(), deadlineAt: Date.now() + 300_000, serverNow: Date.now(),
    });
    expect(result.editorToken).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(/acceptedAnswers|answerKey|correctAnswer/);
  } finally {
    vi.useRealTimers();
  }
});

async function startPractice(call: Awaited<ReturnType<typeof fixture>>["call"], who: Credential) {
  const created = await call("/api/attempts", {
    method: "POST", who,
    body: { revisionId: "reviewed-rw", section: "Reading and Writing", modules: [1], count: 2, ordering: "source", timing: { mode: "custom", durationSeconds: 600 } },
  });
  const preparing = await created.json() as { attemptId: string };
  const started = await call(`/api/attempts/${preparing.attemptId}/start`, { method: "POST", who, body: {} });
  return { attemptId: preparing.attemptId, started: await started.json() as { editorToken: string; stateVersion: number; deadlineAt: number } };
}

it("saves a response with a server version and renews the editor lease", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { attemptId, started } = await startPractice(call, credentials[0]);
    const saved = await call(`/api/attempts/${attemptId}/write`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion, change: { type: "response", questionId: "q1", response: "B" } },
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({ stateVersion: 2, saveStatus: "saved", state: { responses: { q1: "B" } }, lease: { expiresAt: Date.now() + 120_000 } });
  } finally {
    vi.useRealTimers();
  }
});

it("rejects response and elimination values that are not in the published presentation", async () => {
  const { credentials, call } = await fixture();
  const { attemptId, started } = await startPractice(call, credentials[0]);
  const invalidResponse = await call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
      change: { type: "response", questionId: "q1", response: "D" } },
  });
  expect(invalidResponse.status).toBe(400);
  expect(await invalidResponse.json()).toMatchObject({ error: { code: "invalid_attempt_change" } });

  const invalidElimination = await call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
      change: { type: "elimination", questionId: "q1", choiceId: "D", eliminated: true } },
  });
  expect(invalidElimination.status).toBe(400);
  const detail = await call(`/api/attempts/${attemptId}`, { who: credentials[0] });
  expect(await detail.json()).toMatchObject({ stateVersion: started.stateVersion, state: { responses: {}, eliminatedChoices: {} } });
});

it("persists valid published-choice elimination and question navigation", async () => {
  const { credentials, call } = await fixture();
  const { attemptId, started } = await startPractice(call, credentials[0]);
  const eliminated = await call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
      change: { type: "elimination", questionId: "q1", choiceId: "B", eliminated: true } },
  });
  expect(eliminated.status).toBe(200);
  const afterElimination = await eliminated.json() as { stateVersion: number };
  const navigated = await call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: afterElimination.stateVersion,
      change: { type: "navigation", questionId: "q2" } },
  });
  expect(navigated.status).toBe(200);
  expect(await navigated.json()).toMatchObject({ stateVersion: afterElimination.stateVersion + 1,
    state: { eliminatedChoices: { q1: ["B"] }, currentQuestionId: "q2" } });
});

it("renews the lease on heartbeat and requires explicit takeover after expiry", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { attemptId, started } = await startPractice(call, credentials[0]);
    vi.advanceTimersByTime(45_000);
    const heartbeat = await call(`/api/attempts/${attemptId}/heartbeat`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion },
    });
    expect(heartbeat.status).toBe(200);
    const renewed = await heartbeat.json() as { stateVersion: number; lease: { expiresAt: number } };
    expect(renewed).toMatchObject({ stateVersion: started.stateVersion + 1, lease: { expiresAt: Date.now() + 120_000 } });

    vi.advanceTimersByTime(121_000);
    const lateWrite = await call(`/api/attempts/${attemptId}/write`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: renewed.stateVersion, change: { type: "response", questionId: "q1", response: "B" } },
    });
    expect(lateWrite.status).toBe(409);
    expect(await lateWrite.json()).toMatchObject({ error: { code: "editor_lease_expired" } });

    const takeover = await call(`/api/attempts/${attemptId}/takeover`, { method: "POST", who: credentials[2], body: {} });
    expect(takeover.status).toBe(200);
    const acquired = await takeover.json() as { editorToken: string; stateVersion: number; deadlineAt: number };
    expect(acquired.editorToken).not.toBe(started.editorToken);
    expect(acquired.deadlineAt).toBe(started.deadlineAt);
  } finally {
    vi.useRealTimers();
  }
});

it("returns the latest state on takeover and rejects the old editor token", async () => {
  const { credentials, call } = await fixture();
  const { attemptId, started } = await startPractice(call, credentials[0]);
  const save = await call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion, change: { type: "response", questionId: "q1", response: "B" } },
  });
  const saved = await save.json() as { stateVersion: number };
  const takeover = await call(`/api/attempts/${attemptId}/takeover`, { method: "POST", who: credentials[2], body: {} });
  expect(takeover.status).toBe(200);
  const acquired = await takeover.json() as { editorToken: string; stateVersion: number; state: { responses: Record<string, string> }; deadlineAt: number };
  expect(acquired).toMatchObject({ stateVersion: saved.stateVersion + 1, state: { responses: { q1: "B" } }, deadlineAt: started.deadlineAt });

  const stale = await call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: acquired.stateVersion, change: { type: "response", questionId: "q1", response: "A" } },
  });
  expect(stale.status).toBe(409);
  expect(await stale.json()).toMatchObject({ error: { code: "editor_conflict" } });
});

it("allows only one write at a state version and preserves the race winner", async () => {
  const { credentials, call } = await fixture();
  const { attemptId, started } = await startPractice(call, credentials[0]);
  const bodies = ["A", "B"].map((response) => call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion, change: { type: "response", questionId: "q1", response } },
  }));
  const responses = await Promise.all(bodies);
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const winner = await Promise.resolve(responses.find((response) => response.status === 200)!.clone().json()) as { state: { responses: Record<string, string> } };
  const current = await call(`/api/attempts/${attemptId}`, { who: credentials[0] });
  expect(await current.json()).toMatchObject({ state: { responses: { q1: winner.state.responses.q1 } } });
});

it("grades from the published answer key only on submit and freezes completed responses", async () => {
  const { credentials, call } = await fixture();
  const { attemptId, started } = await startPractice(call, credentials[0]);
  const before = await call(`/api/attempts/${attemptId}/results`, { who: credentials[0] });
  expect(before.status).toBe(409);
  const saved = await call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion, change: { type: "response", questionId: "q1", response: "B" } },
  });
  const savedData = await saved.json() as { stateVersion: number };
  const submitted = await call(`/api/attempts/${attemptId}/submit`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: savedData.stateVersion },
  });
  expect(submitted.status).toBe(200);
  expect(await submitted.json()).toMatchObject({ status: "completed", result: { correctCount: 1, questionCount: 2, questions: [
    { questionId: "q1", response: "B", correct: true, acceptedAnswers: ["B"] },
    { questionId: "q2", response: null, correct: false, acceptedAnswers: ["A"] },
  ] } });

  const laterWrite = await call(`/api/attempts/${attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: savedData.stateVersion, change: { type: "response", questionId: "q1", response: "A" } },
  });
  expect(laterWrite.status).toBe(409);
  const reviewBefore = await call(`/api/attempts/${attemptId}/results`, { who: credentials[0] });
  const reviewAfter = await call(`/api/attempts/${attemptId}/results`, { who: credentials[0] });
  expect(await reviewAfter.json()).toEqual(await reviewBefore.json());
  expect(await call(`/api/attempts/${attemptId}/results`, { who: credentials[1] }).then((response) => response.status)).toBe(404);
});

it("completes a private two-device handoff with server-graded, unchanged Attempt history", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const owner = credentials[0];
    const otherLearner = credentials[1];
    const secondDevice = credentials[2];
    const { attemptId, started } = await startPractice(call, owner);
    const firstSave = await call(`/api/attempts/${attemptId}/write`, {
      method: "POST", who: owner,
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
        change: { type: "response", questionId: "q1", response: "B" } },
    });
    const firstSaved = await firstSave.json() as { stateVersion: number; deadlineAt: number };
    expect(firstSave.status).toBe(200);

    const privateRead = await call(`/api/attempts/${attemptId}`, { who: secondDevice });
    const privateReadText = await privateRead.text();
    const beforeTakeover = JSON.parse(privateReadText) as { state: { responses: Record<string, string> }; lease: { held: boolean }; deadlineAt: number };
    expect(beforeTakeover).toMatchObject({ state: { responses: { q1: "B" } }, lease: { held: true }, deadlineAt: started.deadlineAt });
    expect(privateReadText).not.toMatch(/acceptedAnswers|answerKey|correctAnswer/);

    const secondLearnerRead = await call(`/api/attempts/${attemptId}`, { who: otherLearner });
    expect(secondLearnerRead.status).toBe(404);
    const deniedSubmit = await call(`/api/attempts/${attemptId}/submit`, {
      method: "POST", who: otherLearner,
      body: { editorToken: started.editorToken, expectedStateVersion: firstSaved.stateVersion },
    });
    expect(deniedSubmit.status).toBe(404);

    const takeover = await call(`/api/attempts/${attemptId}/takeover`, { method: "POST", who: secondDevice, body: {} });
    expect(takeover.status).toBe(200);
    const deviceB = await takeover.json() as { editorToken: string; stateVersion: number; state: { responses: Record<string, string> }; deadlineAt: number };
    expect(deviceB).toMatchObject({ stateVersion: firstSaved.stateVersion + 1,
      state: { responses: { q1: "B" } }, deadlineAt: started.deadlineAt });

    const staleWrite = await call(`/api/attempts/${attemptId}/write`, {
      method: "POST", who: owner,
      body: { editorToken: started.editorToken, expectedStateVersion: deviceB.stateVersion,
        change: { type: "response", questionId: "q1", response: "A" } },
    });
    expect(staleWrite.status).toBe(409);
    expect(await staleWrite.json()).toMatchObject({ error: { code: "editor_conflict" } });

    const secondSave = await call(`/api/attempts/${attemptId}/write`, {
      method: "POST", who: secondDevice,
      body: { editorToken: deviceB.editorToken, expectedStateVersion: deviceB.stateVersion,
        change: { type: "mark", questionId: "q2", marked: true } },
    });
    expect(secondSave.status).toBe(200);
    const marked = await secondSave.json() as { stateVersion: number };
    const submit = await call(`/api/attempts/${attemptId}/submit`, {
      method: "POST", who: secondDevice,
      body: { editorToken: deviceB.editorToken, expectedStateVersion: marked.stateVersion },
    });
    expect(submit.status).toBe(200);
    const completed = await submit.json() as { state: { responses: Record<string, string>; markedQuestionIds: string[] }; completedAt: number; deadlineAt: number; result: unknown };
    expect(completed).toMatchObject({ state: { responses: { q1: "B" }, markedQuestionIds: ["q2"] },
      completedAt: Date.now(), deadlineAt: started.deadlineAt,
      result: { correctCount: 1, questionCount: 2 } });

    const historyFirst = await call(`/api/attempts/${attemptId}`, { who: owner });
    const historySecond = await call(`/api/attempts/${attemptId}`, { who: owner });
    const firstHistory = await historyFirst.json();
    const secondHistory = await historySecond.json();
    expect(secondHistory).toEqual(firstHistory);
    expect(firstHistory).toMatchObject({ status: "completed", completedAt: Date.now(), deadlineAt: started.deadlineAt,
      state: { responses: { q1: "B" }, markedQuestionIds: ["q2"] } });
    const accountBList = await call("/api/attempts", { who: otherLearner });
    expect((await accountBList.json() as { attempts: unknown[] }).attempts).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
