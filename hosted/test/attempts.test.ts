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
  completed_at_ms: number | null; result_json: string | null; answers_exposed_at_ms: number | null; assisted_at_ms: number | null;
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
  const practiceQuestions: QuestionRow[] = [1, 2, 3].map((n) => ({
    revision_id: "reviewed-rw", question_id: `q${n}`, ordinal: n,
    section: "Reading and Writing", module: n === 3 ? 2 : 1,
    question_number: n, response_type: "multiple_choice",
    presentation_json: JSON.stringify({ version: 1, stimulus: [], stem: [{ kind: "text", text: `Question ${n}` }],
      choices: [{ id: "A", content: [] }, { id: "B", content: [] }] }),
  }));
  const sectionExamQuestions: QuestionRow[] = [
    ...Array.from({ length: 44 }, (_, index) => ({
      revision_id: "reviewed-math", question_id: `math-q${index + 1}`, ordinal: index + 1,
      section: "Math" as const, module: 1, question_number: index + 1, response_type: "multiple_choice",
      presentation_json: JSON.stringify({ version: 1, stimulus: [], stem: [{ kind: "text", text: `Math question ${index + 1}` }],
        choices: [{ id: "A", content: [] }, { id: "B", content: [] }] }),
    })),
    ...Array.from({ length: 54 }, (_, index) => ({
      revision_id: "reviewed-math", question_id: `cross-rw-q${index + 1}`, ordinal: index + 45,
      section: "Reading and Writing" as const, module: 2, question_number: index + 1, response_type: "multiple_choice",
      presentation_json: JSON.stringify({ version: 1, stimulus: [], stem: [{ kind: "text", text: `Other Section question ${index + 1}` }],
        choices: [{ id: "A", content: [] }, { id: "B", content: [] }] }),
    })),
    ...Array.from({ length: 54 }, (_, index) => ({
      revision_id: "reviewed-rw-exam", question_id: `rw-exam-q${index + 1}`, ordinal: index + 1,
      section: "Reading and Writing" as const, module: 2, question_number: index + 1, response_type: "multiple_choice",
      presentation_json: JSON.stringify({ version: 1, stimulus: [], stem: [{ kind: "text", text: `Reading question ${index + 1}` }],
        choices: [{ id: "A", content: [] }, { id: "B", content: [] }] }),
    })),
    ...Array.from({ length: 43 }, (_, index) => ({
      revision_id: "reviewed-short-math", question_id: `short-math-q${index + 1}`, ordinal: index + 1,
      section: "Math" as const, module: 1, question_number: index + 1, response_type: "multiple_choice",
      presentation_json: JSON.stringify({ version: 1, stimulus: [], stem: [{ kind: "text", text: `Short pool question ${index + 1}` }],
        choices: [{ id: "A", content: [] }, { id: "B", content: [] }] }),
    })),
    ...Array.from({ length: 44 }, (_, index) => ({
      revision_id: "reviewed-duplicate-math", question_id: `duplicate-math-q${Math.min(index + 1, 43)}`, ordinal: index + 1,
      section: "Math" as const, module: 1, question_number: index + 1, response_type: "multiple_choice",
      presentation_json: JSON.stringify({ version: 1, stimulus: [], stem: [{ kind: "text", text: `Duplicate pool question ${index + 1}` }],
        choices: [{ id: "A", content: [] }, { id: "B", content: [] }] }),
    })),
  ];
  const questions: QuestionRow[] = [...practiceQuestions, ...sectionExamQuestions];
  const categories = new Map([
    ["reviewed-rw:q1", "Grammar"], ["reviewed-rw:q2", "Vocabulary"],
    ["reviewed-rw:q3", "Grammar"],
  ]);
  const answers = questions.map((question, index) => ({
    question_id: question.question_id,
    accepted_answers_json: JSON.stringify([index === 1 ? "A" : "B"]),
  }));
  const attempts = new Map<string, AttemptRow>();
  const requestMeasurements: { method: string; path: string; rowsWritten: number }[] = [];
  const publicRevisions = new Set(["reviewed-rw", "reviewed-math", "reviewed-rw-exam", "reviewed-short-math", "reviewed-duplicate-math"]);
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
          if (sql.includes("FROM publication_question_categories")) {
            const revisionId = String(args[0]);
            return { results: [...categories].filter(([key]) => key.startsWith(`${revisionId}:`))
              .map(([key, category]) => ({ question_id: key.slice(revisionId.length + 1), category })),
              meta: { rows_read: categories.size, rows_written: 0 } };
          }
          if (sql.includes("FROM publication_questions")) {
            const revisionId = String(args[0]);
            const section = String(args[1]);
            const modules = args.slice(2).map(Number);
            const filtersModules = sql.includes("module IN (");
            const rows = questions.filter((row) => row.revision_id === revisionId && row.section === section &&
              (!filtersModules || modules.includes(row.module)));
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
          if (sql.includes("SET assisted_at_ms = ?")) {
            const [at, id, accountId] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.kind !== "practice" || row.status !== "active" || row.assisted_at_ms !== null)
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            row.assisted_at_ms = Number(at);
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET answers_exposed_at_ms = ?")) {
            const [at, id, accountId] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "completed" || row.answers_exposed_at_ms !== null)
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            row.answers_exposed_at_ms = Number(at);
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("INSERT INTO learner_attempts")) {
            const [id, accountId, revisionId, kind, configJson, questionsJson, stateJson, createdAt] = args;
            attempts.set(String(id), {
              id: String(id), account_id: String(accountId), revision_id: String(revisionId),
              kind: String(kind), status: "preparing", config_json: String(configJson),
              questions_json: String(questionsJson), state_json: String(stateJson), state_version: 0,
              created_at_ms: Number(createdAt), started_at_ms: null, deadline_at_ms: null,
              completed_at_ms: null, result_json: null, answers_exposed_at_ms: null, editor_token_hash: null,
              editor_lease_expires_at_ms: null, assisted_at_ms: null,
            });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET state_json = ?, deadline_at_ms = ?")) {
            const [stateJson, deadlineAt, leaseExpiry, id, accountId, expectedVersion, tokenHash, now, oldDeadline] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion) || row.editor_token_hash !== String(tokenHash) ||
                row.editor_lease_expires_at_ms === null || row.editor_lease_expires_at_ms <= Number(now) ||
                row.deadline_at_ms !== (oldDeadline === null ? null : Number(oldDeadline)))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { state_json: String(stateJson), deadline_at_ms: deadlineAt === null ? null : Number(deadlineAt),
              editor_lease_expires_at_ms: Number(leaseExpiry), state_version: row.state_version + 1 });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET state_json = ?, deadline_at_ms = NULL")) {
            const [stateJson, id, accountId, expectedVersion, oldDeadline] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion) || row.deadline_at_ms !== Number(oldDeadline))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { state_json: String(stateJson), deadline_at_ms: null, state_version: row.state_version + 1 });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET status = 'completed', state_json = ?") && sql.includes("deadline_at_ms = NULL")) {
            const [stateJson, completedAt, resultJson, exposedAt, id, accountId, expectedVersion, oldDeadline] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion) || row.deadline_at_ms !== Number(oldDeadline))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { status: "completed", state_json: String(stateJson), deadline_at_ms: null,
              completed_at_ms: Number(completedAt), result_json: String(resultJson),
              answers_exposed_at_ms: exposedAt === null ? null : Number(exposedAt), editor_token_hash: null,
              editor_lease_expires_at_ms: null, state_version: row.state_version + 1 });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET state_json = ?, state_version = state_version + 1, editor_lease_expires_at_ms")) {
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
          if (sql.includes("SET state_json = ?, editor_token_hash = ?, editor_lease_expires_at_ms = ?")) {
            const [stateJson, tokenHash, leaseExpiry, id, accountId, expectedVersion] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { state_json: String(stateJson), editor_token_hash: String(tokenHash), editor_lease_expires_at_ms: Number(leaseExpiry),
              state_version: row.state_version + 1 });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET status = 'completed'")) {
            const [stateJson, completedAt, exposedAt, resultJson, id, accountId, expectedVersion, tokenHash, now] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "active" ||
                row.state_version !== Number(expectedVersion) || row.editor_token_hash !== String(tokenHash) ||
                row.editor_lease_expires_at_ms === null || row.editor_lease_expires_at_ms <= Number(now))
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, { status: "completed", state_json: String(stateJson), completed_at_ms: Number(completedAt),
              answers_exposed_at_ms: Number(exposedAt), result_json: String(resultJson),
              editor_token_hash: null, editor_lease_expires_at_ms: null, state_version: row.state_version + 1 });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.includes("SET state_json = ?, status = 'active'")) {
            const [stateJson, startedAt, deadlineAt, tokenHash, leaseExpiresAt, id, accountId] = args;
            const row = attempts.get(String(id));
            if (!row || row.account_id !== String(accountId) || row.status !== "preparing")
              return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            Object.assign(row, {
              state_json: String(stateJson),
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
    const before = new Map([...attempts].map(([id, row]) => [id, JSON.stringify(row)]));
    const response = await worker.fetch(new Request(`${origin}${path}`, {
      method, headers, ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }), env as never);
    let rowsWritten = 0;
    for (const [id, row] of attempts)
      if (before.get(id) !== JSON.stringify(row)) rowsWritten++;
    requestMeasurements.push({ method, path, rowsWritten });
    return response;
  }
  return { env, credentials, attempts, requestMeasurements, call };
}

it.each([
  ["Math", "reviewed-math", 44, 22],
  ["Reading and Writing", "reviewed-rw-exam", 54, 27],
] as const)("creates a %s Section Exam with two unique generated Modules", async (section, revisionId, total, perModule) => {
  const { credentials, call } = await fixture();
  const response = await call("/api/attempts", {
    method: "POST", who: credentials[0],
    body: { revisionId, kind: "section_exam", section },
  });

  expect(response.status).toBe(201);
  const created = await response.json() as {
    kind: string; status: string; questions: { questionId: string; module: number }[];
    state: Record<string, unknown>;
  };
  expect(created).toMatchObject({ kind: "section_exam", status: "preparing" });
  expect(created.questions).toHaveLength(total);
  expect(new Set(created.questions.map((question) => question.questionId)).size).toBe(total);
  expect(created.questions.filter((question) => question.module === 1)).toHaveLength(perModule);
  expect(created.questions.filter((question) => question.module === 2)).toHaveLength(perModule);
  expect(created.state).toMatchObject({ phase: "module", activeModule: 1, lockedModules: [] });
  expect(JSON.stringify(created)).not.toMatch(/acceptedAnswers|answerKey|correctAnswer/);
});

it("allows later Section Exam Attempts to select questions used by an earlier Attempt", async () => {
  const { credentials, call } = await fixture();
  const create = () => call("/api/attempts", {
    method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-math", kind: "section_exam", section: "Math" },
  });
  const firstResponse = await create();
  const secondResponse = await create();
  expect(firstResponse.status).toBe(201);
  expect(secondResponse.status).toBe(201);
  const first = await firstResponse.json() as { questionIds: string[] };
  const second = await secondResponse.json() as { questionIds: string[] };
  expect(new Set(first.questionIds)).toEqual(new Set(second.questionIds));
});

it("rejects unsupported Section Exam Sections with an actionable validation error", async () => {
  const { credentials, attempts, call } = await fixture();
  const response = await call("/api/attempts", {
    method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-math", kind: "section_exam", section: "Science" },
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { message: expect.stringMatching(/supported Section/i) } });
  expect(attempts.size).toBe(0);
});

it("rejects a Section Exam pool below the required question count", async () => {
  const { credentials, attempts, call } = await fixture();
  const response = await call("/api/attempts", {
    method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-short-math", kind: "section_exam", section: "Math" },
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { message: expect.stringMatching(/44.*question|question.*44/i) } });
  expect(attempts.size).toBe(0);
});

it("rejects a Section Exam pool whose rows repeat question identities", async () => {
  const { credentials, attempts, call } = await fixture();
  const response = await call("/api/attempts", {
    method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-duplicate-math", kind: "section_exam", section: "Math" },
  });

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { message: expect.stringMatching(/44.*question|question.*44/i) } });
  expect(attempts.size).toBe(0);
});

