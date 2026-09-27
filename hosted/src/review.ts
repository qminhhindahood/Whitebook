import { currentSession, failure, json, requireMutation, type AccountEnv } from "./accounts";

type AttemptRow = { id: string; account_id: string; revision_id: string; status: string;
  questions_json: string; result_json: string | null; answers_exposed_at_ms: number | null };
type ReviewRow = { id: string; account_id: string; attempt_id: string; revision_id: string; question_id: string;
  prior_answer_exposure: "seen" | "possible"; retry_response: string | null;
  hint_used: number; revealed_at_ms: number | null; mistake_label: string | null; created_at_ms: number; updated_at_ms: number };
type NoteRow = { id: string; body: string; created_at_ms: number; updated_at_ms: number };
type ResultQuestion = { questionId: string; response: string | null; acceptedAnswers: string[]; correct: boolean };
type QuestionLink = { questionId: string; section: string; module: number; questionNumber: number; responseType: string; choiceIds: string[] };
type ReviewHelp = { reviewed_hint: string | null; reviewed_explanation: string | null };
type Env = AccountEnv;
const UUID = "[0-9a-f-]{36}";
const QUESTION = "[A-Za-z0-9_-]+";

async function body(request: Request): Promise<Record<string, unknown> | Response> {
  const raw = await request.text();
  if (raw.length > 8192) return failure(413, "request_too_large", "This review change is too large.");
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* Invalid JSON gets the same validation response. */ }
  return failure(400, "invalid_review", "This review change is invalid.");
}

async function attempt(env: Env, accountId: string, id: string): Promise<AttemptRow | null> {
  return env.DB.prepare("SELECT id, account_id, revision_id, status, questions_json, result_json, answers_exposed_at_ms " +
    "FROM learner_attempts WHERE id = ? AND account_id = ?").bind(id, accountId).first<AttemptRow>();
}

function resultQuestion(row: AttemptRow, questionId: string): ResultQuestion | null {
  if (row.status !== "completed" || !row.result_json) return null;
  return (JSON.parse(row.result_json) as { questions: ResultQuestion[] }).questions.find((item) => item.questionId === questionId) ?? null;
}

async function review(env: Env, accountId: string, id: string): Promise<ReviewRow | null> {
  return env.DB.prepare("SELECT id, account_id, attempt_id, revision_id, question_id, prior_answer_exposure, " +
    "retry_response, hint_used, revealed_at_ms, mistake_label, created_at_ms, updated_at_ms " +
    "FROM guided_reviews WHERE id = ? AND account_id = ?").bind(id, accountId).first<ReviewRow>();
}

async function help(env: Env, revisionId: string, questionId: string): Promise<ReviewHelp | null> {
  return env.DB.prepare("SELECT reviewed_hint, reviewed_explanation FROM publication_review_help " +
    "WHERE revision_id = ? AND question_id = ?").bind(revisionId, questionId).first<ReviewHelp>();
}

async function details(env: Env, item: ReviewRow): Promise<Response> {
  const source = await attempt(env, item.account_id, item.attempt_id);
  const original = source && resultQuestion(source, item.question_id);
  if (!source || !original) return failure(404, "not_found", "This completed review is unavailable.");
  const reviewed = await help(env, item.revision_id, item.question_id);
  const revealed = item.revealed_at_ms !== null;
  const notes = revealed ? (await env.DB.prepare("SELECT id, body, created_at_ms, updated_at_ms FROM study_notes " +
    "WHERE account_id = ? AND revision_id = ? AND question_id = ? ORDER BY created_at_ms, id")
    .bind(item.account_id, item.revision_id, item.question_id).all()).results as NoteRow[] : [];
  const retryCorrect = revealed && item.retry_response !== null
    ? original.acceptedAnswers.some((answer) => answer.trim().toLocaleLowerCase() === item.retry_response!.trim().toLocaleLowerCase())
    : null;
  return json({ reviewId: item.id, attemptId: item.attempt_id, revisionId: item.revision_id,
    questionId: item.question_id, priorAnswerExposure: item.prior_answer_exposure,
    hintAvailable: !!reviewed?.reviewed_hint, hintUsed: !!item.hint_used, revealed,
    mistakeLabel: item.mistake_label,
    ...(revealed ? { originalResponse: original.response, retryResponse: item.retry_response,
      acceptedAnswers: original.acceptedAnswers, retryCorrect,
      explanation: reviewed?.reviewed_explanation ?? null, notes } : {}) });
}

