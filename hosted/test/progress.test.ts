import { expect, it } from "vitest";
import worker from "../src/worker";
import { summarizeProgress } from "../src/progress";

const origin = "https://whitebook.test";
const token = "a".repeat(64);

async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function attempt(account: string, id: string, at: number, questions: { questionId: string; section: string; response: string | null; correct: boolean; ms?: number }[]) {
  return {
    id, account_id: account, revision_id: "revision-1", kind: "practice", status: "completed",
    completed_at_ms: at,
    questions_json: JSON.stringify(questions.map((q, index) => ({ questionId: q.questionId, section: q.section, module: 1, questionNumber: index + 1 }))),
    result_json: JSON.stringify({ questions: questions.map((q) => ({ questionId: q.questionId, response: q.response, correct: q.correct })) }),
    state_json: JSON.stringify({ questionElapsedMs: Object.fromEntries(questions.filter((q) => q.ms !== undefined).map((q) => [q.questionId, q.ms])) }),
  };
}

it("returns account-owned unassisted evidence with visible unmapped questions and separate sample sizes", async () => {
  const attempts = [
    attempt("learner-a", "first", 1000, [
      { questionId: "q1", section: "Reading and Writing", response: "A", correct: true, ms: 30000 },
      { questionId: "q2", section: "Reading and Writing", response: "B", correct: false, ms: 60000 },
      { questionId: "q3", section: "Reading and Writing", response: null, correct: false },
    ]),
    attempt("learner-a", "second", 2000, [
      { questionId: "q1", section: "Reading and Writing", response: "A", correct: true, ms: 20000 },
      { questionId: "q4", section: "Reading and Writing", response: "B", correct: true, ms: 40000 },
    ]),
    attempt("learner-b", "foreign", 3000, [
      { questionId: "q1", section: "Reading and Writing", response: "B", correct: false, ms: 10000 },
    ]),
  ];
  const categories = [
    { revision_id: "revision-1", question_id: "q1", section: "Reading and Writing", category: "Main Idea" },
    { revision_id: "revision-1", question_id: "q2", section: "Reading and Writing", category: "Command of Evidence" },
    { revision_id: "revision-1", question_id: "q3", section: "Reading and Writing", category: null },
    { revision_id: "revision-1", question_id: "q4", section: "Reading and Writing", category: "Vocabulary" },
  ];
  const sessionHash = await hash(token);
  const env = {
    DB: { prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first() {
          if (sql.includes("FROM learner_sessions")) return args[0] === sessionHash
            ? { token_hash: sessionHash, csrf_hash: "", expires_at: Date.now() / 1000 + 1000, account_id: "learner-a" } : null;
          throw Error(`Unexpected query: ${sql}`);
        },
        async all() {
          if (sql.includes("FROM learner_attempts")) return { results: attempts.filter((row) => row.account_id === args[0]) };
          if (sql.includes("FROM publication_questions")) return { results: categories };
          throw Error(`Unexpected query: ${sql}`);
        },
      };
    } },
  };
  const response = await worker.fetch(new Request(`${origin}/api/account/progress`, {
    headers: { Cookie: `__Host-wb_session=${token}` },
  }), env as never);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toContain("no-store");
  const body = await response.json() as {
    completedAttempts: number;
    sections: { section: string; sampleSize: number; correct: number; incorrect: number; unanswered: number; rawAccuracy: number; averageTimeSeconds: number | null; timeSampleSize: number; latestAt: number; tentative: boolean }[];
    categories: { category: string; sampleSize: number }[];
    domains: { domain: string; sampleSize: number }[];
    unmapped: { category: string; sampleSize: number }[];
  };
  expect(body.completedAttempts).toBe(2);
  expect(body.sections).toEqual([expect.objectContaining({ section: "Reading and Writing", sampleSize: 5,
    correct: 3, incorrect: 1, unanswered: 1, rawAccuracy: 60, averageTimeSeconds: 37.5,
    timeSampleSize: 4, latestAt: 2000, tentative: true })]);
  expect(body.categories).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: "Main Idea", sampleSize: 2 }),
    expect.objectContaining({ category: "Uncategorized", sampleSize: 1 }),
  ]));
  expect(body.domains).toEqual([expect.objectContaining({ domain: "Information and Ideas", sampleSize: 3 })]);
  expect(body.unmapped).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: "Uncategorized", sampleSize: 1 }),
    expect.objectContaining({ category: "Vocabulary", sampleSize: 1 }),
  ]));
  expect(JSON.stringify(body)).not.toMatch(/prediction|trap susceptibility|officialScore/i);
});

it("requires sign-in for private progress evidence", async () => {
  const response = await worker.fetch(new Request(`${origin}/api/account/progress`), { DB: { prepare() { throw Error("No DB read expected"); } } } as never);
  expect(response.status).toBe(401);
});

