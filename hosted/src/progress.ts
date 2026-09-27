import { currentSession, failure, json, type AccountEnv } from "./accounts";

type Section = "Reading and Writing" | "Math";
type AttemptRow = {
  id: string;
  revision_id: string;
  kind: string;
  completed_at_ms: number;
  questions_json: string;
  result_json: string;
  state_json: string;
};
type CategoryRow = { revision_id: string; question_id: string; section: Section; category: string | null };
type Link = { questionId: string; section: Section };
type Grade = { questionId: string; response: string | null; correct: boolean; assisted?: boolean };
type Evidence = { section: Section; category: string; domain: string | null; correct: boolean;
  unanswered: boolean; timeMs: number | null; completedAt: number; attemptId: string };

// Reviewed against College Board's Reading and Writing skills and Math Content Domains.
// "Vocabulary" remains unmapped: the Whitebook label does not assert words in context.
const CATEGORY_DOMAINS: Record<Section, Record<string, string>> = {
  "Reading and Writing": {
    "Word in Context": "Craft and Structure",
    "Main Idea": "Information and Ideas",
    "Text Structure": "Craft and Structure",
    "Command of Evidence": "Information and Ideas",
    "Inference": "Information and Ideas",
    "Cross Text": "Craft and Structure",
    "Grammar": "Standard English Conventions",
    "Transition": "Expression of Ideas",
    "Rhetorical Synthesis": "Expression of Ideas",
    "Details": "Information and Ideas",
  },
  Math: {
    Algebra: "Algebra",
    "Advanced Math": "Advanced Math",
    "Problem-Solving and Data Analysis": "Problem-Solving and Data Analysis",
    "Geometry and Trigonometry": "Geometry and Trigonometry",
  },
};

