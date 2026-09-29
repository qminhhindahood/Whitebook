import { failure, type AccountEnv } from "./accounts";
import { planContext, validDate, validateSettings, type PlanSettings, type PlannedTask } from "./plan";
import { progressRoute } from "./progress";

type Selection = { official: boolean; whitebook: boolean };
export type Proposal = Pick<PlannedTask, "date" | "kind" | "title" | "minutes" | "action" | "explanation">;
type Version = { id: string; version: number };
type CatalogActivity = { revisionId: string; packageTitle: string; section: string; questionCount: number; evidenceCount: number; rawAccuracy: number | null; tentative: boolean };
export type PlanEnvelope = { flow: "study_plan_suggestion"; today: string; officialSatResult: unknown; whitebookSectionExam: unknown;
  officialScoreGoal: number | null; primarySatTarget: string; aggregateEvidence: unknown; dueCardTotal: number;
  planConstraints: { studyDays: number[]; restDays: number[]; dailyMinutes: number }; activityCatalog: CatalogActivity[] };

const BANDS = ["informationIdeas", "craftStructure", "expressionOfIdeas", "standardEnglishConventions", "algebra", "advancedMath", "problemSolvingDataAnalysis", "geometryTrigonometry"] as const;
const COLUMNS = ["band_information_ideas", "band_craft_structure", "band_expression_of_ideas", "band_standard_english_conventions", "band_algebra", "band_advanced_math", "band_problem_solving_data_analysis", "band_geometry_trigonometry"] as const;
const invalid = () => failure(422, "invalid_suggestions", "These suggested tasks do not fit your current Study Plan. Preview a new suggestion or continue manually.");
const changed = () => failure(409, "plan_changed", "A newer plan or result is available. Preview again before accepting suggestions.");
const weekday = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

export async function planEnvelope(request: Request, env: AccountEnv, accountId: string, now: number,
  selection: Selection, settingsValue: unknown): Promise<{ envelope: PlanEnvelope; settings: PlanSettings; context: Awaited<ReturnType<typeof planContext>> } | Response> {
  if (!selection.official && !selection.whitebook)
    return failure(409, "result_source_required", "Select at least one available Official SAT Result or Whitebook Section Exam summary.");
  const settings = validateSettings(settingsValue);
  if (!settings) return failure(400, "invalid_settings", "Choose valid study days, rest days, daily minutes, and an optional score goal.");
  const ctx = await planContext(request, env, accountId, now);
  if (!ctx.primaryDate || settings.primaryDate !== ctx.primaryDate || ctx.primaryDate <= ctx.today)
    return failure(400, "invalid_date", "Choose a future Primary SAT Target on the Dashboard first.");
  const [score, attempt, progressResponse] = await Promise.all([
    selection.official ? env.DB.prepare(`SELECT id, administration_date, total_score, reading_writing_score, math_score, ${COLUMNS.join(", ")} FROM official_sat_results
      WHERE account_id = ? ORDER BY administration_date DESC, created_at DESC, rowid DESC LIMIT 1`).bind(accountId).first<Record<string, string | number | null>>() : null,
    selection.whitebook ? env.DB.prepare(`SELECT id, config_json, completed_at_ms, result_json FROM learner_attempts
      WHERE account_id = ? AND kind = 'section_exam' AND status = 'completed' AND result_json IS NOT NULL
      ORDER BY completed_at_ms DESC, rowid DESC LIMIT 1`).bind(accountId).first<{ id: string; config_json: string; completed_at_ms: number; result_json: string }>() : null,
    progressRoute(new Request(new URL("/api/account/progress", request.url), { headers: request.headers }), env),
  ]);
  if ((selection.official && !score) || (selection.whitebook && !attempt))
    return failure(409, "result_source_required", "A selected result is unavailable. Choose an available source or continue with your Study Plan.");
  const result = attempt ? JSON.parse(attempt.result_json) as { correctCount: number; questionCount: number } : null;
  const section = attempt ? (JSON.parse(attempt.config_json) as { section?: string }).section : null;
  if (attempt && (!result || !Number.isInteger(result.correctCount) || !Number.isInteger(result.questionCount) || result.questionCount <= 0 ||
    result.correctCount < 0 || result.correctCount > result.questionCount || !["Math", "Reading and Writing"].includes(section ?? "")))
    return failure(409, "result_source_required", "This Section Exam summary is unavailable.");
  if (!progressResponse?.ok) return failure(503, "service_unavailable", "Progress evidence could not be loaded.");
  const aggregateEvidence = await progressResponse.json();
  const envelope: PlanEnvelope = {
    flow: "study_plan_suggestion",
    today: ctx.today,
    officialSatResult: score ? { label: "Official SAT Result", resultId: score.id, administrationDate: score.administration_date,
      total: score.total_score, readingWriting: score.reading_writing_score, math: score.math_score,
      skillsInsightBands: Object.fromEntries(BANDS.map((band, index) => [band, score[COLUMNS[index]]])) } : null,
    whitebookSectionExam: attempt && result ? { label: "Whitebook Raw Accuracy", attemptId: attempt.id, section,
      completedAt: attempt.completed_at_ms, questionCount: result.questionCount,
      rawAccuracy: Math.round(result.correctCount / result.questionCount * 1000) / 10 } : null,
    officialScoreGoal: settings.officialScoreGoal, primarySatTarget: settings.primaryDate,
    aggregateEvidence, dueCardTotal: ctx.inputs.dueCards,
    planConstraints: { studyDays: settings.studyDays, restDays: settings.restDays, dailyMinutes: settings.dailyMinutes },
    activityCatalog: ctx.inputs.practice.map(({ revisionId, packageTitle, section, questionCount, evidenceCount, rawAccuracy, tentative }) =>
      ({ revisionId, packageTitle, section, questionCount, evidenceCount, rawAccuracy, tentative }))
      .sort((a, b) => a.packageTitle.localeCompare(b.packageTitle) || a.section.localeCompare(b.section) || a.revisionId.localeCompare(b.revisionId)),
  };
  return { envelope, settings, context: ctx };
}