it("checks package entitlement before creating a Section Exam", async () => {
  const { credentials, attempts, call } = await fixture();
  const response = await call("/api/attempts", {
    method: "POST", who: credentials[1],
    body: { revisionId: "private-rw", kind: "section_exam", section: "Reading and Writing" },
  });

  expect(response.status).toBe(404);
  expect(attempts.size).toBe(0);
});

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

it("filters Practice questions by a published category and retains it for resume and History", async () => {
  const { credentials, call } = await fixture();
  const response = await call("/api/attempts", { method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-rw", section: "Reading and Writing", modules: [1, 2],
      count: 2, ordering: "source", timing: { mode: "elapsed" }, category: "Grammar" } });
  expect(response.status).toBe(201);
  const created = await response.json() as { attemptId: string; category: string; questionIds: string[] };
  expect(created).toMatchObject({ category: "Grammar", questionIds: ["q1", "q3"] });
  const resumed = await call(`/api/attempts/${created.attemptId}`, { who: credentials[0] });
  expect(await resumed.json()).toMatchObject({ category: "Grammar", questionIds: ["q1", "q3"] });
  const history = await call("/api/attempts", { who: credentials[0] });
  expect(await history.json()).toMatchObject({ attempts: [{ category: "Grammar", questionCount: 2 }] });
});

