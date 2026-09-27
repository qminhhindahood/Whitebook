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
    presentation_json: JSON.stringify({ version: 1, stimulus: [], stem: [{ kind: "text", text: `Question ${n}` }], choices: [] }),
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