it("does not count assisted answers or guided retries as new graded evidence", () => {
  const questions = Array.from({ length: 10 }, (_, index) => ({ questionId: `q${index}`, section: "Math" as const,
    response: "A", correct: index < 5 }));
  const first = attempt("learner-a", "first", 1000, questions.slice(0, 5));
  const second = attempt("learner-a", "second", 2000, questions.slice(5));
  const assisted = attempt("learner-a", "assisted", 3000, [{ questionId: "q10", section: "Math", response: "A", correct: true }]);
  assisted.result_json = JSON.stringify({ questions: [{ questionId: "q10", response: "A", correct: true, assisted: true }] });
  const categories = [...questions, { questionId: "q10" }].map(({ questionId }) => ({
    revision_id: "revision-1", question_id: questionId, section: "Math" as const, category: "Algebra",
  }));
  const summary = summarizeProgress([first, second, assisted].map((row) => ({ ...row, kind: "practice" })), categories);
  expect(summary.completedAttempts).toBe(3);
  expect(summary.excludedAssisted).toBe(1);
  expect(summary.sections[0]).toMatchObject({ sampleSize: 10, correct: 5, rawAccuracy: 50,
    recentTrend: "down", tentative: true, tentativeReasons: ["Recent accuracy differs from earlier evidence"] });
  expect(summary.domains[0]).toMatchObject({ domain: "Algebra", sampleSize: 10 });
});

it("excludes every question in an Assisted Practice Attempt and keeps unassisted trends unchanged", () => {
  const questions = Array.from({ length: 10 }, (_, index) => ({ questionId: `q${index}`, section: "Math" as const,
    response: "A", correct: index < 5 }));
  const first = attempt("learner-a", "first", 1000, questions.slice(0, 5));
  const second = attempt("learner-a", "second", 2000, questions.slice(5));
  const assisted = attempt("learner-a", "assisted", 3000, [
    { questionId: "q10", section: "Math", response: "A", correct: true },
    { questionId: "q11", section: "Math", response: "B", correct: false },
  ]) as ReturnType<typeof attempt> & { assisted_at_ms: number };
  assisted.assisted_at_ms = 3001;
  const categories = [...questions, { questionId: "q10" }, { questionId: "q11" }].map(({ questionId }) => ({
    revision_id: "revision-1", question_id: questionId, section: "Math" as const, category: "Algebra",
  }));
  const unassisted = summarizeProgress([first, second].map(row => ({ ...row, kind: "practice" })), categories);
  const summary = summarizeProgress([first, second, assisted].map(row => ({ ...row, kind: "practice" })), categories);
  expect(summary.completedAttempts).toBe(3);
  expect(summary.excludedAssisted).toBe(2);
  expect(summary.sections).toEqual(unassisted.sections);
  expect(summary.categories).toEqual(unassisted.categories);
  expect(summary.domains).toEqual(unassisted.domains);
});

it("returns an empty evidence baseline when every completed question came from Assisted Practice", () => {
  const assisted = attempt("learner-a", "assisted", 3000, [
    { questionId: "q1", section: "Math", response: "A", correct: true },
    { questionId: "q2", section: "Math", response: null, correct: false },
  ]) as ReturnType<typeof attempt> & { assisted_at_ms: number };
  assisted.assisted_at_ms = 3001;
  const summary = summarizeProgress([{ ...assisted, kind: "practice" }], ["q1", "q2"].map(questionId => ({
    revision_id: "revision-1", question_id: questionId, section: "Math", category: "Algebra",
  })));
  expect(summary).toMatchObject({ completedAttempts: 1, excludedAssisted: 2, sections: [], categories: [], domains: [], unmapped: [] });
});

it("does not manufacture a trend from question order within one Attempt", () => {
  const questions = Array.from({ length: 10 }, (_, index) => ({ questionId: `q${index}`, section: "Math",
    response: "A", correct: index < 5 }));
  const row = attempt("learner-a", "only", 1000, questions);
  const summary = summarizeProgress([{ ...row, kind: "practice" }], questions.map(({ questionId }) => ({
    revision_id: "revision-1", question_id: questionId, section: "Math", category: "Algebra",
  })));
  expect(summary.sections[0]).toMatchObject({ recentTrend: "insufficient", tentative: true,
    tentativeReasons: ["Evidence comes from one completed Attempt"] });
});

it("labels a thin recent Attempt tentative even when total question count is ten", () => {
  const questions = Array.from({ length: 10 }, (_, index) => ({ questionId: `q${index}`, section: "Math",
    response: "A", correct: true }));
  const attempts = [attempt("learner-a", "older", 1000, questions.slice(0, 9)),
    attempt("learner-a", "newer", 2000, questions.slice(9))].map((row) => ({ ...row, kind: "practice" }));
  const summary = summarizeProgress(attempts, questions.map(({ questionId }) => ({
    revision_id: "revision-1", question_id: questionId, section: "Math", category: "Algebra",
  })));
  expect(summary.sections[0]).toMatchObject({ sampleSize: 10, recentTrend: "insufficient", tentative: true,
    tentativeReasons: ["Fewer than 5 questions in each of the latest two Attempts"] });
});
