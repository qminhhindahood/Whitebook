import { currentSession, failure, json, requireMutation, type AccountEnv, type Session } from "./accounts";
import { addCalendarDays, isValidZone, localCalendarDate } from "./schedule";
import { summarizeProgress } from "./progress";
import { studyRoute } from "./study";

export type PlanSettings = { primaryDate: string; studyDays: number[]; restDays: number[]; dailyMinutes: number; officialScoreGoal: number | null };
type Action = { area: "cards" | "history" | "practice"; attemptId?: string; questionId?: string; revisionId?: string; section?: string };
export type PlannedTask = { date: string; kind: "cards" | "review" | "practice"; title: string; minutes: number;
  action: Action; evidenceCount: number; tentative: boolean; explanation: string };
type Missed = { attemptId: string; questionId: string; section: string; questionNumber: number; reviewOutcome?: "unfinished" | "retry-incorrect" | "revealed-without-retry" };
type Practice = { revisionId: string; packageTitle: string; section: string; questionCount: number;
  evidenceCount: number; rawAccuracy: number | null; tentative: boolean; officialEvidence?: string };
export type PlanInputs = { dueCards: number; missed: Missed[]; practice: Practice[]; officialResultCount: number };

const YMD = /^\d{4}-\d{2}-\d{2}$/;
function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !YMD.test(value)) return false;
  try { return addCalendarDays(value, 0) === value; } catch { return false; }
}
function weekday(date: string): number { return new Date(`${date}T12:00:00Z`).getUTCDay(); }

export function validateSettings(value: unknown): PlanSettings | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (Object.keys(item).some((key) => !["primaryDate", "studyDays", "restDays", "dailyMinutes", "officialScoreGoal"].includes(key))) return null;
  const days = (v: unknown): v is number[] => Array.isArray(v) && v.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) && new Set(v).size === v.length;
  if (!validDate(item.primaryDate) || !days(item.studyDays) || !days(item.restDays) || !item.studyDays.length ||
    new Set([...item.studyDays, ...item.restDays]).size !== 7 || item.studyDays.length + item.restDays.length !== 7 ||
    !Number.isInteger(item.dailyMinutes) || (item.dailyMinutes as number) < 10 || (item.dailyMinutes as number) > 240 ||
    !(item.officialScoreGoal === null || (Number.isInteger(item.officialScoreGoal) && (item.officialScoreGoal as number) >= 400 &&
      (item.officialScoreGoal as number) <= 1600 && (item.officialScoreGoal as number) % 10 === 0))) return null;
  return item as PlanSettings;
}

export function buildPlan(today: string, settings: PlanSettings, input: PlanInputs): PlannedTask[] {
  const tasks: PlannedTask[] = [];
  const remaining = new Map<string, number>();
  const dates: string[] = [];
  for (let date = today; date < settings.primaryDate; date = addCalendarDays(date, 1)) {
    if (settings.studyDays.includes(weekday(date))) { dates.push(date); remaining.set(date, settings.dailyMinutes); }
  }
  const place = (task: Omit<PlannedTask, "date">, earliest = today): boolean => {
    const date = dates.find((day) => day >= earliest && (remaining.get(day) ?? 0) >= task.minutes);
    if (!date) return false;
    tasks.push({ ...task, date }); remaining.set(date, remaining.get(date)! - task.minutes);
    return true;
  };
  if (input.dueCards > 0) {
    const minutes = Math.min(20, settings.dailyMinutes);
    place({ kind: "cards", title: `Review up to ${Math.min(input.dueCards, minutes)} due cards`,
      minutes, action: { area: "cards" }, evidenceCount: input.dueCards,
      tentative: false, explanation: `${input.dueCards} cards are due as of this plan build. Review a manageable set and check the live due queue when you start.` });
  }
  for (const missed of input.missed.slice(0, 12)) place({ kind: "review",
    title: `Review missed ${missed.section} question ${missed.questionNumber}`, minutes: 10,
    action: { area: "history", attemptId: missed.attemptId, questionId: missed.questionId }, evidenceCount: 1,
    tentative: true, explanation: `One incorrect or unanswered response in a completed Attempt.${missed.reviewOutcome === "unfinished" ? " A guided review was started but not finished." :
      missed.reviewOutcome === "retry-incorrect" ? " The latest guided retry was still incorrect." :
      missed.reviewOutcome === "revealed-without-retry" ? " The answer was revealed without a successful retry." : ""} Guided retry does not change Raw Accuracy.` });
  if (input.practice.length) {
    const weeks = new Map<string, string>();
    for (const date of dates) {
      const monday = addCalendarDays(date, -((weekday(date) + 6) % 7));
      if (!weeks.has(monday)) weeks.set(monday, date);
    }
    let index = 0;
    for (const earliest of weeks.values()) {
      const activity = input.practice[index++ % input.practice.length];
      place({ kind: "practice", title: `Practice ${activity.section} · ${activity.packageTitle}`,
        minutes: Math.min(25, settings.dailyMinutes), action: { area: "practice", revisionId: activity.revisionId, section: activity.section },
        evidenceCount: activity.evidenceCount, tentative: activity.tentative || activity.evidenceCount === 0,
        explanation: activity.evidenceCount ? `${activity.evidenceCount} unassisted graded questions in this Section; Raw Accuracy ${activity.rawAccuracy}%. This is Whitebook practice evidence, not an SAT score.${activity.officialEvidence ? ` Separately: ${activity.officialEvidence}` : ""}`
          : `Baseline Practice from an available Test Package; no unassisted Section evidence yet. ${activity.officialEvidence ?? "Start here to establish a baseline."}` }, earliest);
    }
  }
  return tasks.sort((a, b) => a.date.localeCompare(b.date) || ({ cards: 0, review: 1, practice: 2 }[a.kind] - { cards: 0, review: 1, practice: 2 }[b.kind]));
}

