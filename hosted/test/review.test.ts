import { expect, it } from "vitest";
import { reviewRoute } from "../src/review";

const origin = "https://whitebook.test";
const firstAttempt = "10000000-0000-4000-8000-000000000001";
const secondAttempt = "10000000-0000-4000-8000-000000000002";

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function fixture() {
  const credentials = [
    { accountId: "learner-a", token: "a".repeat(64), csrf: "c".repeat(64) },
    { accountId: "learner-b", token: "b".repeat(64), csrf: "d".repeat(64) },
  ];
  const sessions = new Map<string, object>();
  for (const item of credentials) sessions.set(await hash(item.token), {
    token_hash: await hash(item.token), csrf_hash: await hash(item.csrf), account_id: item.accountId,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  });
  const question = { questionId: "q1", section: "Reading and Writing", module: 1,
    questionNumber: 1, responseType: "multiple_choice", choiceIds: ["A", "B"] };
  const originalResult = { correctCount: 0, questionCount: 1,
    questions: [{ questionId: "q1", response: "A", acceptedAnswers: ["B"], correct: false }] };
  const attempts = new Map([firstAttempt, secondAttempt].map((id) => [id, {
    id, account_id: "learner-a", revision_id: "revision-1", status: "completed", kind: "practice",
    questions_json: JSON.stringify([question]), result_json: JSON.stringify(originalResult),
    answers_exposed_at_ms: null as number | null,
  }]));
  const reviews = new Map<string, Record<string, unknown>>();
  const notes = new Map<string, Record<string, unknown>>();
  let hint: string | null = null;
  let explanation: string | null = null;
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) { args = values; return statement; },
        async first<T>() {
          if (sql.includes("FROM learner_sessions")) return (sessions.get(String(args[0])) ?? null) as T | null;
          if (sql.includes("kind = 'section_exam'")) return ([...attempts.values()].find((row) =>
            row.account_id === args[0] && row.kind === "section_exam" && row.status === "active") ?? null) as T | null;
          if (sql.includes("FROM learner_attempts")) {
            const row = attempts.get(String(args[0]));
            return (row && row.account_id === args[1] ? row : null) as T | null;
          }
          if (sql.includes("FROM guided_reviews") && sql.includes("revealed_at_ms IS NOT NULL"))
            return ([...reviews.values()].find((row) => row.account_id === args[0] && row.revision_id === args[1] &&
              row.question_id === args[2] && row.revealed_at_ms !== null) ?? null) as T | null;
          if (sql.includes("FROM guided_reviews")) {
            const row = reviews.get(String(args[0]));
            return (row && row.account_id === args[1] ? row : null) as T | null;
          }
          if (sql.includes("FROM publication_review_help")) return (hint || explanation
            ? { reviewed_hint: hint, reviewed_explanation: explanation } : null) as T | null;
          return null;
        },
        async all() {
          if (sql.includes("FROM learner_attempts")) return { results: [...attempts.values()].filter((row) =>
            row.account_id === args[0] && row.revision_id === args[1] && row.status === "completed" &&
            row.answers_exposed_at_ms !== null).map((row) => ({ result_json: row.result_json })),
            meta: { rows_read: attempts.size, rows_written: 0 } };
          if (sql.includes("FROM study_notes")) return { results: [...notes.values()].filter((row) =>
            row.account_id === args[0] && row.revision_id === args[1] && row.question_id === args[2]),
            meta: { rows_read: notes.size, rows_written: 0 } };
          return { results: [], meta: { rows_read: 0, rows_written: 0 } };
        },
        async run() {
          if (sql.startsWith("INSERT INTO guided_reviews")) {
            const [id, accountId, attemptId, revisionId, questionId, exposure, now] = args;
            reviews.set(String(id), { id, account_id: accountId, attempt_id: attemptId, revision_id: revisionId,
              question_id: questionId, prior_answer_exposure: exposure, retry_response: null, hint_used: 0,
              revealed_at_ms: null, mistake_label: null, created_at_ms: now, updated_at_ms: now });
            return success();
          }
          if (sql.startsWith("UPDATE guided_reviews")) {
            const id = String(args[sql.includes("retry_response = ?") ? 3 : sql.includes("hint_used = 1") ? 1 : 2]);
            const row = reviews.get(id);
            if (!row) return success(0);
            if (sql.includes("hint_used = 1")) row.hint_used = 1;
            else if (sql.includes("retry_response = ?")) { row.retry_response = args[0]; row.revealed_at_ms = args[1]; }
            else row.mistake_label = args[0];
            return success();
          }
          if (sql.startsWith("INSERT INTO study_notes")) {
            const [id, accountId, revisionId, questionId, text, createdAt, updatedAt] = args;
            notes.set(String(id), { id, account_id: accountId, revision_id: revisionId, question_id: questionId,
              body: text, created_at_ms: createdAt, updated_at_ms: updatedAt });
            return success();
          }
          if (sql.startsWith("UPDATE study_notes")) {
            const row = notes.get(String(args[2]));
            if (!row || row.account_id !== args[3]) return success(0);
            row.body = args[0]; row.updated_at_ms = args[1]; return success();
          }
          if (sql.startsWith("DELETE FROM study_notes")) {
            const row = notes.get(String(args[0]));
            if (!row || row.account_id !== args[1]) return success(0);
            notes.delete(String(args[0])); return success();
          }
          throw new Error(`Unexpected SQL: ${sql}`);
        },
      };
      return statement;
    },
  };
  function success(changes = 1) { return { success: true, meta: { changes, rows_read: 0, rows_written: changes } }; }
  async function call(path: string, options: { who?: number; method?: string; body?: unknown; csrf?: boolean } = {}) {
    const who = options.who ?? 0;
    const headers = new Headers({ Cookie: `__Host-wb_session=${credentials[who].token}` });
    if (options.method && options.method !== "GET") {
      headers.set("Origin", origin);
      if (options.csrf !== false) headers.set("X-CSRF-Token", credentials[who].csrf);
    }
    const response = reviewRoute(new Request(origin + path, { method: options.method ?? "GET", headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }) }),
      { DB: db, APP_ORIGIN: origin } as never);
    if (!response) throw new Error("Review route was not matched");
    return response;
  }
  return { attempts, reviews, notes, call, setHelp: (nextHint: string | null, nextExplanation: string | null) => {
    hint = nextHint; explanation = nextExplanation;
  } };
}