function finiteTime(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function groupEvidence(items: Evidence[]) {
  const ordered = [...items].sort((a, b) => b.completedAt - a.completedAt || a.attemptId.localeCompare(b.attemptId));
  const correct = items.filter((item) => item.correct).length;
  const unanswered = items.filter((item) => item.unanswered).length;
  const timed = items.filter((item) => item.timeMs !== null);
  const attemptIds = [...new Set(ordered.map((item) => item.attemptId))];
  const recent = ordered.filter((item) => item.attemptId === attemptIds[0]);
  const previous = ordered.filter((item) => item.attemptId === attemptIds[1]);
  const recentAccuracy = recent.length >= 5 && previous.length >= 5
    ? (recent.filter((item) => item.correct).length / recent.length) * 100 : null;
  const previousAccuracy = recentAccuracy !== null
    ? (previous.filter((item) => item.correct).length / previous.length) * 100 : null;
  const shift = recentAccuracy !== null && previousAccuracy !== null ? recentAccuracy - previousAccuracy : null;
  const conflicting = shift !== null && Math.abs(shift) >= 25;
  const tentativeReasons = [
    ...(items.length < 10 ? ["Fewer than 10 graded questions"] : []),
    ...(attemptIds.length < 2 ? ["Evidence comes from one completed Attempt"] : []),
    ...(attemptIds.length >= 2 && (recent.length < 5 || previous.length < 5)
      ? ["Fewer than 5 questions in each of the latest two Attempts"] : []),
    ...(conflicting ? ["Recent accuracy differs from earlier evidence"] : []),
  ];
  return {
    sampleSize: items.length,
    attemptCount: attemptIds.length,
    correct,
    incorrect: items.length - correct - unanswered,
    unanswered,
    rawAccuracy: Math.round(correct / items.length * 1000) / 10,
    averageTimeSeconds: timed.length
      ? Math.round(timed.reduce((sum, item) => sum + item.timeMs!, 0) / timed.length / 100) / 10 : null,
    timeSampleSize: timed.length,
    latestAt: ordered[0].completedAt,
    recentTrend: shift === null ? "insufficient" : shift > 0 ? "up" : shift < 0 ? "down" : "steady",
    recentAccuracy,
    previousAccuracy,
    tentative: tentativeReasons.length > 0,
    tentativeReasons,
  };
}

export function summarizeProgress(attempts: AttemptRow[], categories: CategoryRow[]) {
  const metadata = new Map(categories.map((row) => [`${row.revision_id}\u0000${row.question_id}`, row]));
  const evidence: Evidence[] = [];
  let excludedAssisted = 0;
  for (const attempt of attempts) {
    if (!(["practice", "section_exam"].includes(attempt.kind))) continue;
    const links = JSON.parse(attempt.questions_json) as Link[];
    const grades = JSON.parse(attempt.result_json) as { questions: Grade[] };
    const state = JSON.parse(attempt.state_json) as { questionElapsedMs?: Record<string, unknown>; assistedQuestionIds?: string[] };
    const byId = new Map(links.map((item) => [item.questionId, item]));
    const assisted = new Set(state.assistedQuestionIds ?? []);
    for (const grade of grades.questions) {
      if (grade.assisted || assisted.has(grade.questionId)) { excludedAssisted++; continue; }
      const link = byId.get(grade.questionId);
      if (!link) continue;
      const row = metadata.get(`${attempt.revision_id}\u0000${grade.questionId}`);
      const category = row?.section === link.section && row.category ? row.category : "Uncategorized";
      evidence.push({
        section: link.section,
        category,
        domain: CATEGORY_DOMAINS[link.section]?.[category] ?? null,
        correct: grade.correct,
        unanswered: !grade.response?.trim(),
        timeMs: finiteTime(state.questionElapsedMs?.[grade.questionId]),
        completedAt: attempt.completed_at_ms,
        attemptId: attempt.id,
      });
    }
  }
  function grouped<T extends object>(key: (item: Evidence) => string, name: (item: Evidence) => T, filter = (_item: Evidence) => true) {
    const buckets = new Map<string, Evidence[]>();
    for (const item of evidence.filter(filter)) {
      const id = key(item);
      const bucket = buckets.get(id) ?? [];
      bucket.push(item);
      buckets.set(id, bucket);
    }
    return [...buckets.values()].map((items) => ({ ...name(items[0]), ...groupEvidence(items) }));
  }
  const sections = grouped((item) => item.section, (item) => ({ section: item.section }));
  const groupedCategory = (item: Evidence) => `${item.section}\u0000${item.category}`;
  const categoryName = (item: Evidence) => ({ section: item.section, category: item.category });
  const categoryRows = grouped(groupedCategory, categoryName);
  const domains = grouped((item) => `${item.section}\u0000${item.domain}`,
    (item) => ({ section: item.section, domain: item.domain! }), (item) => item.domain !== null);
  const unmapped = grouped(groupedCategory, categoryName, (item) => item.domain === null);
  return {
    completedAttempts: attempts.filter((attempt) => ["practice", "section_exam"].includes(attempt.kind)).length,
    excludedAssisted,
    sections, categories: categoryRows, domains, unmapped,
  };
}

export function progressRoute(request: Request, env: AccountEnv): Promise<Response> | null {
  if (new URL(request.url).pathname !== "/api/account/progress") return null;
  if (request.method !== "GET") return Promise.resolve(failure(404, "not_found", "This progress action is unavailable."));
  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in to see your progress evidence.");
    const result = await env.DB.prepare("SELECT id, revision_id, kind, completed_at_ms, questions_json, result_json, state_json " +
      "FROM learner_attempts WHERE account_id = ? AND status = 'completed' AND result_json IS NOT NULL ORDER BY completed_at_ms DESC")
      .bind(session.account_id).all();
    const attempts = result.results as AttemptRow[];
    const revisions = [...new Set(attempts.map((item) => item.revision_id))];
    const categories = revisions.length ? (await env.DB.prepare(
      `SELECT pq.revision_id, pq.question_id, pq.section, pc.category FROM publication_questions pq ` +
      `LEFT JOIN publication_question_categories pc ON pc.revision_id = pq.revision_id AND pc.question_id = pq.question_id ` +
      `WHERE pq.revision_id IN (${revisions.map(() => "?").join(",")})`).bind(...revisions).all()).results as CategoryRow[] : [];
    return json(summarizeProgress(attempts, categories));
  })();
}