type VersionRow = { id: string; version: number; primary_date: string; settings_json: string; source_json: string; created_at_ms: number };
type AttemptEvidenceRow = { id: string; revision_id: string; kind: string; completed_at_ms: number; questions_json: string; result_json: string; state_json: string };
type GuidedOutcomeRow = { attempt_id: string; question_id: string; retry_response: string | null; revealed_at_ms: number | null; updated_at_ms: number };
type TaskRow = { id: string; version_id: string; scheduled_date: string; kind: PlannedTask["kind"]; title: string;
  estimated_minutes: number; action_json: string; evidence_count: number; tentative: number; explanation: string;
  status: "pending" | "done" | "skipped"; revision: number; updated_at_ms: number };
const TASK_COLUMNS = "id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, revision, updated_at_ms";
const VERSION_COLUMNS = "id, version, primary_date, settings_json, source_json, created_at_ms";
function taskJson(row: TaskRow) { return { id: row.id, versionId: row.version_id, date: row.scheduled_date, kind: row.kind,
  title: row.title, minutes: row.estimated_minutes, action: JSON.parse(row.action_json) as Action, evidenceCount: row.evidence_count,
  tentative: !!row.tentative, explanation: row.explanation, status: row.status, revision: row.revision }; }
function versionJson(row: VersionRow) { return { id: row.id, version: row.version, primaryDate: row.primary_date,
  settings: JSON.parse(row.settings_json) as PlanSettings, source: JSON.parse(row.source_json), createdAt: row.created_at_ms }; }
async function all<T>(env: AccountEnv, sql: string, ...args: unknown[]): Promise<T[]> {
  return (await env.DB.prepare(sql).bind(...args).all()).results as T[];
}
async function currentVersion(env: AccountEnv, accountId: string) {
  return env.DB.prepare(`SELECT ${VERSION_COLUMNS} FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1`)
    .bind(accountId).first<VersionRow>();
}