it("rejects a category absent from published metadata without creating an Attempt", async () => {
  const { credentials, call, attempts } = await fixture();
  const response = await call("/api/attempts", { method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-math", section: "Math", modules: [1], count: 1,
      ordering: "source", timing: { mode: "elapsed" }, category: "Algebra" } });
  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({ error: { code: "invalid_attempt", message: expect.stringMatching(/category/i) } });
  const unknown = await call("/api/attempts", { method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-rw", section: "Reading and Writing", modules: [1], count: 1,
      ordering: "source", timing: { mode: "elapsed" }, category: "Invented" } });
  expect(unknown.status).toBe(400);
  expect(await unknown.json()).toMatchObject({ error: { message: expect.stringMatching(/published Question Category/i) } });
  expect(attempts.size).toBe(0);
});

it("keeps unfiltered Practice available when the revision has no category metadata", async () => {
  const { credentials, call } = await fixture();
  const response = await call("/api/attempts", { method: "POST", who: credentials[0],
    body: { revisionId: "reviewed-math", section: "Math", modules: [1], count: 2,
      ordering: "source", timing: { mode: "elapsed" } } });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ category: null, questionIds: ["math-q1", "math-q2"] });
});

it("reports zero eligible questions and insufficient filtered counts", async () => {
  const { credentials, call, attempts } = await fixture();
  const base = { revisionId: "reviewed-rw", section: "Reading and Writing", ordering: "source",
    timing: { mode: "elapsed" }, category: "Vocabulary" };
  const empty = await call("/api/attempts", { method: "POST", who: credentials[0],
    body: { ...base, modules: [2], count: 1 } });
  expect(empty.status).toBe(400);
  expect(await empty.json()).toMatchObject({ error: { message: expect.stringMatching(/no.*questions/i) } });
  const short = await call("/api/attempts", { method: "POST", who: credentials[0],
    body: { ...base, modules: [1, 2], count: 2 } });
  expect(short.status).toBe(400);
  expect(await short.json()).toMatchObject({ error: { message: expect.stringMatching(/only 1.*category/i) } });
  expect(attempts.size).toBe(0);
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

it("classifies the whole active Practice Attempt once and cannot reverse Assisted status", async () => {
  const { credentials, attempts, requestMeasurements, call } = await fixture();
  const who = credentials[0];
  const { attemptId } = await startPractice(call, who);
  const deniedOwner = await call(`/api/attempts/${attemptId}/assisted`, { method: "POST", who: credentials[1], body: {} });
  expect(deniedOwner.status).toBe(404);

  const first = await call(`/api/attempts/${attemptId}/assisted`, { method: "POST", who, body: {} });
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({ attemptId, assisted: true, status: "active" });
  const firstTimestamp = attempts.get(attemptId)!.assisted_at_ms;
  expect(firstTimestamp).not.toBeNull();
  expect(requestMeasurements.at(-1)?.rowsWritten).toBe(1);

  const repeated = await call(`/api/attempts/${attemptId}/assisted`, { method: "POST", who, body: { assisted: false } });
  expect(repeated.status).toBe(200);
  expect(await repeated.json()).toMatchObject({ attemptId, assisted: true });
  expect(attempts.get(attemptId)!.assisted_at_ms).toBe(firstTimestamp);
  expect(requestMeasurements.at(-1)?.rowsWritten).toBe(0);
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

type SectionExamResponse = {
  attemptId: string;
  kind: string;
  status: string;
  stateVersion: number;
  deadlineAt: number | null;
  startedAt: number | null;
  serverNow: number;
  editorToken?: string;
  questions: { questionId: string; module: number }[];
  state: {
    phase: string;
    activeModule: number;
    lockedModules: number[];
    responses: Record<string, string>;
    currentQuestionId: string;
    remainingSeconds: number | null;
    pausedPhase: string | null;
    questionElapsedMs: Record<string, number>;
    calculatorState?: Record<string, unknown> | null;
  };
  result?: { correctCount: number; questionCount: number };
};

async function startSectionExam(
  call: Awaited<ReturnType<typeof fixture>>["call"],
  who: Credential,
  section: "Math" | "Reading and Writing" = "Math",
  revisionId = section === "Math" ? "reviewed-math" : "reviewed-rw-exam",
) {
  const created = await call("/api/attempts", {
    method: "POST", who, body: { revisionId, kind: "section_exam", section },
  });
  const preparing = await created.json() as SectionExamResponse;
  const startedResponse = await call(`/api/attempts/${preparing.attemptId}/start`, { method: "POST", who, body: {} });
  return { preparing, response: startedResponse, started: await startedResponse.json() as SectionExamResponse };
}

it.each([
  ["Math", "reviewed-math", 35],
  ["Reading and Writing", "reviewed-rw-exam", 32],
] as const)("starts a %s Section Exam Module with its fixed server deadline", async (section, revisionId, minutes) => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { response, started } = await startSectionExam(call, credentials[0], section, revisionId);
    expect(response.status).toBe(200);
    expect(started).toMatchObject({ kind: "section_exam", status: "active", startedAt: Date.now(),
      deadlineAt: Date.now() + minutes * 60_000, serverNow: Date.now(),
      state: { phase: "module", activeModule: 1, lockedModules: [] } });
  } finally {
    vi.useRealTimers();
  }
});

it("locks Module 1 at an untimed transition and starts Module 2 only on explicit continue", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { started } = await startSectionExam(call, credentials[0]);
    const finished = await call(`/api/attempts/${started.attemptId}/finish-module`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion },
    });
    expect(finished.status).toBe(200);
    const transition = await finished.json() as SectionExamResponse;
    expect(transition).toMatchObject({ status: "active", deadlineAt: null,
      state: { phase: "transition", activeModule: 1, lockedModules: [1] } });
    expect(transition.state).not.toHaveProperty("breakRemaining");
    expect(await call(`/api/attempts/${started.attemptId}/results`, { who: credentials[0] }).then((r) => r.status)).toBe(409);

    const continued = await call(`/api/attempts/${started.attemptId}/continue`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: transition.stateVersion },
    });
    expect(continued.status).toBe(200);
    const module2 = await continued.json() as SectionExamResponse;
    expect(module2).toMatchObject({ deadlineAt: Date.now() + 35 * 60_000,
      state: { phase: "module", activeModule: 2, lockedModules: [1] } });
    expect(module2.questions.find((question) => question.questionId === module2.state.currentQuestionId)?.module).toBe(2);

    const lateModule1Write = await call(`/api/attempts/${started.attemptId}/write`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: module2.stateVersion,
        change: { type: "response", questionId: started.questions[0].questionId, response: "A" } },
    });
    expect(lateModule1Write.status).toBe(400);
    expect(await lateModule1Write.json()).toMatchObject({ error: { code: "invalid_attempt_change" } });
  } finally {
    vi.useRealTimers();
  }
});