export function parseProposals(text: string): Proposal[] | null {
  if (text.length > 12000) return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (!Array.isArray(value) || !value.length || value.length > 20) return null;
    return value as Proposal[];
  } catch { return null; }
}

export async function completedReviewKeys(env: AccountEnv, accountId: string): Promise<Set<string>> {
  const rows = await env.DB.prepare("SELECT action_json FROM study_plan_tasks WHERE account_id = ? AND kind = 'review' AND status = 'done'")
    .bind(accountId).all();
  return new Set((rows.results as { action_json: string }[]).map(row => {
    const action = JSON.parse(row.action_json) as { attemptId?: string; questionId?: string };
    return `${action.attemptId}\u0000${action.questionId}`;
  }));
}

export function validateProposals(proposals: Proposal[], settings: PlanSettings, ctx: Awaited<ReturnType<typeof planContext>>,
  completedReviews: Set<string> = new Set()): PlannedTask[] | Response {
  const used = new Map<string, number>();
  const reviewKeys = new Set<string>();
  const tasks: PlannedTask[] = [];
  for (const task of proposals) {
    if (!task || typeof task !== "object" || Array.isArray(task) ||
      Object.keys(task).some(key => !["date", "kind", "title", "minutes", "action", "explanation"].includes(key)) ||
      !validDate(task.date) || task.date < ctx.today || task.date >= settings.primaryDate || !settings.studyDays.includes(weekday(task.date)) ||
      typeof task.minutes !== "number" || !Number.isInteger(task.minutes) || task.minutes < 5 || task.minutes > settings.dailyMinutes ||
      typeof task.title !== "string" || !task.title.trim() || task.title.trim().length > 120 ||
      /\b(?:guarantee|predict)\w*\b|\b\d+\s*(?:SAT\s*)?points?\b|\b(?:gain|raise|boost|improve)\w*\b.{0,40}\b(?:SAT|score|points?)\b/i.test(task.title) ||
      typeof task.explanation !== "string" || !task.explanation.trim() || task.explanation.length > 500 ||
      !task.action || typeof task.action !== "object" || Array.isArray(task.action)) return invalid();
    const minutes = (used.get(task.date) ?? 0) + task.minutes;
    if (minutes > settings.dailyMinutes) return failure(409, "day_full", "Suggested tasks exceed the available minutes on a study day.");
    used.set(task.date, minutes);
    let evidenceCount = 0; let tentative = true; let explanation = ""; let title = "";
    if (task.kind === "cards" && task.action.area === "cards" && Object.keys(task.action).length === 1 && ctx.inputs.dueCards > 0) {
      evidenceCount = ctx.inputs.dueCards; tentative = false;
      title = `Review up to ${Math.min(ctx.inputs.dueCards, task.minutes)} due cards`;
      explanation = `${evidenceCount} cards are due as of this plan preview. Check the live due queue when you start.`;
    } else if (task.kind === "review" && task.action.area === "history" &&
      Object.keys(task.action).sort().join() === "area,attemptId,questionId" &&
      ctx.inputs.missed.some(item => item.attemptId === task.action.attemptId && item.questionId === task.action.questionId)) {
      const key = `${task.action.attemptId}\u0000${task.action.questionId}`;
      if (completedReviews.has(key) || reviewKeys.has(key)) return invalid();
      reviewKeys.add(key);
      const missed = ctx.inputs.missed.find(item => item.attemptId === task.action.attemptId && item.questionId === task.action.questionId)!;
      evidenceCount = 1;
      title = `Review missed ${missed.section} question ${missed.questionNumber}`;
      explanation = "One incorrect or unanswered response in a completed Whitebook Attempt. Guided review does not change Raw Accuracy.";
    } else if (task.kind === "practice" && task.action.area === "practice" &&
      Object.keys(task.action).sort().join() === "area,revisionId,section") {
      const activity = ctx.inputs.practice.find(item => item.revisionId === task.action.revisionId && item.section === task.action.section);
      if (!activity) return invalid();
      evidenceCount = activity.evidenceCount; tentative = activity.tentative || !evidenceCount;
      title = `Practice ${activity.section} · ${activity.packageTitle}`.slice(0, 120);
      explanation = evidenceCount ? `${evidenceCount} unassisted graded questions in this Section; Whitebook Raw Accuracy ${activity.rawAccuracy}%. This is practice evidence, not SAT points.`
        : "Baseline Whitebook Practice from an available Test Package; no unassisted Section evidence yet.";
    } else return invalid();
    // Explanations are model text; do not grant them evidence authority.
    tasks.push({ date: task.date, kind: task.kind, title, minutes: task.minutes, action: task.action,
      evidenceCount, tentative, explanation });
  }
  return tasks;
}