it("keeps completed answers hidden until reveal and saves retries outside Raw Accuracy", async () => {
  const { attempts, reviews, call, setHelp } = await fixture();
  setHelp("Check the passage's contrast.", "B follows the reviewed passage.");
  const overview = await call(`/api/review/attempts/${firstAttempt}`);
  expect(overview.status).toBe(200);
  expect(JSON.stringify(await overview.json())).not.toContain("acceptedAnswers");
  const started = await call(`/api/review/attempts/${firstAttempt}/questions/q1`, { method: "POST", body: {} });
  const hidden = await started.json() as { reviewId: string; hintAvailable: boolean; revealed: boolean };
  expect(started.status).toBe(200);
  expect(hidden).toMatchObject({ hintAvailable: true, revealed: false });
  expect(JSON.stringify(hidden)).not.toMatch(/acceptedAnswers|originalResponse/);
  const hint = await call(`/api/review/${hidden.reviewId}/hint`, { method: "POST", body: {} });
  expect(await hint.json()).toEqual({ hint: "Check the passage's contrast." });
  const checked = await call(`/api/review/${hidden.reviewId}/retry`, { method: "POST", body: { response: "B" } });
  expect(await checked.json()).toMatchObject({ originalResponse: "A", retryResponse: "B",
    acceptedAnswers: ["B"], retryCorrect: true, explanation: "B follows the reviewed passage.", hintUsed: true });
  expect(reviews.get(hidden.reviewId)?.retry_response).toBe("B");
  expect(JSON.parse(attempts.get(firstAttempt)!.result_json!)).toMatchObject({ correctCount: 0,
    questions: [{ response: "A", correct: false }] });
  expect((await call(`/api/review/${hidden.reviewId}/retry`, { method: "POST", body: { response: "A" } })).status).toBe(409);
});