it("grades and exposes Results only after Module 2 closes", async () => {
  const { credentials, call } = await fixture();
  const { started } = await startSectionExam(call, credentials[0]);
  const finished1 = await call(`/api/attempts/${started.attemptId}/finish-module`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion },
  });
  const transition = await finished1.json() as SectionExamResponse;
  const continued = await call(`/api/attempts/${started.attemptId}/continue`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: transition.stateVersion },
  });
  const module2 = await continued.json() as SectionExamResponse;
  const finished2 = await call(`/api/attempts/${started.attemptId}/finish-module`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: module2.stateVersion },
  });

  expect(finished2.status).toBe(200);
  expect(await finished2.json()).toMatchObject({ status: "completed", deadlineAt: null,
    state: { activeModule: 2, lockedModules: [1, 2] }, result: { correctCount: 0, questionCount: 44 } });
  const results = await call(`/api/attempts/${started.attemptId}/results`, { who: credentials[0] });
  expect(results.status).toBe(200);
  expect(await results.json()).toMatchObject({ status: "completed", result: { questionCount: 44 } });
});

it("measures a complete Worker Section Exam lifecycle by request and changed Attempt rows", async () => {
  const { credentials, call, requestMeasurements } = await fixture();
  const { preparing, started } = await startSectionExam(call, credentials[0], "Math");
  const question = started.questions[0];
  const activeSnapshot = await call(`/api/attempts/${started.attemptId}`, { who: credentials[0] });
  expect(activeSnapshot.status).toBe(200);
  expect(JSON.stringify(await activeSnapshot.json())).not.toMatch(/acceptedAnswers|answerKey|correctAnswer/);

  const write = await call(`/api/attempts/${started.attemptId}/write`, { method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
      change: { type: "response", questionId: question.questionId, response: "A" } } });
  const saved = await write.json() as SectionExamResponse;
  const heartbeat = await call(`/api/attempts/${started.attemptId}/heartbeat`, { method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: saved.stateVersion } });
  const beat = await heartbeat.json() as SectionExamResponse;
  const finish1 = await call(`/api/attempts/${started.attemptId}/finish-module`, { method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: beat.stateVersion } });
  const transition = await finish1.json() as SectionExamResponse;
  const continue2 = await call(`/api/attempts/${started.attemptId}/continue`, { method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: transition.stateVersion } });
  const module2 = await continue2.json() as SectionExamResponse;
  const finish2 = await call(`/api/attempts/${started.attemptId}/finish-module`, { method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: module2.stateVersion } });
  expect(finish2.status).toBe(200);
  expect((await finish2.json()).status).toBe("completed");
  expect((await call(`/api/attempts/${started.attemptId}/results`, { who: credentials[0] })).status).toBe(200);
  expect((await call("/api/attempts", { who: credentials[0] })).status).toBe(200);

  const attemptRequests = requestMeasurements.filter((item) => item.path.includes(started.attemptId) || item.path === "/api/attempts");
  expect(attemptRequests).toHaveLength(10);
  expect(attemptRequests.reduce((sum, item) => sum + item.rowsWritten, 0)).toBe(7);
  expect(attemptRequests.filter((item) => item.rowsWritten > 0)).toHaveLength(7);
  expect(preparing.questions).toHaveLength(44);
});