async function overview(env: Env, accountId: string, attemptId: string): Promise<Response> {
  const source = await attempt(env, accountId, attemptId);
  if (!source) return failure(404, "not_found", "This Attempt is unavailable.");
  if (source.status !== "completed" || !source.result_json)
    return failure(409, "attempt_incomplete", "Review is available after an Attempt is complete.");
  const result = JSON.parse(source.result_json) as { correctCount: number; questionCount: number; questions: ResultQuestion[] };
  const links = new Map((JSON.parse(source.questions_json) as QuestionLink[]).map((link) => [link.questionId, link]));
  return json({ attemptId, revisionId: source.revision_id, correctCount: result.correctCount,
    questionCount: result.questionCount, questions: result.questions.map((item) => {
      const link = links.get(item.questionId);
      return { questionId: item.questionId, section: link?.section, module: link?.module,
        questionNumber: link?.questionNumber, status: item.correct ? "correct" : !item.response?.trim() ? "unanswered" : "incorrect" };
    }) });
}

async function start(env: Env, accountId: string, attemptId: string, questionId: string, now: number): Promise<Response> {
  const source = await attempt(env, accountId, attemptId);
  if (!source) return failure(404, "not_found", "This Attempt is unavailable.");
  const original = resultQuestion(source, questionId);
  if (!original || original.correct) return failure(409, "review_unavailable", "Choose a wrong or unanswered question in a completed Attempt.");
  const previous = await env.DB.prepare("SELECT revealed_at_ms FROM guided_reviews WHERE account_id = ? AND " +
    "revision_id = ? AND question_id = ? AND revealed_at_ms IS NOT NULL LIMIT 1")
    .bind(accountId, source.revision_id, questionId).first<{ revealed_at_ms: number }>();
  const exposedAttempts = (await env.DB.prepare("SELECT result_json FROM learner_attempts WHERE account_id = ? " +
    "AND revision_id = ? AND answers_exposed_at_ms IS NOT NULL AND status = 'completed'")
    .bind(accountId, source.revision_id).all()).results as { result_json: string }[];
  const exposedElsewhere = exposedAttempts.some((row) =>
    (JSON.parse(row.result_json) as { questions: ResultQuestion[] }).questions.some((item) => item.questionId === questionId));
  const exposure = source.answers_exposed_at_ms != null || previous || exposedElsewhere ? "seen" : "possible";
  const id = crypto.randomUUID();
  const saved = await env.DB.prepare("INSERT INTO guided_reviews (id, account_id, attempt_id, revision_id, question_id, " +
    "prior_answer_exposure, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(id, accountId, attemptId, source.revision_id, questionId, exposure, now, now).run();
  if (!saved.success) return failure(503, "save_failed", "The guided review could not be started.");
  return details(env, { id, account_id: accountId, attempt_id: attemptId, revision_id: source.revision_id,
    question_id: questionId, prior_answer_exposure: exposure, retry_response: null, hint_used: 0,
    revealed_at_ms: null, mistake_label: null, created_at_ms: now, updated_at_ms: now });
}

async function changeReview(request: Request, env: Env, item: ReviewRow, action: string, now: number): Promise<Response> {
  if (action === "hint") {
    if (item.revealed_at_ms !== null) return failure(409, "review_revealed", "This answer has already been revealed.");
    const reviewed = await help(env, item.revision_id, item.question_id);
    if (!reviewed?.reviewed_hint) return failure(404, "hint_unavailable", "No reviewed hint is available for this question.");
    const saved = await env.DB.prepare("UPDATE guided_reviews SET hint_used = 1, updated_at_ms = ? " +
      "WHERE id = ? AND account_id = ? AND revealed_at_ms IS NULL")
      .bind(now, item.id, item.account_id).run();
    if (saved.meta.changes !== 1) return failure(409, "review_changed", "This review changed. Open it again.");
    return json({ hint: reviewed.reviewed_hint });
  }
  if (action === "retry" || action === "reveal") {
    if (item.revealed_at_ms !== null) return failure(409, "review_revealed", "This answer has already been revealed.");
    let retry: string | null = null;
    if (action === "retry") {
      const input = await body(request);
      if (input instanceof Response) return input;
      if (typeof input.response !== "string" || !input.response.trim() || input.response.length > 4096)
        return failure(400, "invalid_retry", "Enter a retry response before checking it.");
      retry = input.response.trim();
      const source = await attempt(env, item.account_id, item.attempt_id);
      const link = source && (JSON.parse(source.questions_json) as QuestionLink[]).find((q) => q.questionId === item.question_id);
      if (!link) return failure(404, "not_found", "This question is unavailable.");
      if (link.responseType === "multiple_choice" && !link.choiceIds.includes(retry))
        return failure(400, "invalid_retry", "Choose one of this question's answers.");
    }
    const saved = await env.DB.prepare("UPDATE guided_reviews SET retry_response = ?, revealed_at_ms = ?, updated_at_ms = ? " +
      "WHERE id = ? AND account_id = ? AND revealed_at_ms IS NULL")
      .bind(retry, now, now, item.id, item.account_id).run();
    if (saved.meta.changes !== 1) return failure(409, "review_changed", "This review changed. Open it again.");
    return details(env, { ...item, retry_response: retry, revealed_at_ms: now, updated_at_ms: now });
  }
  if (action === "label") {
    if (item.revealed_at_ms === null) return failure(409, "review_hidden", "Reveal the answer before saving a mistake label.");
    const input = await body(request);
    if (input instanceof Response) return input;
    if (input.label !== null && (typeof input.label !== "string" || input.label.length > 120))
      return failure(400, "invalid_label", "Keep the mistake label under 120 characters.");
    const label = typeof input.label === "string" ? input.label.trim() || null : null;
    const saved = await env.DB.prepare("UPDATE guided_reviews SET mistake_label = ?, updated_at_ms = ? WHERE id = ? AND account_id = ?")
      .bind(label, now, item.id, item.account_id).run();
    if (!saved.success) return failure(503, "save_failed", "The mistake label was not saved.");
    return details(env, { ...item, mistake_label: label, updated_at_ms: now });
  }
  return failure(404, "not_found", "This review action is unavailable.");
}

async function notes(request: Request, env: Env, item: ReviewRow, noteId: string | undefined, now: number): Promise<Response> {
  if (item.revealed_at_ms === null) return failure(409, "review_hidden", "Reveal the answer before opening Study Notes.");
  if (request.method === "POST" || request.method === "PATCH") {
    const input = await body(request);
    if (input instanceof Response) return input;
    if (typeof input.body !== "string" || !input.body.trim() || input.body.trim().length > 4000)
      return failure(400, "invalid_note", "Write a Study Note of at most 4000 characters.");
    const text = input.body.trim();
    if (request.method === "POST" && !noteId) {
      const id = crypto.randomUUID();
      const saved = await env.DB.prepare("INSERT INTO study_notes (id, account_id, revision_id, question_id, body, created_at_ms, updated_at_ms) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, item.account_id, item.revision_id, item.question_id, text, now, now).run();
      if (!saved.success) return failure(503, "save_failed", "The Study Note was not saved.");
      return json({ note: { id, body: text, created_at_ms: now, updated_at_ms: now } }, 201);
    }
    if (request.method === "PATCH" && noteId) {
      const saved = await env.DB.prepare("UPDATE study_notes SET body = ?, updated_at_ms = ? WHERE id = ? AND account_id = ? " +
        "AND revision_id = ? AND question_id = ?")
        .bind(text, now, noteId, item.account_id, item.revision_id, item.question_id).run();
      if (saved.meta.changes !== 1) return failure(404, "not_found", "This Study Note is unavailable.");
      return json({ note: { id: noteId, body: text, updated_at_ms: now } });
    }
  }
  if (request.method === "DELETE" && noteId) {
    const removed = await env.DB.prepare("DELETE FROM study_notes WHERE id = ? AND account_id = ? " +
      "AND revision_id = ? AND question_id = ?")
      .bind(noteId, item.account_id, item.revision_id, item.question_id).run();
    if (removed.meta.changes !== 1) return failure(404, "not_found", "This Study Note is unavailable.");
    return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } });
  }
  if (request.method === "GET" && !noteId) return details(env, item);
  return failure(404, "not_found", "This Study Note action is unavailable.");
}