export function missedQuestions(attemptRows: AttemptEvidenceRow[], reviews: GuidedOutcomeRow[], available: Set<string>): Missed[] {
  const latestReview = new Map<string, GuidedOutcomeRow>();
  for (const row of [...reviews].sort((a, b) => b.updated_at_ms - a.updated_at_ms)) {
    const key = `${row.attempt_id}\u0000${row.question_id}`;
    if (!latestReview.has(key)) latestReview.set(key, row);
  }
  const assigned = new Set<string>();
  const missed: Missed[] = [];
  for (const row of attemptRows) {
    if (!available.has(row.revision_id)) continue;
    const links = new Map((JSON.parse(row.questions_json) as { questionId: string; section: string; questionNumber: number }[]).map((item) => [item.questionId, item]));
    for (const grade of (JSON.parse(row.result_json) as { questions: { questionId: string; correct: boolean; acceptedAnswers: string[] }[] }).questions) {
      const link = links.get(grade.questionId);
      const identity = `${row.revision_id}\u0000${grade.questionId}`;
      if (!link || assigned.has(identity)) continue;
      assigned.add(identity);
      if (grade.correct) continue;
      const review = latestReview.get(`${row.id}\u0000${grade.questionId}`);
      const retryCorrect = review?.revealed_at_ms != null && review.retry_response !== null &&
        grade.acceptedAnswers?.some((answer) => answer.trim().toLocaleLowerCase() === review.retry_response!.trim().toLocaleLowerCase());
      if (retryCorrect) continue;
      missed.push({ attemptId: row.id, questionId: grade.questionId, section: link.section, questionNumber: link.questionNumber,
        ...(review ? { reviewOutcome: review.revealed_at_ms === null ? "unfinished" as const :
          review.retry_response === null ? "revealed-without-retry" as const : "retry-incorrect" as const } : {}) });
    }
  }
  return missed;
}
async function context(request: Request, env: AccountEnv, accountId: string, now: number) {
  const [account, dates, scores, attempts, reviewed, packages] = await Promise.all([
    env.DB.prepare("SELECT time_zone FROM learner_accounts WHERE id = ?").bind(accountId).first<{ time_zone: string }>(),
    env.DB.prepare("SELECT test_date FROM learner_sat_dates WHERE account_id = ? AND is_primary = 1").bind(accountId).first<{ test_date: string }>(),
    env.DB.prepare("SELECT id, administration_date, reading_writing_score, math_score, updated_at FROM official_sat_results WHERE account_id = ? ORDER BY updated_at DESC").bind(accountId).all(),
    env.DB.prepare("SELECT id, revision_id, kind, completed_at_ms, questions_json, result_json, state_json FROM learner_attempts WHERE account_id = ? AND status = 'completed' AND result_json IS NOT NULL ORDER BY completed_at_ms DESC").bind(accountId).all(),
    env.DB.prepare("SELECT attempt_id, question_id, retry_response, revealed_at_ms, updated_at_ms FROM guided_reviews WHERE account_id = ?").bind(accountId).all(),
    env.DB.prepare(`SELECT p.id AS revision_id, p.title, q.section, COUNT(*) AS question_count FROM package_revisions p JOIN publication_questions q ON q.revision_id = p.id
      WHERE EXISTS (SELECT 1 FROM active_publication a JOIN publication_release_revisions r ON r.release_id = a.release_id AND r.revision_id = p.id)
      OR EXISTS (SELECT 1 FROM private_revision_entitlements e WHERE e.revision_id = p.id AND e.account_id = ?)
      GROUP BY p.id, p.title, q.section ORDER BY p.title, q.section`).bind(accountId).all(),
  ]);
  const zone = account?.time_zone && isValidZone(account.time_zone) ? account.time_zone : "UTC";
  const today = localCalendarDate(now, zone);
  const cardRequest = new Request(new URL(`/api/cards/study?zone=${encodeURIComponent(zone)}`, request.url), { headers: request.headers });
  const cardResponse = await studyRoute(cardRequest, env, () => now);
  if (!cardResponse?.ok) throw new Error("Due cards could not be loaded for planning");
  const dueCards = ((await cardResponse.json()) as { totalDue: number }).totalDue;
  const attemptRows = attempts.results as AttemptEvidenceRow[];
  const revisions = [...new Set(attemptRows.map((item) => item.revision_id))];
  const categories = revisions.length ? await all<{ revision_id: string; question_id: string; section: "Math" | "Reading and Writing"; category: string | null }>(env,
    `SELECT pq.revision_id, pq.question_id, pq.section, pc.category FROM publication_questions pq LEFT JOIN publication_question_categories pc
      ON pc.revision_id = pq.revision_id AND pc.question_id = pq.question_id WHERE pq.revision_id IN (${revisions.map(() => "?").join(",")})`, ...revisions) : [];
  const progress = summarizeProgress(attemptRows, categories);
  const available = new Set((packages.results as { revision_id: string }[]).map((item) => item.revision_id));
  const missed = missedQuestions(attemptRows, reviewed.results as GuidedOutcomeRow[], available);
  const latestScore = (scores.results as { reading_writing_score: number; math_score: number }[])[0];
  const practice = (packages.results as { revision_id: string; title: string; section: string; question_count: number }[])
    .map((item) => { const evidence = progress.sections.find((section) => section.section === item.section);
      const score = item.section === "Math" ? latestScore?.math_score : latestScore?.reading_writing_score;
      return { revisionId: item.revision_id, packageTitle: item.title, section: item.section, questionCount: Number(item.question_count),
        evidenceCount: evidence?.sampleSize ?? 0, rawAccuracy: evidence?.rawAccuracy ?? null, tentative: evidence?.tentative ?? true,
        officialEvidence: score === undefined ? undefined : `Learner-entered Official SAT ${item.section} score ${score}; no SAT point gain is promised.` }; })
    .sort((a, b) => (a.evidenceCount ? a.rawAccuracy! : 101) - (b.evidenceCount ? b.rawAccuracy! : 101) ||
      (latestScore ? (a.section === "Math" ? latestScore.math_score : latestScore.reading_writing_score) -
        (b.section === "Math" ? latestScore.math_score : latestScore.reading_writing_score) : 0) || a.packageTitle.localeCompare(b.packageTitle));
  const officialResultCount = scores.results.length;
  const source = { primaryDate: dates?.test_date ?? null, attemptCount: attemptRows.length,
    latestAttempt: attemptRows[0]?.id ?? null, latestAttemptAt: attemptRows[0]?.completed_at_ms ?? null,
    officialResultCount, latestOfficialResult: (scores.results as { id: string; updated_at: number }[])[0] ?? null,
    reviewCount: reviewed.results.length, latestReviewAt: Math.max(0, ...(reviewed.results as { updated_at_ms: number }[]).map((r) => r.updated_at_ms)), dueCards,
    availableActivities: practice.map((activity) => `${activity.revisionId}:${activity.section}`) };
  return { today, zone, primaryDate: dates?.test_date ?? null, inputs: { dueCards, missed, practice, officialResultCount }, source };
}