it("enforces an expired Module 1 deadline on snapshot reads exactly once", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { started } = await startSectionExam(call, credentials[0]);
    vi.advanceTimersByTime(35 * 60_000);
    const first = await call(`/api/attempts/${started.attemptId}`, { who: credentials[0] });
    const transition = await first.json() as SectionExamResponse;
    expect(transition).toMatchObject({ status: "active", deadlineAt: null,
      state: { phase: "transition", activeModule: 1, lockedModules: [1] } });
    const second = await call(`/api/attempts/${started.attemptId}`, { who: credentials[0] });
    expect(await second.json()).toMatchObject({ stateVersion: transition.stateVersion, state: transition.state });
  } finally {
    vi.useRealTimers();
  }
});

it("completes and grades Module 2 when a Results read observes its expired deadline", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { started } = await startSectionExam(call, credentials[0]);
    const finished = await call(`/api/attempts/${started.attemptId}/finish-module`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion },
    });
    const transition = await finished.json() as SectionExamResponse;
    const continued = await call(`/api/attempts/${started.attemptId}/continue`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: transition.stateVersion },
    });
    const module2 = await continued.json() as SectionExamResponse;
    vi.setSystemTime(module2.deadlineAt!);
    const results = await call(`/api/attempts/${started.attemptId}/results`, { who: credentials[0] });
    expect(results.status).toBe(200);
    expect(await results.json()).toMatchObject({ status: "completed", completedAt: module2.deadlineAt,
      result: { correctCount: 0, questionCount: 44 } });
  } finally {
    vi.useRealTimers();
  }
});