export function reviewRoute(request: Request, env: Env, now: () => number = Date.now): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/review/")) return null;
  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in to open private review.");
    if (request.method !== "GET") {
      const denied = await requireMutation(request, env, session);
      if (denied) return denied;
    }
    const activeExam = await env.DB.prepare("SELECT id FROM learner_attempts WHERE account_id = ? " +
      "AND kind = 'section_exam' AND status = 'active' LIMIT 1")
      .bind(session.account_id).first<{ id: string }>();
    if (activeExam) return failure(409, "active_section_exam", "Finish the active Section Exam before opening guided review or Study Notes.");
    const attemptMatch = new RegExp(`^/api/review/attempts/(${UUID})(?:/questions/(${QUESTION}))?$`, "i").exec(path);
    if (attemptMatch) {
      if (request.method === "GET" && !attemptMatch[2]) return overview(env, session.account_id, attemptMatch[1]);
      if (request.method === "POST" && attemptMatch[2]) return start(env, session.account_id, attemptMatch[1], attemptMatch[2], now());
      return failure(404, "not_found", "This review action is unavailable.");
    }
    const match = new RegExp(`^/api/review/(${UUID})(?:/(retry|reveal|hint|label|notes)(?:/(${UUID}))?)?$`, "i").exec(path);
    if (!match) return failure(404, "not_found", "This review is unavailable.");
    const item = await review(env, session.account_id, match[1]);
    if (!item) return failure(404, "not_found", "This review is unavailable.");
    if (request.method === "GET" && !match[2]) return details(env, item);
    if (match[2] === "notes") return notes(request, env, item, match[3], now());
    if (request.method === "POST" && ["retry", "reveal", "hint", "label"].includes(match[2] ?? ""))
      return changeReview(request, env, item, match[2], now());
    return failure(404, "not_found", "This review action is unavailable.");
  })();
}