export async function acceptProposals(request: Request, env: AccountEnv, accountId: string, now: number,
  proposalRowId: string, expectedVersionId: string | null, selection: Selection, settings: PlanSettings,
  originalEnvelope: PlanEnvelope, proposed: Proposal[]): Promise<Response> {
  const current = await planEnvelope(request, env, accountId, now, selection, settings);
  if (current instanceof Response || JSON.stringify(current.envelope) !== JSON.stringify(originalEnvelope)) return changed();
  const latest = await env.DB.prepare("SELECT id, version FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1")
    .bind(accountId).first<Version>();
  if ((latest?.id ?? null) !== expectedVersionId) return changed();
  const tasks = validateProposals(proposed, settings, current.context, await completedReviewKeys(env, accountId));
  if (tasks instanceof Response) return tasks;
  const id = crypto.randomUUID();
  const source = JSON.stringify(current.context.source);
  const rows = JSON.stringify(tasks.map(task => ({ ...task, id: crypto.randomUUID() })));
  const statements = [
    env.DB.prepare(`INSERT INTO study_plan_versions (id, account_id, version, primary_date, settings_json, source_json, created_at_ms)
      SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM assistant_previews WHERE id = ? AND account_id = ? AND expires_at_ms > ?)
      AND COALESCE((SELECT id FROM study_plan_versions WHERE account_id = ? ORDER BY version DESC LIMIT 1), '') = ?`)
      .bind(id, accountId, (latest?.version ?? 0) + 1, settings.primaryDate, JSON.stringify(settings), source, now,
        proposalRowId, accountId, now, accountId, expectedVersionId ?? ""),
    env.DB.prepare(`INSERT INTO study_plan_tasks
      (id, version_id, scheduled_date, kind, title, estimated_minutes, action_json, evidence_count, tentative, explanation, status, revision, account_id, updated_at_ms)
      SELECT json_extract(j.value, '$.id'), ?, json_extract(j.value, '$.date'), json_extract(j.value, '$.kind'),
      json_extract(j.value, '$.title'), json_extract(j.value, '$.minutes'), json_extract(j.value, '$.action'),
      json_extract(j.value, '$.evidenceCount'), json_extract(j.value, '$.tentative'), json_extract(j.value, '$.explanation'),
      'pending', 0, ?, ? FROM json_each(?) j WHERE EXISTS (SELECT 1 FROM study_plan_versions WHERE id = ? AND account_id = ?)`)
      .bind(id, accountId, now, rows, id, accountId),
    env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ?").bind(proposalRowId, accountId),
  ];
  try {
    const results = await env.DB.batch(statements) as { meta: { changes?: number } }[];
    if (results[0]?.meta.changes !== 1) return changed();
  } catch { return changed(); }
  return Response.json({ versionId: id, version: (latest?.version ?? 0) + 1 });
}