it("pauses with server-computed whole seconds and resumes from a fresh deadline", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { started } = await startSectionExam(call, credentials[0]);
    vi.advanceTimersByTime(50_000);
    const pausedResponse = await call(`/api/attempts/${started.attemptId}/pause`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion },
    });
    expect(pausedResponse.status).toBe(200);
    const paused = await pausedResponse.json() as SectionExamResponse;
    expect(paused).toMatchObject({ deadlineAt: null,
      state: { phase: "paused", activeModule: 1, pausedPhase: "module", remainingSeconds: 2050 } });
    vi.advanceTimersByTime(20_000);
    const resumedResponse = await call(`/api/attempts/${started.attemptId}/resume`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: paused.stateVersion },
    });
    expect(resumedResponse.status).toBe(200);
    expect(await resumedResponse.json()).toMatchObject({ deadlineAt: Date.now() + 2050_000,
      state: { phase: "module", activeModule: 1, pausedPhase: null, remainingSeconds: null } });
  } finally {
    vi.useRealTimers();
  }
});

it("preserves an untimed transition through pause and resume", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { started } = await startSectionExam(call, credentials[0]);
    const finished = await call(`/api/attempts/${started.attemptId}/finish-module`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion },
    });
    const transition = await finished.json() as SectionExamResponse;
    const pausedResponse = await call(`/api/attempts/${started.attemptId}/pause`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: transition.stateVersion },
    });
    const paused = await pausedResponse.json() as SectionExamResponse;
    expect(paused).toMatchObject({ deadlineAt: null,
      state: { phase: "paused", pausedPhase: "transition", remainingSeconds: null } });
    vi.advanceTimersByTime(10 * 60_000);
    const takeoverResponse = await call(`/api/attempts/${started.attemptId}/takeover`, {
      method: "POST", who: credentials[2], body: {},
    });
    const takeover = await takeoverResponse.json() as SectionExamResponse;
    expect(takeoverResponse.status).toBe(200);
    const resumed = await call(`/api/attempts/${started.attemptId}/resume`, {
      method: "POST", who: credentials[2],
      body: { editorToken: takeover.editorToken, expectedStateVersion: takeover.stateVersion },
    });
    expect(await resumed.json()).toMatchObject({ deadlineAt: null,
      state: { phase: "transition", activeModule: 1, lockedModules: [1] } });
  } finally {
    vi.useRealTimers();
  }
});

