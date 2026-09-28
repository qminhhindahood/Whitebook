import { currentSession, failure, noStore, requireMutation, type AccountEnv, type Session } from "./accounts";

// This allowlist is the portable export contract. Never SELECT * here: session
// hashes, editor lease hashes, and future secret columns must stay server-side.
const owned = [
  { name: "privateRevisionEntitlements", table: "private_revision_entitlements", fields: "revision_id", order: "revision_id" },
  { name: "satDates", table: "learner_sat_dates", fields: "test_date, is_primary, selected_at", order: "test_date" },
  { name: "officialSatResults", table: "official_sat_results", fields: "id, administration_date, total_score, reading_writing_score, math_score, band_information_ideas, band_craft_structure, band_expression_of_ideas, band_standard_english_conventions, band_algebra, band_advanced_math, band_problem_solving_data_analysis, band_geometry_trigonometry, created_at, updated_at", order: "administration_date, id" },
  { name: "personalCards", table: "personal_cards", fields: "id, deck, front, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at", order: "created_at, id" },
  { name: "cardRatings", table: "card_rating_events", fields: "id, card_id, rating, rating_zone, next_due, rated_at", order: "rated_at, id" },
  { name: "starterCardRatings", table: "starter_card_rating_events", fields: "id, deck_id, stable_id, rating, rating_zone, next_due, rated_at", order: "rated_at, id" },
  { name: "attempts", table: "learner_attempts", fields: "id, revision_id, kind, status, config_json, questions_json, state_json, state_version, created_at_ms, started_at_ms, deadline_at_ms, completed_at_ms, result_json, answers_exposed_at_ms, assisted_at_ms", order: "created_at_ms, id" },
  { name: "guidedReviews", table: "guided_reviews", fields: "id, attempt_id, revision_id, question_id, prior_answer_exposure, retry_response, hint_used, revealed_at_ms, mistake_label, created_at_ms, updated_at_ms", order: "created_at_ms, id" },
  { name: "studyNotes", table: "study_notes", fields: "id, revision_id, question_id, body, created_at_ms, updated_at_ms", order: "created_at_ms, id" },
  { name: "planVersions", table: "study_plan_versions", fields: "id, version, primary_date, settings_json, source_json, created_at_ms", order: "version" },
  { name: "planTasks", table: "study_plan_tasks", fields: "id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, revision, updated_at_ms", order: "scheduled_date, id" },
  { name: "planTaskEvents", table: "study_plan_task_events", fields: "id, version_id, task_id, event_json, created_at_ms", order: "created_at_ms, id" },
] as const;

const jsonNames: Record<string, string> = {
  config_json: "config", questions_json: "questions", state_json: "state",
  result_json: "result", settings_json: "settings", source_json: "source",
  action_json: "action", event_json: "event",
};

function portable(row: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row))
    result[jsonNames[key] ?? key] = key in jsonNames && value !== null ? JSON.parse(value as string) : value;
  return result;
}

async function exportAccount(env: AccountEnv, session: Session): Promise<Response> {
  const account = await env.DB.prepare("SELECT id, provider, provider_subject, email, display_name, nickname, time_zone, created_at FROM learner_accounts WHERE id = ?")
    .bind(session.account_id).first<Record<string, unknown>>();
  if (!account) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const data: Record<string, Record<string, unknown>[]> = {};
  for (const item of owned) {
    const result = await env.DB.prepare(`SELECT ${item.fields} FROM ${item.table} WHERE account_id = ? ORDER BY ${item.order}`)
      .bind(session.account_id).all();
    data[item.name] = (result.results as Record<string, unknown>[]).map(portable);
  }
  return Response.json({ format: "whitebook-account-export", schemaVersion: 1,
    exportedAt: new Date().toISOString(), account, data }, {
    headers: { ...noStore, "Content-Disposition": 'attachment; filename="whitebook-account-export.json"' },
  });
}

async function deleteAccount(request: Request, env: AccountEnv, session: Session): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  if (!(request.headers.get("Content-Type") ?? "").toLowerCase().startsWith("application/json"))
    return failure(400, "invalid_confirmation", "Type DELETE MY ACCOUNT to confirm deletion.");
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 128) return failure(400, "invalid_confirmation", "Type DELETE MY ACCOUNT to confirm deletion.");
    body = JSON.parse(raw);
  } catch {
    return failure(400, "invalid_confirmation", "Type DELETE MY ACCOUNT to confirm deletion.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || (body as { confirmation?: unknown }).confirmation !== "DELETE MY ACCOUNT")
    return failure(400, "invalid_confirmation", "Type DELETE MY ACCOUNT to confirm deletion.");

  // D1 batch is atomic. Child rows are removed before parent rows, including
  // Every account_id FK is removed; assistant nonce/credential rows also cascade
  // with the account. They contain no portable study data and are never exported.
  const order = [
    "study_plan_task_events", "study_plan_tasks", "study_plan_versions",
    "study_notes", "guided_reviews", "card_rating_events", "starter_card_rating_events",
    "personal_cards", "learner_attempts", "official_sat_results", "learner_sat_dates",
    "private_revision_entitlements", "learner_sessions",
  ];
  await env.DB.batch([
    env.DB.prepare("DELETE FROM assistant_limits WHERE scope IN (?, ?)").bind(`preview:${session.account_id}`, `send:${session.account_id}`),
    ...order.map(table => env.DB.prepare(`DELETE FROM ${table} WHERE account_id = ?`).bind(session.account_id)),
    env.DB.prepare("DELETE FROM learner_accounts WHERE id = ?").bind(session.account_id),
  ]);
  const headers = new Headers({ ...noStore, "Clear-Site-Data": '"cache"' });
  headers.append("Set-Cookie", "__Host-wb_session=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax");
  headers.append("Set-Cookie", "__Host-wb_csrf=; Path=/; Max-Age=0; Secure; SameSite=Lax");
  return new Response(null, { status: 204, headers });
}

export function accountDataRoute(request: Request, env: AccountEnv): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (path !== "/api/account/export" && path !== "/api/account/delete") return null;
  if (!(request.method === "GET" && path === "/api/account/export") &&
      !(request.method === "POST" && path === "/api/account/delete"))
    return Promise.resolve(failure(405, "method_not_allowed", "This account action is unavailable."));
  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
    return path === "/api/account/export" ? exportAccount(env, session) : deleteAccount(request, env, session);
  })();
}