async function show(request: Request, env: AccountEnv, session: Session, now: number): Promise<Response> {
  const [versions, ctx] = await Promise.all([
    all<VersionRow>(env, `SELECT ${VERSION_COLUMNS} FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC`, session.account_id),
    context(request, env, session.account_id, now),
  ]);
  const requested = new URL(request.url).searchParams.get("version");
  if (requested && !versions.some((v) => v.id === requested)) return failure(404, "not_found", "This plan version is unavailable.");
  const selected = versions.find((v) => v.id === requested) ?? versions[0];
  const tasks = selected ? await all<TaskRow>(env, `SELECT ${TASK_COLUMNS} FROM study_plan_tasks WHERE account_id = ? AND version_id = ? ORDER BY scheduled_date, rowid`, session.account_id, selected.id) : [];
  const completedHistory = await env.DB.prepare("SELECT COUNT(*) AS count FROM study_plan_tasks WHERE account_id = ? AND status = 'done'")
    .bind(session.account_id).first<{ count: number }>();
  const overdue = selected?.id === versions[0]?.id ? tasks.filter((t) => t.status === "pending" && t.scheduled_date < ctx.today) : [];
  return json({ today: ctx.today, zone: ctx.zone, primaryDate: ctx.primaryDate,
    baseline: ctx.source.attemptCount === 0 && ctx.source.officialResultCount === 0,
    evidence: { dueCards: ctx.inputs.dueCards, missedQuestions: ctx.inputs.missed.length, completedAttempts: ctx.source.attemptCount, officialResultCount: ctx.source.officialResultCount },
    stale: !!versions[0] && JSON.stringify(JSON.parse(versions[0].source_json)) !== JSON.stringify(ctx.source),
    versions: versions.map(versionJson), selected: selected ? versionJson(selected) : null,
    tasks: tasks.map(taskJson), completedHistory: Number(completedHistory?.count ?? 0),
    catchUp: { overdueCount: overdue.length, choices: ["Move one task to the next available study day", "Skip a task that no longer helps", "Rebuild from current evidence"] } });
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const raw = await request.text();
  if (raw.length > 8192) return failure(413, "too_large", "This plan change is too large.");
  try { const body = JSON.parse(raw); return body && typeof body === "object" && !Array.isArray(body) ? body as Record<string, unknown>
    : failure(400, "invalid_plan", "Send the plan change as an object."); }
  catch { return failure(400, "invalid_plan", "Send the plan change as JSON."); }
}