it("transfers a running Section Exam without changing its deadline or accepting the stale token", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { started } = await startSectionExam(call, credentials[0]);
    vi.advanceTimersByTime(45_000);
    const takeover = await call(`/api/attempts/${started.attemptId}/takeover`, {
      method: "POST", who: credentials[2], body: {},
    });
    expect(takeover.status).toBe(200);
    const acquired = await takeover.json() as SectionExamResponse;
    expect(acquired.deadlineAt).toBe(started.deadlineAt);
    expect(acquired.editorToken).not.toBe(started.editorToken);
    const staleWrite = await call(`/api/attempts/${started.attemptId}/write`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: acquired.stateVersion,
        change: { type: "response", questionId: started.questions[0].questionId, response: "A" } },
    });
    expect(staleWrite.status).toBe(409);
    const latest = await call(`/api/attempts/${started.attemptId}`, { who: credentials[2] });
    expect(await latest.json()).toMatchObject({ deadlineAt: started.deadlineAt, state: { responses: {} } });
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a response arriving at the deadline and applies Module expiry first", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { started } = await startSectionExam(call, credentials[0]);
    vi.setSystemTime(started.deadlineAt!);
    const write = await call(`/api/attempts/${started.attemptId}/write`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
        change: { type: "response", questionId: started.questions[0].questionId, response: "A" } },
    });
    expect(write.status).toBe(409);
    const current = await call(`/api/attempts/${started.attemptId}`, { who: credentials[0] });
    expect(await current.json()).toMatchObject({ state: { phase: "transition", responses: {} } });
  } finally {
    vi.useRealTimers();
  }
});