it("offers unanswered questions without an inert hint and rejects incomplete Attempt review", async () => {
  const { attempts, call } = await fixture();
  const row = attempts.get(firstAttempt)!;
  row.questions_json = JSON.stringify([...JSON.parse(row.questions_json) as object[], {
    questionId: "q2", section: "Reading and Writing", module: 1, questionNumber: 2,
    responseType: "multiple_choice", choiceIds: ["A", "B"],
  }]);
  row.result_json = JSON.stringify({ correctCount: 0, questionCount: 2, questions: [
    { questionId: "q1", response: "A", acceptedAnswers: ["B"], correct: false },
    { questionId: "q2", response: null, acceptedAnswers: ["A"], correct: false },
  ] });
  const overview = await call(`/api/review/attempts/${firstAttempt}`);
  expect(await overview.json()).toMatchObject({ questions: [
    { questionId: "q1", status: "incorrect" }, { questionId: "q2", status: "unanswered" },
  ] });
  const started = await call(`/api/review/attempts/${firstAttempt}/questions/q2`, { method: "POST", body: {} });
  const hidden = await started.json() as { reviewId: string; hintAvailable: boolean };
  expect(hidden.hintAvailable).toBe(false);
  expect((await call(`/api/review/${hidden.reviewId}/hint`, { method: "POST", body: {} })).status).toBe(404);
  row.status = "active";
  expect((await call(`/api/review/attempts/${firstAttempt}`)).status).toBe(409);
  expect((await call(`/api/review/attempts/${firstAttempt}/questions/q2`, { method: "POST", body: {} })).status).toBe(409);
});

it("keeps multiple private Study Notes across completed reviews and blocks active exams", async () => {
  const { attempts, notes, call } = await fixture();
  const started = await call(`/api/review/attempts/${firstAttempt}/questions/q1`, { method: "POST", body: {} });
  const { reviewId } = await started.json() as { reviewId: string };
  expect((await call(`/api/review/${reviewId}/notes`, { method: "POST", body: { body: "Too early" } })).status).toBe(409);
  expect((await call(`/api/review/${reviewId}`, { who: 1 })).status).toBe(404);
  await call(`/api/review/${reviewId}/reveal`, { method: "POST", body: {} });
  const first = await call(`/api/review/${reviewId}/notes`, { method: "POST", body: { body: "Read the contrast" } });
  const second = await call(`/api/review/${reviewId}/notes`, { method: "POST", body: { body: "Eliminate A" } });
  const firstId = (await first.json() as { note: { id: string } }).note.id;
  const secondId = (await second.json() as { note: { id: string } }).note.id;
  expect(notes.size).toBe(2);
  expect((await call(`/api/review/${reviewId}/notes/${firstId}`, { who: 1, method: "DELETE" })).status).toBe(404);
  await call(`/api/review/${reviewId}/notes/${firstId}`, { method: "PATCH", body: { body: "Read the turn" } });
  const later = await call(`/api/review/attempts/${secondAttempt}/questions/q1`, { method: "POST", body: {} });
  const laterStart = await later.json() as { reviewId: string; priorAnswerExposure: string };
  expect(laterStart.priorAnswerExposure).toBe("seen");
  const laterId = laterStart.reviewId;
  const laterDetail = await call(`/api/review/${laterId}/reveal`, { method: "POST", body: {} });
  expect((await laterDetail.json() as { notes: { body: string }[] }).notes.map((item) => item.body))
    .toEqual(["Read the turn", "Eliminate A"]);
  await call(`/api/review/${laterId}/notes/${secondId}`, { method: "DELETE" });
  expect(notes.size).toBe(1);
  attempts.set(secondAttempt, { ...attempts.get(secondAttempt)!, kind: "section_exam", status: "active" });
  expect((await call(`/api/review/${reviewId}`)).status).toBe(409);
  expect((await call(`/api/review/${reviewId}/notes`, { method: "POST", body: { body: "Blocked" } })).status).toBe(409);
});
