import { afterAll, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { planRoute } from "../src/plan";

const origin = "https://whitebook.test";
const tokenA = "a".repeat(64);
const tokenB = "b".repeat(64);
const tokenA2 = "e".repeat(64);
const csrfA = "c".repeat(64);
const csrfB = "d".repeat(64);
const now = Date.UTC(2026, 8, 28, 7);
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "plan-test" } }));
afterAll(async () => { await mf.dispose(); });

async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

it("keeps versions and task state private across accounts and devices, with capacity and revision checks", async () => {
  const db = await mf.getD1Database("DB");
  const migrationDir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort())
    await db.exec(readFileSync(new URL(file, migrationDir), "utf8").replace(/--[^\r\n]*/g, "").replace(/\r?\n/g, " "));
  await db.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, created_at, time_zone) VALUES (?, 'google', ?, ?, ?, 1, 'UTC')")
    .bind("account-a", "subject-a", "a@test.invalid", "A").run();
  await db.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, created_at, time_zone) VALUES (?, 'google', ?, ?, ?, 1, 'UTC')")
    .bind("account-b", "subject-b", "b@test.invalid", "B").run();
  for (const [account, token, csrf] of [["account-a", tokenA, csrfA], ["account-b", tokenB, csrfB]])
    await db.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, 9999999999, 1)")
      .bind(await hash(token), account, await hash(csrf)).run();
  await db.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, 'account-a', ?, 9999999999, 1)")
    .bind(await hash(tokenA2), await hash(csrfA)).run();
  await db.prepare("INSERT INTO learner_sat_dates (account_id, test_date, is_primary, selected_at) VALUES ('account-a', '2026-10-10', 1, 1)").run();
  await db.prepare("INSERT INTO publication_releases (id, manifest_sha256, created_at) VALUES ('release-1', 'hash', 1)").run();
  await db.prepare("INSERT INTO package_revisions (id, family_id, title, source_revision, published_revision, content_sha256, question_count) VALUES ('revision-1', 'family', 'Reviewed set', 1, 1, 'hash', 1)").run();
  await db.prepare("INSERT INTO publication_release_revisions (release_id, revision_id) VALUES ('release-1', 'revision-1')").run();
  await db.prepare("INSERT INTO active_publication (slot, release_id) VALUES (1, 'release-1')").run();
  await db.prepare("INSERT INTO publication_questions (revision_id, question_id, source_question_id, ordinal, section, module, question_number, response_type, presentation_json) VALUES ('revision-1', 'q1', 'source-q1', 1, 'Math', 1, 1, 'multiple_choice', '{}')").run();

  const env = { DB: db, APP_ORIGIN: origin } as never;
  const req = (path: string, token: string, csrf?: string, method = "GET", body?: unknown) => new Request(`${origin}${path}`, {
    method, headers: { Cookie: `__Host-wb_session=${token}`, ...(csrf ? { Origin: origin, "X-CSRF-Token": csrf, "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const call = async (request: Request) => (await planRoute(request, env, () => now))!;
  const initial = await call(req("/api/account/plan", tokenA));
  expect(initial.status).toBe(200);
  expect((await initial.json() as { baseline: boolean; tasks: unknown[] }).baseline).toBe(true);
  const privateAnswer = "answer-never-sent-to-plan";
  await db.prepare(`INSERT INTO learner_attempts (id, account_id, revision_id, kind, status, config_json, questions_json, state_json,
    created_at_ms, started_at_ms, completed_at_ms, result_json) VALUES (?, 'account-a', 'revision-1', 'practice', 'completed', '{}', ?, '{}', 1, 2, 3, ?)`)
    .bind("attempt-1", JSON.stringify([{ questionId: "q1", section: "Math", module: 1, questionNumber: 1 }]),
      JSON.stringify({ questions: [{ questionId: "q1", response: "wrong", correct: false, acceptedAnswers: [privateAnswer] }] })).run();
  const settings = { primaryDate: "2026-10-10", studyDays: [1, 2, 3, 4, 5], restDays: [0, 6], dailyMinutes: 30, officialScoreGoal: null };
  const built = await call(req("/api/account/plan", tokenA, csrfA, "POST", { settings, expectedVersionId: null }));
  expect(built.status).toBe(200);
  const builtBody = await built.text();
  expect(builtBody).not.toContain(privateAnswer);
  const first = JSON.parse(builtBody) as { selected: { id: string; version: number }; tasks: { id: string; date: string; revision: number; minutes: number; status: string }[] };
  expect(first.selected.version).toBe(1);
  expect(first.tasks.length).toBeGreaterThan(1);
  const foreign = await call(req(`/api/account/plan?version=${first.selected.id}`, tokenB));
  expect(foreign.status).toBe(404);
  const foreignEdit = await call(req(`/api/account/plan/tasks/${first.tasks[0].id}`, tokenB, csrfB, "PATCH", { expectedRevision: 0, status: "done" }));
  expect(foreignEdit.status).toBe(404);
  const done = await call(req(`/api/account/plan/tasks/${first.tasks[0].id}`, tokenA, csrfA, "PATCH", { expectedRevision: 0, status: "done" }));
  expect(done.status).toBe(200);
  const stale = await call(req(`/api/account/plan/tasks/${first.tasks[0].id}`, tokenA, csrfA, "PATCH", { expectedRevision: 0, status: "skipped" }));
  expect(stale.status).toBe(409);
  const fullDay = await call(req(`/api/account/plan/tasks/${first.tasks[1].id}`, tokenA, csrfA, "PATCH",
    { expectedRevision: 0, date: first.tasks[0].date }));
  expect(fullDay.status).toBe(409);
  const restDay = await call(req(`/api/account/plan/tasks/${first.tasks[1].id}`, tokenA, csrfA, "PATCH",
    { expectedRevision: 0, date: "2026-10-04" }));
  expect(restDay.status).toBe(400);
  const otherDevice = await call(req("/api/account/plan", tokenA2));
  expect((await otherDevice.json() as { tasks: { status: string }[] }).tasks[0].status).toBe("done");
  const second = await call(req("/api/account/plan", tokenA, csrfA, "POST", { settings, expectedVersionId: first.selected.id }));
  expect(second.status).toBe(200);
  const latest = await second.json() as { selected: { version: number }; versions: { id: string }[]; tasks: { id: string; revision: number }[]; completedHistory: number };
  expect(latest.selected.version).toBe(2);
  expect(latest.completedHistory).toBe(1);
  const prior = await call(req(`/api/account/plan?version=${first.selected.id}`, tokenA));
  expect((await prior.json() as { tasks: { status: string }[] }).tasks[0].status).toBe("done");
  const oldEdit = await call(req(`/api/account/plan/tasks/${first.tasks[0].id}`, tokenA, csrfA, "PATCH", { expectedRevision: 1, status: "pending" }));
  expect(oldEdit.status).toBe(409);
  const events = await db.prepare("SELECT COUNT(*) AS count FROM study_plan_task_events WHERE account_id = 'account-a'").first<{ count: number }>();
  expect(events?.count).toBe(1);
  await db.prepare("UPDATE learner_sat_dates SET test_date = '2026-10-03' WHERE account_id = 'account-a'").run();
  const changedDate = await call(req("/api/account/plan", tokenA2));
  expect((await changedDate.json() as { stale: boolean }).stale).toBe(true);
  const editStale = await call(req(`/api/account/plan/tasks/${latest.tasks[0].id}`, tokenA, csrfA, "PATCH", { expectedRevision: 0, status: "done" }));
  expect(editStale.status).toBe(409);
  const rebuiltDate = await call(req("/api/account/plan", tokenA, csrfA, "POST", {
    settings: { ...settings, primaryDate: "2026-10-03" }, expectedVersionId: latest.versions[0].id,
  }));
  expect(rebuiltDate.status).toBe(200);
  const third = await rebuiltDate.json() as { selected: { id: string; version: number; primaryDate: string } };
  expect(third.selected).toMatchObject({ version: 3, primaryDate: "2026-10-03" });
  await db.prepare("UPDATE learner_sat_dates SET test_date = '2028-06-03' WHERE account_id = 'account-a'").run();
  const longPlan = await call(req("/api/account/plan", tokenA, csrfA, "POST", {
    settings: { ...settings, primaryDate: "2028-06-03" }, expectedVersionId: third.selected.id,
  }));
  expect(longPlan.status).toBe(200);
  expect((await longPlan.json() as { tasks: unknown[] }).tasks.length).toBeGreaterThan(50);
}, 30000);