async function rebuild(request: Request, env: AccountEnv, session: Session, now: number): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (Object.keys(body).some((key) => !["settings", "expectedVersionId"].includes(key)) ||
    !(body.expectedVersionId === null || typeof body.expectedVersionId === "string"))
    return failure(400, "invalid_plan", "Open the latest plan before rebuilding.");
  const settings = validateSettings(body.settings);
  if (!settings) return failure(400, "invalid_settings", "Choose a study day, rest days, 10–240 daily minutes, and a valid optional official-score goal.");
  const [ctx, previous] = await Promise.all([context(request, env, session.account_id, now), currentVersion(env, session.account_id)]);
  if (settings.primaryDate !== ctx.primaryDate || settings.primaryDate <= ctx.today)
    return failure(400, "invalid_date", "Choose a future primary SAT Weekend date on the Dashboard first.");
  if ((previous?.id ?? null) !== body.expectedVersionId) return failure(409, "plan_changed", "A newer plan exists. Reload before rebuilding.");
  const completedReviews = await all<{ action_json: string }>(env,
    "SELECT action_json FROM study_plan_tasks WHERE account_id = ? AND kind = 'review' AND status = 'done'", session.account_id);
  const completedKeys = new Set(completedReviews.map((row) => {
    const action = JSON.parse(row.action_json) as Action;
    return `${action.attemptId}\u0000${action.questionId}`;
  }));
  const generated = buildPlan(ctx.today, settings, { ...ctx.inputs,
    missed: ctx.inputs.missed.filter((item) => !completedKeys.has(`${item.attemptId}\u0000${item.questionId}`)) });
  const id = crypto.randomUUID();
  const statements = [env.DB.prepare(`INSERT INTO study_plan_versions (id, account_id, version, primary_date, settings_json, source_json, created_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, session.account_id, (previous?.version ?? 0) + 1, settings.primaryDate, JSON.stringify(settings), JSON.stringify(ctx.source), now)];
  if (generated.length) {
    const rowsJson = JSON.stringify(generated.map((task) => ({ ...task, id: crypto.randomUUID() })));
    statements.push(env.DB.prepare(`INSERT INTO study_plan_tasks
    (id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, revision, account_id, updated_at_ms)
    SELECT json_extract(j.value, '$.id'), ?, json_extract(j.value, '$.date'), json_extract(j.value, '$.kind'),
      json_extract(j.value, '$.title'), json_extract(j.value, '$.minutes'), json_extract(j.value, '$.action'),
      json_extract(j.value, '$.evidenceCount'), json_extract(j.value, '$.tentative'), json_extract(j.value, '$.explanation'),
      'pending', 0, ?, ? FROM json_each(?) j`)
      .bind(id, session.account_id, now, rowsJson));
  }
  try { await env.DB.batch(statements); }
  catch { return failure(409, "plan_changed", "The plan changed while rebuilding. Reload and try again."); }
  return show(request, env, session, now);
}

async function changeTask(request: Request, env: AccountEnv, session: Session, id: string, now: number): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const body = await readBody(request);
  if (body instanceof Response) return body;
  if (Object.keys(body).some((key) => !["expectedRevision", "status", "date", "minutes", "title"].includes(key)) ||
    !Number.isInteger(body.expectedRevision) || (body.expectedRevision as number) < 0)
    return failure(400, "invalid_task", "Reload this task before changing it.");
  const latest = await currentVersion(env, session.account_id);
  const task = await env.DB.prepare(`SELECT ${TASK_COLUMNS} FROM study_plan_tasks WHERE id = ? AND account_id = ?`).bind(id, session.account_id).first<TaskRow>();
  if (!task) return failure(404, "not_found", "This task is unavailable.");
  if (task.version_id !== latest?.id || task.revision !== body.expectedRevision)
    return failure(409, "task_changed", "This task or plan changed. Reload and try again.");
  const primary = await env.DB.prepare("SELECT test_date FROM learner_sat_dates WHERE account_id = ? AND is_primary = 1")
    .bind(session.account_id).first<{ test_date: string }>();
  if (primary?.test_date !== latest.primary_date)
    return failure(409, "plan_stale", "Your primary exam date changed. Rebuild before editing this plan.");
  const settings = JSON.parse(latest.settings_json) as PlanSettings;
  const zone = await env.DB.prepare("SELECT time_zone FROM learner_accounts WHERE id = ?").bind(session.account_id).first<{ time_zone: string }>();
  const today = localCalendarDate(now, zone?.time_zone && isValidZone(zone.time_zone) ? zone.time_zone : "UTC");
  const date = body.date === undefined ? task.scheduled_date : body.date;
  const minutes: unknown = body.minutes === undefined ? task.estimated_minutes : body.minutes;
  const title: unknown = body.title === undefined ? task.title : body.title;
  const status: unknown = body.status === undefined ? task.status : body.status;
  if (!validDate(date) || !settings.studyDays.includes(weekday(date)) || date >= settings.primaryDate ||
    (body.date !== undefined && date < today) || typeof minutes !== "number" || !Number.isInteger(minutes) || minutes < 5 || minutes > settings.dailyMinutes ||
    typeof title !== "string" || !title.trim() || title.trim().length > 120 ||
    typeof status !== "string" || !["pending", "done", "skipped"].includes(status))
    return failure(400, "invalid_task", "Keep tasks on a study day before the exam, within your daily minutes.");
  const other = await all<{ estimated_minutes: number }>(env,
    "SELECT estimated_minutes FROM study_plan_tasks WHERE account_id = ? AND version_id = ? AND scheduled_date = ? AND id <> ? AND status != 'skipped'",
    session.account_id, latest.id, date, id);
  if (status !== "skipped" && other.reduce((sum, row) => sum + row.estimated_minutes, 0) + (minutes as number) > settings.dailyMinutes)
    return failure(409, "day_full", "That day is full. Choose another study day or shorten the task.");
  const latestGuard = "version_id = (SELECT id FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1)";
  let results: { meta: { changes?: number } }[];
  try { results = await env.DB.batch([
    env.DB.prepare(`INSERT INTO study_plan_task_events (id, account_id, version_id, task_id, event_json, created_at_ms)
      SELECT ?, ?, version_id, id, ?, ? FROM study_plan_tasks WHERE id = ? AND account_id = ? AND revision = ? AND ${latestGuard}`)
      .bind(crypto.randomUUID(), session.account_id, JSON.stringify({ from: taskJson(task), to: { date, minutes, title: (title as string).trim(), status } }),
        now, id, session.account_id, task.revision, session.account_id),
    env.DB.prepare(`UPDATE study_plan_tasks SET scheduled_date = ?, estimated_minutes = ?, title = ?, status = ?, revision = revision + 1, updated_at_ms = ?
      WHERE id = ? AND account_id = ? AND revision = ? AND ${latestGuard}`)
      .bind(date, minutes, (title as string).trim(), status, now, id, session.account_id, task.revision, session.account_id),
  ]) as { meta: { changes?: number } }[]; }
  catch { return failure(409, "day_full", "That day is full or the plan changed. Reload and choose another study day."); }
  if (results[1]?.meta.changes !== 1) return failure(409, "task_changed", "This task changed. Reload and try again.");
  const saved = await env.DB.prepare(`SELECT ${TASK_COLUMNS} FROM study_plan_tasks WHERE id = ? AND account_id = ?`).bind(id, session.account_id).first<TaskRow>();
  return json({ task: taskJson(saved!) });
}

export function planRoute(request: Request, env: AccountEnv, now: () => number = Date.now): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/account/plan")) return null;
  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in to open your Study Plan.");
    if (path === "/api/account/plan" && request.method === "GET") return show(request, env, session, now());
    if (path === "/api/account/plan" && request.method === "POST") return rebuild(request, env, session, now());
    const task = /^\/api\/account\/plan\/tasks\/([a-f0-9-]{36})$/i.exec(path);
    if (task && request.method === "PATCH") return changeTask(request, env, session, task[1], now());
    return failure(404, "not_found", "This Study Plan action is unavailable.");
  })();
}
