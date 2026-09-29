import { afterAll, expect, it, vi } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import { accountDataRoute } from "../src/accountData";
import worker from "../src/worker";

const origin = "https://whitebook.test";
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "lifecycle-test" } }));
afterAll(async () => { await mf.dispose(); });
async function hash(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
}
const token = (owner: string, device = "1") => owner.repeat(63) + device;
const csrf = (owner: string) => owner.repeat(64);
function req(owner: string, path: string, method = "GET", body?: unknown, device = "1", validCsrf = true, requestOrigin = origin) {
  return new Request(origin + path, { method, headers: {
    Cookie: `__Host-wb_session=${token(owner, device)}`,
    ...(method === "POST" ? { Origin: requestOrigin, "X-CSRF-Token": validCsrf ? csrf(owner) : "0".repeat(64), "Content-Type": "application/json" } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

it("exports all account data without other learners or secrets, then deletes only the owner and revokes every device", async () => {
  const db = await mf.getD1Database("DB");
  const migrationDir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort())
    await db.exec(readFileSync(new URL(file, migrationDir), "utf8").replace(/--[^\r\n]*/g, "").replace(/\r?\n/g, " "));
  for (const owner of ["a", "b"]) {
    await db.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, created_at) VALUES (?, 'google', ?, ?, ?, 1)")
      .bind(owner, `sub-${owner}`, `${owner}@test.invalid`, owner).run();
    for (const device of ["1", "2"])
      await db.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, 9999999999, 1)")
        .bind(await hash(token(owner, device)), owner, await hash(csrf(owner))).run();
  }
  await db.exec(`
    INSERT INTO publication_releases (id, manifest_sha256, created_at) VALUES ('release', 'hash', 1);
    INSERT INTO package_revisions (id, family_id, title, source_revision, published_revision, content_sha256, question_count) VALUES ('rev', 'family', 'Shared', 1, 1, 'hash', 1);
    INSERT INTO publication_questions (revision_id, question_id, source_question_id, ordinal, section, module, question_number, response_type, presentation_json) VALUES ('rev', 'q', 'source', 1, 'Math', 1, 1, 'multiple_choice', '{}');
    INSERT INTO publication_answers (revision_id, question_id, accepted_answers_json) VALUES ('rev', 'q', '["hidden-answer"]');
  `);
  for (const owner of ["a", "b"]) await db.exec(`
    INSERT INTO private_revision_entitlements (account_id, revision_id) VALUES ('${owner}', 'rev');
    INSERT INTO learner_sat_dates (account_id, test_date, selected_at) VALUES ('${owner}', '2026-10-03', 1);
    INSERT INTO official_sat_results (id, account_id, administration_date, total_score, reading_writing_score, math_score, created_at, updated_at) VALUES ('score-${owner}', '${owner}', '2026-08-01', 1200, 600, 600, 1, 1);
    INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, created_at, updated_at) VALUES ('card-${owner}', '${owner}', 'Deck', 'deck', 'word-${owner}', 'word-${owner}', 'meaning', 1, 1);
    INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at) VALUES ('rating-${owner}', 'card-${owner}', '${owner}', 'sure', 'UTC', '2026-10-03', 1);
    INSERT INTO starter_card_rating_events (id, account_id, deck_id, stable_id, rating, rating_zone, next_due, rated_at) VALUES ('starter-rating-${owner}', '${owner}', 'starter', 'word', 'sure', 'UTC', '2026-10-03', 1);
    INSERT INTO learner_attempts (id, account_id, revision_id, kind, status, config_json, questions_json, state_json, created_at_ms, started_at_ms, completed_at_ms, result_json, editor_token_hash, editor_lease_expires_at_ms) VALUES ('attempt-${owner}', '${owner}', 'rev', 'practice', 'completed', '{}', '[]', '{"responses":["response-${owner}"]}', 1, 2, 3, '{}', 'editor-secret-${owner}', 999);
    INSERT INTO guided_reviews (id, account_id, attempt_id, revision_id, question_id, prior_answer_exposure, created_at_ms, updated_at_ms) VALUES ('review-${owner}', '${owner}', 'attempt-${owner}', 'rev', 'q', 'possible', 1, 1);
    INSERT INTO study_notes (id, account_id, revision_id, question_id, body, created_at_ms, updated_at_ms) VALUES ('note-${owner}', '${owner}', 'rev', 'q', 'note-${owner}', 1, 1);
    INSERT INTO study_plan_versions (id, account_id, version, primary_date, settings_json, source_json, created_at_ms) VALUES ('version-${owner}', '${owner}', 1, '2026-10-03', '{"studyDays":[1],"dailyMinutes":30}', '{}', 1);
    INSERT INTO study_plan_tasks (id, account_id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, updated_at_ms) VALUES ('task-${owner}', '${owner}', 'version-${owner}', '2026-09-28', 'practice', 'Practice', 10, '{}', 0, 0, '', 'done', 1);
    INSERT INTO study_plan_task_events (id, account_id, version_id, task_id, event_json, created_at_ms) VALUES ('event-${owner}', '${owner}', 'version-${owner}', 'task-${owner}', '{}', 1);
    INSERT INTO reminder_dismissals (account_id, reminder_key, dismissed_at_ms) VALUES ('${owner}', 'personal_gemini_key', 1);
  `);
  const env = { DB: db, APP_ORIGIN: origin } as never;
  const exported = await accountDataRoute(req("a", "/api/account/export"), env)!;
  expect(exported.status).toBe(200);
  expect(exported.headers.get("Content-Disposition")).toContain("attachment");
  expect(exported.headers.get("Cache-Control")).toContain("no-store");
  const payload = await exported.text();
  for (const wanted of ["sub-a", "response-a", "note-a", "event-a", "rating-a"]) expect(payload).toContain(wanted);
  for (const forbidden of ["sub-b", "response-b", "note-b", "editor-secret-a", "hidden-answer", "token_hash", "csrf_hash"]) expect(payload).not.toContain(forbidden);
  const parsed = JSON.parse(payload) as { schemaVersion: number; data: Record<string, unknown[]> };
  expect(parsed.schemaVersion).toBe(1);
  for (const name of ["attempts", "guidedReviews", "studyNotes", "personalCards", "cardRatings", "starterCardRatings", "officialSatResults", "satDates", "planVersions", "planTasks", "planTaskEvents", "reminderDismissals", "privateRevisionEntitlements"])
    expect(parsed.data[name], name).toHaveLength(1);
  expect((await accountDataRoute(req("a", "/api/account/delete", "POST", { confirmation: "wrong" }), env)!).status).toBe(400);
  expect((await accountDataRoute(req("a", "/api/account/delete", "POST", { confirmation: "DELETE MY ACCOUNT" }, "1", false), env)!).status).toBe(403);
  expect((await accountDataRoute(req("a", "/api/account/delete", "POST", { confirmation: "DELETE MY ACCOUNT" }, "1", true, "https://other.test"), env)!).status).toBe(403);
  const deleted = await accountDataRoute(req("a", "/api/account/delete", "POST", { confirmation: "DELETE MY ACCOUNT" }), env)!;
  expect(deleted.status).toBe(204);
  expect(deleted.headers.getSetCookie().join(" ")).toContain("Max-Age=0");
  expect((await accountDataRoute(req("a", "/api/account/export", "GET", undefined, "2"), env)!).status).toBe(401);
  expect((await accountDataRoute(req("b", "/api/account/export"), env)!).status).toBe(200);
  for (const table of ["learner_sessions", "private_revision_entitlements", "learner_sat_dates", "reminder_dismissals", "official_sat_results", "personal_cards", "card_rating_events", "starter_card_rating_events", "learner_attempts", "guided_reviews", "study_notes", "study_plan_versions", "study_plan_tasks", "study_plan_task_events"]) {
    expect((await db.prepare(`SELECT account_id FROM ${table} WHERE account_id = 'a'`).all()).results, table).toHaveLength(0);
    expect((await db.prepare(`SELECT account_id FROM ${table} WHERE account_id = 'b'`).all()).results, table).toHaveLength(table === "learner_sessions" ? 2 : 1);
  }
  expect((await db.prepare("SELECT COUNT(*) AS count FROM learner_accounts WHERE id = 'a'").first<{ count: number }>())?.count).toBe(0);
  expect((await db.prepare("SELECT COUNT(*) AS count FROM publication_answers").first<{ count: number }>())?.count).toBe(1);
}, 30000);

it("returns a generic error without revealing database exceptions or accepted answers", async () => {
  const secret = "private-answer-and-key";
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const result = await worker.fetch(new Request(origin + "/api/account/export", { headers: { Cookie: `__Host-wb_session=${token("a")}` } }), {
    DB: { prepare() { throw new Error(secret); } }, APP_ORIGIN: origin,
  } as never);
  expect(result.status).toBe(503);
  expect(await result.text()).not.toContain(secret);
  const mutation = await worker.fetch(req("a", "/api/account/delete", "POST", { confirmation: "DELETE MY ACCOUNT" }), {
    DB: { prepare() { return { bind() { return this; }, async first() {
      return { token_hash: "hash", account_id: "a", expires_at: 9999999999, csrf_hash: await hash(csrf("a")) };
    } }; }, async batch() { throw new Error(secret); } }, APP_ORIGIN: origin,
  } as never);
  expect(mutation.status).toBe(503);
  expect(await mutation.text()).not.toContain(secret);
  expect(logged).not.toHaveBeenCalled();
  logged.mockRestore();
});
