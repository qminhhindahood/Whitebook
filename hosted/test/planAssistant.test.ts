import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { assistantRoute, type AssistantEnv } from "../src/assistant";
import type { AccountEnv } from "../src/accounts";
import { planRoute } from "../src/plan";

const origin = "https://whitebook.example.test";
const digest = async (s: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");
const open: DatabaseSync[] = [];
afterEach(() => { open.splice(0).forEach(db => db.close()); });

async function fixture() {
  const db = new DatabaseSync(":memory:"); open.push(db);
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).sort())
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const DB: AccountEnv["DB"] = {
    prepare(sql) { let args: any[] = []; return {
      bind(...values) { args = values; return this; },
      async first<T>() { return (db.prepare(sql).get(...args) ?? null) as T | null; },
      async all() { return { results: db.prepare(sql).all(...args), meta: { rows_read: 0, rows_written: 0 } }; },
      async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), rows_read: 0, rows_written: Number(r.changes) } }; },
    }; },
    async batch(statements) { db.exec("BEGIN"); try { const out = []; for (const s of statements) out.push(await s.run()); db.exec("COMMIT"); return out; }
      catch (e) { db.exec("ROLLBACK"); throw e; } },
  };
  for (const account of ["a", "b"]) {
    db.prepare("INSERT INTO learner_accounts (id,provider,provider_subject,email,display_name,created_at,time_zone) VALUES (?, 'google', ?, ?, 'Private Name', 0, 'UTC')").run(account, account, `${account}@private.invalid`);
    db.prepare("INSERT INTO learner_sessions VALUES (?, ?, ?, ?, 0)").run(await digest(account.repeat(64)), account, await digest("c".repeat(64)), 9_999_999_999);
  }
  db.prepare("INSERT INTO learner_sat_dates (account_id,test_date,is_primary,selected_at) VALUES ('a','2026-10-10',1,1)").run();
  db.prepare("INSERT INTO package_revisions VALUES ('revision-1','family','Reviewed set',1,1,'hash',1)").run();
  db.prepare("INSERT INTO private_revision_entitlements (account_id,revision_id) VALUES ('a','revision-1')").run();
  db.prepare("INSERT INTO publication_questions VALUES ('revision-1','q1','source-q1',1,'Math',1,1,'multiple_choice',?)")
    .run(JSON.stringify({ stem: [{ text: "QUESTION_STEM_SENTINEL" }] }));
  const now = Date.UTC(2026, 8, 28, 7);
  const option = { route: "shared_gemini", model: "gemini-test", payer: "Shared AI Access", price: "USD 0 test fixture", terms: "Test terms", termsUrl: "https://ai.google.dev/gemini-api/terms", termsVersion: "test-1", languages: ["en"], vision: false, quota: "Test project allowance", healthy: true };
  const env: AssistantEnv = { DB, ASSETS: { fetch: async () => new Response(null) }, APP_ORIGIN: origin,
    AI_RELEASE_ENABLED: "true", ASSISTANT_KEY_KEK: "a".repeat(64), ASSISTANT_SNAPSHOT_KEY: "b".repeat(64), GEMINI_SHARED_KEY: "test-shared-key",
    ASSISTANT_CATALOG: JSON.stringify({ reviewedUntil: now + 86400000, audienceEligibility: "signed_in_adults_18_plus", providerEligibility: "approved", eligibilityEvidence: "fixture", failureCheckEvidence: "fixture", options: [option] }) };
  const adapter = vi.fn(async (_payload: string, _model: string, _key: string) => JSON.stringify([{ date: "2026-09-29", kind: "practice", title: "Practice Math", minutes: 20,
    action: { area: "practice", revisionId: "revision-1", section: "Math" }, explanation: "Build a Math baseline." }]));
  const request = (path: string, body?: unknown, account = "a") => new Request(origin + path, {
    method: body === undefined ? "GET" : "POST", headers: { Cookie: `__Host-wb_session=${account.repeat(64)}`, Origin: origin,
      "X-CSRF-Token": "c".repeat(64), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const call = (path: string, body?: unknown, account = "a") => assistantRoute(request(`/api/assistant/${path}`, body, account), env, adapter, () => now)!;
  const plan = (body?: unknown) => planRoute(request("/api/account/plan", body), env, () => now)!;
  const settings = { primaryDate: "2026-10-10", studyDays: [1, 2, 3, 4, 5], restDays: [0, 6], dailyMinutes: 30, officialScoreGoal: 1400 };
  const input = { visitId: crypto.randomUUID(), route: "shared_gemini", model: "gemini-test", locale: "en", official: false, whitebook: false, settings, expectedVersionId: null };
  const score = (id: string, date: string, created: number, total = 1300, band: number | null = null) =>
    db.prepare(`INSERT INTO official_sat_results (id,account_id,administration_date,total_score,reading_writing_score,math_score,
      band_information_ideas,band_craft_structure,band_expression_of_ideas,band_standard_english_conventions,band_algebra,band_advanced_math,
      band_problem_solving_data_analysis,band_geometry_trigonometry,created_at,updated_at) VALUES (?, 'a', ?, ?, 650, ?, ?,?,?,?,?,?,?,?, ?, ?)`)
      .run(id, date, total, total - 650, band, null, null, null, null, null, null, null, created, created);
  const attempt = (id: string, kind: string, status: string, completed: number, section = "Math") =>
    db.prepare(`INSERT INTO learner_attempts (id,account_id,revision_id,kind,status,config_json,questions_json,state_json,created_at_ms,completed_at_ms,result_json)
      VALUES (?,'a','revision-1',?,?,?,'[]','{}',1,?,?)`).run(id, kind, status, JSON.stringify({ section }), completed,
      JSON.stringify({ correctCount: 33, questionCount: 44, questions: [{ questionId: "q1", response: "RESPONSE_SENTINEL", acceptedAnswers: ["ANSWER_SENTINEL"], correct: true }] }));
  return { db, env, adapter, call, plan, settings, input, score, attempt };
}

it("requires a selected, present result and a primary target before a Gemini send", async () => {
  const f = await fixture();
  expect((await f.call("plan-preview", f.input)).status).toBe(409);
  expect((await f.call("plan-preview", { ...f.input, official: true })).status).toBe(409);
  expect((await f.call("plan-preview", { ...f.input, whitebook: true })).status).toBe(409);
  f.score("score-1", "2026-08-01", 1);
  f.db.prepare("DELETE FROM learner_sat_dates WHERE account_id='a'").run();
  expect((await f.call("plan-preview", { ...f.input, official: true })).status).toBe(400);
  expect(f.adapter).not.toHaveBeenCalled();
  expect((await f.plan()).status).toBe(200);
});

it("passes through mixed boundary Skills Insight bands without filling missing bands", async () => {
  const f = await fixture(); f.score("score-1", "2026-08-01", 1, 1300, 1);
  f.db.prepare("UPDATE official_sat_results SET band_algebra=7 WHERE id='score-1'").run();
  const preview = await (await f.call("plan-preview", { ...f.input, official: true })).json() as any;
  const content = JSON.parse(JSON.parse(preview.payload).contents[0].parts[0].text);
  expect(content.officialSatResult.skillsInsightBands).toMatchObject({ informationIdeas: 1, algebra: 7, craftStructure: null });
  expect(Object.keys(content.officialSatResult.skillsInsightBands)).toHaveLength(8);
  const draft = await f.call("plan-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true });
  expect(draft.status).toBe(200);
  expect(f.adapter.mock.calls[0][0]).toBe(preview.payload);
});

it("previews only selected latest sources with all nullable bands and no question material", async () => {
  const f = await fixture();
  f.score("recent-edit-old-test", "2026-07-01", 99, 1200, 7);
  f.score("older-save-new-test", "2026-08-01", 1, 1300, 1);
  f.score("same-date-new-save", "2026-08-01", 2, 1350, null);
  f.attempt("section-1", "section_exam", "completed", 5);
  f.attempt("section-2", "section_exam", "completed", 6, "Reading and Writing");
  f.attempt("practice-newer", "practice", "completed", 9);
  const official = await f.call("plan-preview", { ...f.input, official: true });
  expect(official.status).toBe(200);
  const officialBody = await official.text();
  expect(officialBody).toContain("same-date-new-save");
  expect(officialBody).not.toContain("recent-edit-old-test");
  expect(officialBody).not.toContain("section-2");
  const envelope = JSON.parse(JSON.parse(officialBody).payload).contents[0].parts[0].text;
  const officialEnvelope = JSON.parse(envelope);
  expect(officialEnvelope.officialSatResult).toMatchObject({ resultId: "same-date-new-save", administrationDate: "2026-08-01", total: 1350,
    readingWriting: 650, math: 700 });
  expect(officialEnvelope.officialSatResult.skillsInsightBands).toEqual(Object.fromEntries([
    "informationIdeas", "craftStructure", "expressionOfIdeas", "standardEnglishConventions", "algebra", "advancedMath", "problemSolvingDataAnalysis", "geometryTrigonometry",
  ].map(key => [key, null])));
  expect(officialEnvelope).toMatchObject({ today: "2026-09-28", officialScoreGoal: 1400, primarySatTarget: "2026-10-10", dueCardTotal: 0,
    planConstraints: { studyDays: [1, 2, 3, 4, 5], restDays: [0, 6], dailyMinutes: 30 } });
  expect(officialEnvelope.activityCatalog).toEqual([expect.objectContaining({ revisionId: "revision-1", section: "Math" })]);
  const whitebook = await f.call("plan-preview", { ...f.input, whitebook: true });
  const whitebookBody = await whitebook.text();
  const whitebookEnvelope = JSON.parse(JSON.parse(whitebookBody).payload).contents[0].parts[0].text;
  expect(whitebookEnvelope).toContain("section-2");
  expect(whitebookEnvelope).not.toContain("section-1");
  expect(whitebookEnvelope).toContain("Reading and Writing");
  expect(whitebookEnvelope).toContain("Whitebook Raw Accuracy");
  expect(whitebookEnvelope).not.toContain("same-date-new-save");
  expect(whitebookEnvelope).not.toContain("1350");
  expect(whitebookEnvelope).not.toContain("ANSWER_SENTINEL");
  expect(whitebookEnvelope).not.toContain("RESPONSE_SENTINEL");
  expect(whitebookEnvelope).not.toContain("QUESTION_STEM_SENTINEL");
  expect(JSON.parse(whitebookEnvelope).whitebookSectionExam).toMatchObject({ label: "Whitebook Raw Accuracy", attemptId: "section-2",
    section: "Reading and Writing", questionCount: 44, rawAccuracy: 75 });
  expect(JSON.parse(whitebookEnvelope).officialSatResult).toBeNull();
  const both = await f.call("plan-preview", { ...f.input, official: true, whitebook: true });
  expect((await both.text())).toContain("same-date-new-save");
});

it("accepts a validated proposal as a new version and keeps earlier versions editable history intact", async () => {
  const f = await fixture(); f.score("score-1", "2026-08-01", 1);
  const original = await (await f.plan({ settings: f.settings, expectedVersionId: null })).json() as any;
  const expectedVersionId = original.selected.id;
  const preview = await (await f.call("plan-preview", { ...f.input, official: true, expectedVersionId })).json() as any;
  const draft = await f.call("plan-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true });
  expect(draft.status).toBe(200);
  const proposal = await draft.json() as any;
  expect(f.adapter).toHaveBeenCalledWith(preview.payload, "gemini-test", "test-shared-key");
  const saved = await f.call("plan-accept", { proposalId: proposal.proposalId, visitId: f.input.visitId });
  expect(saved.status).toBe(200);
  const current = await (await f.plan()).json() as any;
  expect(current.selected.version).toBe(2);
  expect(current.tasks).toHaveLength(1);
  expect(current.tasks[0].action.revisionId).toBe("revision-1");
  const taskUpdate = await planRoute(new Request(`${origin}/api/account/plan/tasks/${current.tasks[0].id}`, {
    method: "PATCH", headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}`, Origin: origin, "X-CSRF-Token": "c".repeat(64), "Content-Type": "application/json" },
    body: JSON.stringify({ expectedRevision: 0, status: "done" }),
  }), f.env, () => Date.UTC(2026, 8, 28, 7));
  expect(taskUpdate?.status).toBe(200);
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM study_plan_task_events").get()).toEqual({ n: 1 });
  expect((await f.call("plan-accept", { proposalId: proposal.proposalId, visitId: f.input.visitId })).status).toBe(409);
  const prior = await (await planRoute(new Request(`${origin}/api/account/plan?version=${expectedVersionId}`, { headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}` } }), f.env, () => Date.UTC(2026, 8, 28, 7))!).json() as any;
  expect(prior.tasks).toEqual(original.tasks);
});

const validTask = { date: "2026-09-29", kind: "practice", title: "Practice Math", minutes: 20,
  action: { area: "practice", revisionId: "revision-1", section: "Math" }, explanation: "Build a Math baseline." };

it.each([
  ["rest day", [{ ...validTask, date: "2026-10-04" }]],
  ["exam day", [{ ...validTask, date: "2026-10-10" }]],
  ["past day", [{ ...validTask, date: "2026-09-27" }]],
  ["impossible date", [{ ...validTask, date: "2026-02-30" }]],
  ["too few minutes", [{ ...validTask, minutes: 4 }]],
  ["too many minutes", [{ ...validTask, minutes: 31 }]],
  ["overfull day", [{ ...validTask }, { ...validTask }]],
  ["unentitled package", [{ ...validTask, action: { ...validTask.action, revisionId: "invented" } }]],
  ["foreign review", [{ ...validTask, kind: "review", action: { area: "history", attemptId: "other-account", questionId: "q1" } }]],
  ["unknown kind", [{ ...validTask, kind: "prediction" }]],
  ["long title", [{ ...validTask, title: "x".repeat(121) }]],
  ["SAT point promise", [{ ...validTask, title: "Gain 100 SAT points" }]],
])("rejects %s suggestions before saving any task or version", async (_name, proposals) => {
  const f = await fixture(); f.score("score-1", "2026-08-01", 1);
  f.adapter.mockResolvedValueOnce(JSON.stringify(proposals));
  const preview = await (await f.call("plan-preview", { ...f.input, official: true })).json() as any;
  const response = await f.call("plan-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true });
  expect([409, 422]).toContain(response.status);
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM study_plan_versions").get()).toEqual({ n: 0 });
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM study_plan_tasks").get()).toEqual({ n: 0 });
});

it("shows server-grounded evidence in accepted tasks instead of a model score promise", async () => {
  const f = await fixture(); f.score("score-1", "2026-08-01", 1);
  f.adapter.mockResolvedValueOnce(JSON.stringify([{ ...validTask, explanation: "Guaranteed 100 point improvement." }]));
  const preview = await (await f.call("plan-preview", { ...f.input, official: true })).json() as any;
  const response = await f.call("plan-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true });
  expect(response.status).toBe(200);
  const draft = await response.json() as any;
  expect(draft.tasks[0].explanation).toContain("Whitebook");
  expect(draft.tasks[0].explanation).not.toContain("Guaranteed");
});

it("keeps manual planning available when Gemini fails and refuses stale acceptance", async () => {
  const f = await fixture(); f.score("score-1", "2026-08-01", 1);
  f.adapter.mockRejectedValueOnce(new Error("provider unavailable"));
  const first = await (await f.call("plan-preview", { ...f.input, official: true })).json() as any;
  expect((await f.call("plan-send", { previewId: first.previewId, visitId: f.input.visitId, consent: true })).status).toBe(502);
  const manual = await f.plan({ settings: f.settings, expectedVersionId: null });
  expect(manual.status).toBe(200);
  const version = (await manual.json() as any).selected.id;
  const second = await (await f.call("plan-preview", { ...f.input, official: true, expectedVersionId: version })).json() as any;
  const proposal = await (await f.call("plan-send", { previewId: second.previewId, visitId: f.input.visitId, consent: true })).json() as any;
  expect((await f.plan({ settings: f.settings, expectedVersionId: version })).status).toBe(200);
  expect((await f.call("plan-accept", { proposalId: proposal.proposalId, visitId: f.input.visitId })).status).toBe(409);
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM study_plan_versions").get()).toEqual({ n: 2 });
});

it("refuses a changed selected result before sending and a lost entitlement before acceptance", async () => {
  const f = await fixture(); f.score("score-1", "2026-08-01", 1);
  const preview = await (await f.call("plan-preview", { ...f.input, official: true })).json() as any;
  f.score("score-2", "2026-08-08", 2);
  expect((await f.call("plan-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true })).status).toBe(409);
  expect(f.adapter).not.toHaveBeenCalled();
  const fresh = await (await f.call("plan-preview", { ...f.input, official: true })).json() as any;
  const draft = await (await f.call("plan-send", { previewId: fresh.previewId, visitId: f.input.visitId, consent: true })).json() as any;
  f.db.prepare("DELETE FROM private_revision_entitlements WHERE account_id='a' AND revision_id='revision-1'").run();
  expect((await f.call("plan-accept", { proposalId: draft.proposalId, visitId: f.input.visitId })).status).toBe(409);
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM study_plan_versions").get()).toEqual({ n: 0 });
});

it("binds proposal acceptance to the signed-in account and visit", async () => {
  const f = await fixture(); f.score("score-1", "2026-08-01", 1);
  const preview = await (await f.call("plan-preview", { ...f.input, official: true })).json() as any;
  const draft = await (await f.call("plan-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true })).json() as any;
  expect((await f.call("plan-accept", { proposalId: draft.proposalId, visitId: f.input.visitId }, "b")).status).toBe(409);
  expect((await f.call("plan-accept", { proposalId: draft.proposalId, visitId: crypto.randomUUID() })).status).toBe(409);
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM study_plan_versions").get()).toEqual({ n: 0 });
});

it("accepts an already validated draft if Gemini later becomes unavailable", async () => {
  const f = await fixture(); f.score("score-1", "2026-08-01", 1);
  const preview = await (await f.call("plan-preview", { ...f.input, official: true })).json() as any;
  const draft = await (await f.call("plan-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true })).json() as any;
  f.env.ASSISTANT_CATALOG = "{}";
  expect((await f.call("plan-accept", { proposalId: draft.proposalId, visitId: f.input.visitId })).status).toBe(200);
  expect(f.db.prepare("SELECT COUNT(*) AS n FROM study_plan_versions").get()).toEqual({ n: 1 });
});

it("denies Study Plan AI in the current staging release before any data access", async () => {
  const f = await fixture(); f.env.AI_RELEASE_ENABLED = "false";
  expect((await f.call("plan-preview", { ...f.input, official: true })).status).toBe(404);
  expect(f.adapter).not.toHaveBeenCalled();
  expect((await f.plan()).status).toBe(200);
});