it("checkpoints per-question time on accepted changes and coarse heartbeats", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { started } = await startSectionExam(call, credentials[0]);
    const module1 = started.questions.filter((question) => question.module === 1);
    vi.advanceTimersByTime(12_000);
    const navigatedResponse = await call(`/api/attempts/${started.attemptId}/write`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
        change: { type: "navigation", questionId: module1[1].questionId } },
    });
    const navigated = await navigatedResponse.json() as SectionExamResponse;
    expect(navigated.state.questionElapsedMs[module1[0].questionId]).toBe(12_000);
    vi.advanceTimersByTime(17_000);
    const heartbeat = await call(`/api/attempts/${started.attemptId}/heartbeat`, {
      method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: navigated.stateVersion },
    });
    expect(await heartbeat.json()).toMatchObject({ state: {
      questionElapsedMs: { [module1[0].questionId]: 12_000, [module1[1].questionId]: 17_000 },
    } });
  } finally {
    vi.useRealTimers();
  }
});

it("persists calculator state through the same versioned write path", async () => {
  const { credentials, call } = await fixture();
  const { started } = await startSectionExam(call, credentials[0]);
  const graphState = { version: 1, expressions: [{ id: "line", latex: "y=x" }] };
  const saved = await call(`/api/attempts/${started.attemptId}/write`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
      change: { type: "calculator_state", state: graphState } },
  });
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ state: { calculatorState: graphState } });
});

it("does not submit a Section Exam before both Modules are closed", async () => {
  const { credentials, call } = await fixture();
  const { started } = await startSectionExam(call, credentials[0]);
  const submit = await call(`/api/attempts/${started.attemptId}/submit`, {
    method: "POST", who: credentials[0],
    body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion },
  });
  expect(submit.status).toBe(409);
  expect(await submit.json()).toMatchObject({ error: { code: "attempt_changed" } });
});

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

it("records per-question Practice time at navigation and submission for evidence averages", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { attemptId, started } = await startPractice(call, credentials[0]);
    vi.advanceTimersByTime(10_000);
    const navigation = await call(`/api/attempts/${attemptId}/write`, { method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: started.stateVersion,
        change: { type: "navigation", questionId: "q2" } } });
    expect(navigation.status).toBe(200);
    const navigated = await navigation.json() as { stateVersion: number };
    vi.advanceTimersByTime(20_000);
    const submitted = await call(`/api/attempts/${attemptId}/submit`, { method: "POST", who: credentials[0],
      body: { editorToken: started.editorToken, expectedStateVersion: navigated.stateVersion } });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ state: { questionElapsedMs: { q1: 10_000, q2: 20_000 } } });
  } finally { vi.useRealTimers(); }
});

it("does not count a gap after an expired Practice editor lease as question time", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  try {
    const { credentials, call } = await fixture();
    const { attemptId } = await startPractice(call, credentials[0]);
    vi.advanceTimersByTime(300_000);
    const takeover = await call(`/api/attempts/${attemptId}/takeover`, { method: "POST", who: credentials[2] });
    expect(takeover.status).toBe(200);
    const next = await takeover.json() as { editorToken: string; stateVersion: number };
    vi.advanceTimersByTime(10_000);
    const submitted = await call(`/api/attempts/${attemptId}/submit`, { method: "POST", who: credentials[2],
      body: { editorToken: next.editorToken, expectedStateVersion: next.stateVersion } });
    expect(submitted.status).toBe(200);
    expect(await submitted.json()).toMatchObject({ state: { questionElapsedMs: { q1: 130_000 } } });
  } finally { vi.useRealTimers(); }
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
