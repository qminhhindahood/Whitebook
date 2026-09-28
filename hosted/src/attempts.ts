import { currentSession, failure, json, requireMutation, type AccountEnv } from "./accounts";
import { hasPackageEntitlement } from "./library";

type AttemptEnv = AccountEnv;
type Section = "Math" | "Reading and Writing";
type Ordering = "source" | "random";
type Timing =
  | { mode: "elapsed" }
  | { mode: "custom"; durationSeconds: number }
  | { mode: "sat_paced" };
type AttemptConfig = {
  kind?: "practice" | "section_exam";
  category: string | null;
  section: Section;
  modules: number[];
  count: number;
  ordering: Ordering;
  timing: Timing;
};
type QuestionRow = {
  question_id: string;
  ordinal: number;
  section: Section;
  module: number;
  question_number: number;
  response_type: string;
  presentation_json: string;
};
type QuestionLink = {
  questionId: string;
  ordinal: number;
  section: Section;
  module: number;
  questionNumber: number;
  responseType: string;
  choiceIds: string[];
};
type AttemptRow = {
  id: string;
  account_id: string;
  revision_id: string;
  kind: "practice" | "section_exam";
  status: "preparing" | "active" | "completed" | "expired";
  config_json: string;
  questions_json: string;
  state_json: string;
  state_version: number;
  created_at_ms: number;
  started_at_ms: number | null;
  deadline_at_ms: number | null;
  completed_at_ms: number | null;
  result_json: string | null;
  editor_token_hash: string | null;
  editor_lease_expires_at_ms: number | null;
  assisted_at_ms: number | null;
};

const ROOT = "/api/attempts";
const ATTEMPT_ID = /^[0-9a-f-]{36}$/i;
const MAX_BODY_CHARS = 65_536;
const EDITOR_LEASE_MS = 120_000;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function bodyObject(request: Request): Promise<Record<string, unknown> | Response> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return failure(400, "invalid_attempt", "The Attempt request could not be read.");
  }
  if (raw.length > MAX_BODY_CHARS) return failure(413, "request_too_large", "This Attempt request is too large.");
  try {
    const parsed: unknown = JSON.parse(raw);
    return isObject(parsed) ? parsed : failure(400, "invalid_attempt", "The Attempt request is invalid.");
  } catch {
    return failure(400, "invalid_attempt", "The Attempt request is invalid.");
  }
}

function parseConfig(value: Record<string, unknown>): AttemptConfig | Response {
  const section = value.section;
  const kind = value.kind;
  if (kind === "section_exam") {
    if (section !== "Math" && section !== "Reading and Writing")
      return failure(400, "invalid_attempt", "Choose a supported Section: Math or Reading and Writing.");
    if (value.category !== undefined && value.category !== null)
      return failure(400, "invalid_attempt", "Question Category is available for Practice Attempts only.");
    return {
      kind,
      category: null,
      section,
      modules: [1, 2],
      count: section === "Math" ? 44 : 54,
      ordering: "random",
      timing: { mode: "sat_paced" },
    };
  }
  if (kind !== undefined && kind !== "practice")
    return failure(400, "invalid_attempt", "Choose a supported Attempt kind.");
  const category = value.category;
  if (category !== undefined && category !== null &&
      (typeof category !== "string" || !category.trim()))
    return failure(400, "invalid_attempt", "Choose a valid Question Category.");
  const modules = value.modules;
  const count = value.count;
  const ordering = value.ordering;
  const timingValue = value.timing;
  if (typeof section !== "string" || (section !== "Math" && section !== "Reading and Writing") ||
      !Array.isArray(modules) || modules.length === 0 || modules.length > 2 ||
      !modules.every((item) => Number.isInteger(item) && (item === 1 || item === 2)) ||
      new Set(modules).size !== modules.length ||
      !Number.isInteger(count) || Number(count) <= 0 ||
      (ordering !== "source" && ordering !== "random") || !isObject(timingValue)) {
    return failure(400, "invalid_attempt", "Choose a valid Section, Module, question count, order, and timing.");
  }

  let timing: Timing;
  if (timingValue.mode === "elapsed") {
    timing = { mode: "elapsed" };
  } else if (timingValue.mode === "custom" &&
      Number.isInteger(timingValue.durationSeconds) &&
      Number(timingValue.durationSeconds) > 0 &&
      Number(timingValue.durationSeconds) <= 86_400) {
    timing = { mode: "custom", durationSeconds: Number(timingValue.durationSeconds) };
  } else if (timingValue.mode === "sat_paced") {
    timing = { mode: "sat_paced" };
  } else {
    return failure(400, "invalid_attempt", "Choose a valid Practice timing option.");
  }

  return {
    kind: "practice",
    category: typeof category === "string" ? category : null,
    section,
    modules: [...modules] as number[],
    count: Number(count),
    ordering,
    timing,
  };
}

async function rows<T>(statement: ReturnType<AttemptEnv["DB"]["prepare"]>): Promise<T[]> {
  return (await statement.all()).results as T[];
}

async function attemptRow(env: AttemptEnv, accountId: string, attemptId: string): Promise<AttemptRow | null> {
  return env.DB.prepare("SELECT id, account_id, revision_id, kind, status, config_json, questions_json, " +
      "state_json, state_version, created_at_ms, started_at_ms, deadline_at_ms, completed_at_ms, " +
      "result_json, editor_token_hash, editor_lease_expires_at_ms, assisted_at_ms FROM learner_attempts " +
      "WHERE id = ? AND account_id = ?")
    .bind(attemptId, accountId).first<AttemptRow>();
}

function parseQuestions(row: AttemptRow): QuestionLink[] {
  return JSON.parse(row.questions_json) as QuestionLink[];
}

function parseState(row: AttemptRow): Record<string, unknown> {
  return JSON.parse(row.state_json) as Record<string, unknown>;
}

function snapshot(row: AttemptRow, serverNow: number) {
  const config = JSON.parse(row.config_json) as AttemptConfig;
  const questions = parseQuestions(row);
  return {
    attemptId: row.id,
    revisionId: row.revision_id,
    kind: row.kind,
    status: row.status,
    section: config.section,
    category: config.category ?? null,
    modules: config.modules,
    ordering: config.ordering,
    timing: config.timing,
    questionIds: questions.map((question) => question.questionId),
    questions,
    state: parseState(row),
    stateVersion: row.state_version,
    createdAt: row.created_at_ms,
    startedAt: row.started_at_ms,
    deadlineAt: row.deadline_at_ms,
    completedAt: row.completed_at_ms,
    assisted: row.assisted_at_ms !== null,
    lease: {
      held: row.editor_lease_expires_at_ms !== null && row.editor_lease_expires_at_ms > serverNow,
      expiresAt: row.editor_lease_expires_at_ms,
    },
    serverNow,
  };
}

function summary(row: AttemptRow) {
  const config = JSON.parse(row.config_json) as AttemptConfig;
  return {
    attemptId: row.id,
    revisionId: row.revision_id,
    kind: row.kind,
    status: row.status,
    section: config.section,
    category: config.category ?? null,
    questionCount: parseQuestions(row).length,
    createdAt: row.created_at_ms,
    startedAt: row.started_at_ms,
    deadlineAt: row.deadline_at_ms,
    completedAt: row.completed_at_ms,
    assisted: row.assisted_at_ms !== null,
  };
}

async function listAttempts(env: AttemptEnv, accountId: string, now: number): Promise<Response> {
  const items = await rows<AttemptRow>(env.DB.prepare("SELECT id, account_id, revision_id, kind, status, " +
      "config_json, questions_json, state_json, state_version, created_at_ms, started_at_ms, deadline_at_ms, " +
      "completed_at_ms, result_json, editor_token_hash, assisted_at_ms " +
      "FROM learner_attempts WHERE account_id = ? ORDER BY created_at_ms DESC").bind(accountId));
  const current = await Promise.all(items.map((row) => enforceSectionDeadline(env, row, now)));
  if (current.some((row) => !row)) return failure(503, "attempt_unavailable", "Whitebook could not refresh Attempt history. Try again.");
  return json({ attempts: current.map((row) => summary(row!)) });
}

function shuffle<T>(items: T[]): T[] {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i--) {
    const word = new Uint32Array(1);
    crypto.getRandomValues(word);
    const j = word[0] % (i + 1);
    [output[i], output[j]] = [output[j], output[i]];
  }
  return output;
}

function durationMs(config: AttemptConfig, questions: QuestionLink[]): number | null {
  if (config.kind === "section_exam")
    return config.section === "Math" ? 35 * 60_000 : 32 * 60_000;
  if (config.timing.mode === "elapsed") return null;
  if (config.timing.mode === "custom") return config.timing.durationSeconds * 1000;
  if (questions.length !== config.count || config.modules.length !== 1) return null;
  if (config.section === "Math" && questions.length === 22) return 35 * 60_000;
  if (config.section === "Reading and Writing" && questions.length === 27) return 32 * 60_000;
  return null;
}

async function createAttempt(request: Request, env: AttemptEnv, accountId: string, now: number): Promise<Response> {
  const body = await bodyObject(request);
  if (body instanceof Response) return body;
  const revisionId = body.revisionId;
  if (typeof revisionId !== "string" || !/^[A-Za-z0-9_-]+$/.test(revisionId))
    return failure(400, "invalid_attempt", "Choose one valid Test Package revision.");
  const config = parseConfig(body);
  if (config instanceof Response) return config;
  if (!(await hasPackageEntitlement(env, accountId, revisionId)))
    return failure(404, "not_found", "This Test Package is unavailable.");

  const sectionExam = config.kind === "section_exam";
  const placeholders = config.modules.map(() => "?").join(", ");
  const candidates = sectionExam
    ? await rows<QuestionRow>(env.DB.prepare("SELECT question_id, ordinal, section, module, " +
        "question_number, response_type, presentation_json FROM publication_questions " +
        "WHERE revision_id = ? AND section = ? ORDER BY ordinal")
      .bind(revisionId, config.section))
    : await rows<QuestionRow>(env.DB.prepare("SELECT question_id, ordinal, section, module, " +
        "question_number, response_type, presentation_json FROM publication_questions " +
        "WHERE revision_id = ? AND section = ? AND module IN (" + placeholders + ") ORDER BY ordinal")
      .bind(revisionId, config.section, ...config.modules));
  let filtered = candidates;
  if (config.category) {
    const metadata = await rows<{ question_id: string; category: string }>(env.DB.prepare(
      "SELECT question_id, category FROM publication_question_categories WHERE revision_id = ?",
    ).bind(revisionId));
    if (!metadata.some((item) => item.category === config.category))
      return failure(400, "invalid_attempt", "Choose a published Question Category for this Test Package.");
    const byQuestion = new Map(metadata.map((item) => [item.question_id, item.category]));
    filtered = candidates.filter((question) => byQuestion.get(question.question_id) === config.category);
    if (filtered.length === 0)
      return failure(400, "invalid_attempt", "No questions in this Question Category match the selected Section and Modules.");
  }
  const eligible = sectionExam
    ? [...new Map(filtered.map((question) => [question.question_id, question])).values()]
    : filtered;
  if (config.count > eligible.length)
    return failure(400, "invalid_attempt", sectionExam
      ? `This Section needs at least ${config.count} unique questions to create a Section Exam.`
      : config.category
        ? `Only ${eligible.length} questions in this Question Category match the selected Section and Modules.`
        : "The selected question count exceeds this Section and Module selection.");
  if (!sectionExam && config.timing.mode === "sat_paced" &&
      (config.modules.length !== 1 ||
       !((config.section === "Math" && config.count === 22) ||
         (config.section === "Reading and Writing" && config.count === 27)) ||
       filtered.length !== config.count)) {
    return failure(400, "invalid_attempt", "SAT-Paced Timing requires one complete Module.");
  }

  const selected = config.ordering === "random" ? shuffle(eligible).slice(0, config.count)
    : eligible.slice(0, config.count);
  const moduleSize = config.section === "Math" ? 22 : 27;
  const questions: QuestionLink[] = selected.map((question, index) => {
    const presentation = JSON.parse(question.presentation_json) as { choices?: { id?: unknown }[] };
    const choiceIds = Array.isArray(presentation.choices) ? presentation.choices.flatMap((choice) =>
      typeof choice.id === "string" && /^[A-D]$/.test(choice.id) ? [choice.id] : []) : [];
    return {
      questionId: question.question_id,
      ordinal: question.ordinal,
      section: question.section,
      module: sectionExam ? Math.floor(index / moduleSize) + 1 : question.module,
      questionNumber: question.question_number,
      responseType: question.response_type,
      choiceIds,
    };
  });
  const questionIds = questions.map((question) => question.questionId);
  if (new Set(questionIds).size !== questionIds.length)
    return failure(503, "attempt_unavailable", "Whitebook could not prepare this Attempt. Try again.");

  const id = crypto.randomUUID();
  const state = sectionExam
    ? { phase: "module", activeModule: 1, lockedModules: [], responses: {}, markedQuestionIds: [],
        eliminatedChoices: {}, currentQuestionId: questionIds[0], remainingSeconds: null, pausedPhase: null,
        calculatorState: null, questionElapsedMs: {} }
    : { responses: {}, markedQuestionIds: [], eliminatedChoices: {}, currentQuestionId: questionIds[0],
        questionElapsedMs: {} };
  const result = await env.DB.prepare("INSERT INTO learner_attempts " +
      "(id, account_id, revision_id, kind, status, config_json, questions_json, state_json, state_version, created_at_ms) " +
      "VALUES (?, ?, ?, ?, 'preparing', ?, ?, ?, 0, ?)")
    .bind(id, accountId, revisionId, sectionExam ? "section_exam" : "practice", JSON.stringify(config),
      JSON.stringify(questions), JSON.stringify(state), now).run();
  if (!result.success || result.meta.changes !== 1)
    return failure(503, "attempt_unavailable", "Whitebook could not create this Attempt. Try again.");

  const row = await attemptRow(env, accountId, id);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json(snapshot(row, now), 201);
}

function editorToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function startAttempt(env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const row = await attemptRow(env, accountId, attemptId);
  if (!row) return failure(404, "not_found", "This Attempt is unavailable.");
  if (row.status !== "preparing") return failure(409, "attempt_changed", "This Attempt is no longer waiting to start.");
  const config = JSON.parse(row.config_json) as AttemptConfig;
  const questions = parseQuestions(row);
  const duration = durationMs(config, questions);
  if (config.timing.mode !== "elapsed" && duration === null)
    return failure(409, "attempt_changed", "This Attempt no longer has a valid timing selection.");

  const token = editorToken();
  const expiresAt = now + EDITOR_LEASE_MS;
  const state = parseState(row);
  state.questionTimingStartedAtMs = now;
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, status = 'active', started_at_ms = ?, " +
      "deadline_at_ms = ?, editor_token_hash = ?, editor_lease_expires_at_ms = ?, state_version = state_version + 1 " +
      "WHERE id = ? AND account_id = ? AND status = 'preparing'")
    .bind(JSON.stringify(state), now, duration === null ? null : now + duration, await sha256(token), expiresAt,
      attemptId, accountId).run();
  if (!result.success) return failure(503, "attempt_unavailable", "Whitebook could not start this Attempt. Try again.");
  if (result.meta.changes !== 1) return failure(409, "attempt_changed", "This Attempt has already changed.");
  const started = await attemptRow(env, accountId, attemptId);
  if (!started) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(started, now), editorToken: token });
}

function checkpointQuestionTime(source: Record<string, unknown>, at: number, deadlineAt: number | null): Record<string, unknown> {
  const state = { ...source };
  const questionId = state.currentQuestionId;
  const startedAt = state.questionTimingStartedAtMs;
  if (typeof questionId !== "string" || typeof startedAt !== "number") return state;
  const endAt = deadlineAt === null ? at : Math.min(at, deadlineAt);
  const elapsed = Math.max(0, endAt - startedAt);
  const previous = isObject(state.questionElapsedMs) ? state.questionElapsedMs : {};
  state.questionElapsedMs = { ...previous, [questionId]: Number(previous[questionId] ?? 0) + elapsed };
  state.questionTimingStartedAtMs = endAt;
  return state;
}

async function gradeSectionExam(env: AttemptEnv, row: AttemptRow, state: Record<string, unknown>) {
  const questions = parseQuestions(row);
  const answerRows = await rows<AnswerRow>(env.DB.prepare("SELECT question_id, accepted_answers_json FROM publication_answers " +
      "WHERE revision_id = ?").bind(row.revision_id));
  const answers = new Map(answerRows.map((answer) => [answer.question_id, JSON.parse(answer.accepted_answers_json) as string[]]));
  if (questions.some((question) => !answers.has(question.questionId))) return null;
  const responses = isObject(state.responses) ? state.responses : {};
  const graded = questions.map((question) => {
    const acceptedAnswers = answers.get(question.questionId)!;
    const response = typeof responses[question.questionId] === "string" ? responses[question.questionId] as string : null;
    const correct = response !== null && acceptedAnswers.some((answer) =>
      answer.trim().toLocaleLowerCase() === response.trim().toLocaleLowerCase());
    return { questionId: question.questionId, response, acceptedAnswers, correct };
  });
  return { correctCount: graded.filter((question) => question.correct).length,
    questionCount: graded.length, questions: graded };
}

async function closeSectionExamModule(
  env: AttemptEnv,
  row: AttemptRow,
  now: number,
  closedAt: number,
  exposeAnswers = false,
): Promise<AttemptRow | null> {
  const state = parseState(row);
  if (row.kind !== "section_exam" || state.phase !== "module" || row.deadline_at_ms === null) return row;
  const closeTime = Math.min(closedAt, now);
  const checkpointAt = Math.min(closeTime, row.deadline_at_ms);
  const closedState = checkpointQuestionTime(state, checkpointAt, row.deadline_at_ms);
  const activeModule = Number(closedState.activeModule);
  const locked = Array.isArray(closedState.lockedModules) ? closedState.lockedModules.filter(Number.isInteger) as number[] : [];
  closedState.lockedModules = [...new Set([...locked, activeModule])].sort();
  closedState.questionTimingStartedAtMs = null;
  closedState.remainingSeconds = null;
  closedState.pausedPhase = null;

  if (activeModule === 1) {
    closedState.phase = "transition";
    const update = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, deadline_at_ms = NULL, " +
        "state_version = state_version + 1 WHERE id = ? AND account_id = ? AND status = 'active' " +
        "AND state_version = ? AND deadline_at_ms = ?")
      .bind(JSON.stringify(closedState), row.id, row.account_id, row.state_version, row.deadline_at_ms).run();
    if (!update.success) return null;
    return attemptRow(env, row.account_id, row.id);
  }

  const result = await gradeSectionExam(env, row, closedState);
  if (!result) return null;
  const update = await env.DB.prepare("UPDATE learner_attempts SET status = 'completed', state_json = ?, " +
      "deadline_at_ms = NULL, completed_at_ms = ?, result_json = ?, answers_exposed_at_ms = ?, editor_token_hash = NULL, " +
      "editor_lease_expires_at_ms = NULL, state_version = state_version + 1 WHERE id = ? AND account_id = ? " +
      "AND status = 'active' AND state_version = ? AND deadline_at_ms = ?")
    .bind(JSON.stringify(closedState), closeTime, JSON.stringify(result), exposeAnswers ? now : null, row.id, row.account_id,
      row.state_version, row.deadline_at_ms).run();
  if (!update.success) return null;
  return attemptRow(env, row.account_id, row.id);
}

async function enforceSectionDeadline(env: AttemptEnv, row: AttemptRow, now: number): Promise<AttemptRow | null> {
  if (row.kind !== "section_exam" || row.status !== "active" || row.deadline_at_ms === null || row.deadline_at_ms > now)
    return row;
  const next = await closeSectionExamModule(env, row, now, row.deadline_at_ms);
  if (next) return next;
  return attemptRow(env, row.account_id, row.id);
}

async function getAttempt(env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const row = await attemptRow(env, accountId, attemptId);
  if (!row) return failure(404, "not_found", "This Attempt is unavailable.");
  const current = await enforceSectionDeadline(env, row, now);
  if (!current) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  return json(snapshot(current, now));
}

type AttemptState = {
  [key: string]: unknown;
  responses: Record<string, string>;
  markedQuestionIds: string[];
  eliminatedChoices: Record<string, string[]>;
  currentQuestionId: string;
};

type AttemptChange =
  | { type: "response"; questionId: string; response: string | null }
  | { type: "mark"; questionId: string; marked: boolean }
  | { type: "elimination"; questionId: string; choiceId: string; eliminated: boolean }
  | { type: "navigation"; questionId: string }
  | { type: "calculator_state"; state: Record<string, unknown> };

function parseVersion(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function parseEditorToken(value: unknown): string | null {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function sameSecret(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function parseChange(value: unknown, questions: QuestionLink[]): AttemptChange | null {
  if (!isObject(value)) return null;
  if (value.type === "calculator_state" && isObject(value.state) && JSON.stringify(value.state).length <= 48_000)
    return { type: "calculator_state", state: value.state };
  if (typeof value.questionId !== "string") return null;
  const question = questions.find((item) => item.questionId === value.questionId);
  if (!question) return null;
  const questionId = question.questionId;
  if (value.type === "response" && (value.response === null ||
      (typeof value.response === "string" && value.response.length <= 4096 &&
       (question.responseType !== "multiple_choice" || question.choiceIds.includes(value.response)))))
    return { type: "response", questionId, response: value.response as string | null };
  if (value.type === "mark" && typeof value.marked === "boolean")
    return { type: "mark", questionId, marked: value.marked };
  if (value.type === "elimination" && typeof value.choiceId === "string" &&
      question.responseType === "multiple_choice" && question.choiceIds.includes(value.choiceId) &&
      typeof value.eliminated === "boolean")
    return { type: "elimination", questionId, choiceId: value.choiceId, eliminated: value.eliminated };
  if (value.type === "navigation") return { type: "navigation", questionId };
  return null;
}

function applyChange(source: Record<string, unknown>, change: AttemptChange): AttemptState {
  const previous = source as unknown as AttemptState;
  const state: AttemptState = {
    ...source,
    responses: { ...previous.responses },
    markedQuestionIds: [...previous.markedQuestionIds],
    eliminatedChoices: Object.fromEntries(Object.entries(previous.eliminatedChoices)
      .map(([questionId, choices]) => [questionId, [...choices]])),
    currentQuestionId: previous.currentQuestionId,
  };
  if (change.type === "response") {
    if (change.response === null) delete state.responses[change.questionId];
    else state.responses[change.questionId] = change.response;
  } else if (change.type === "mark") {
    state.markedQuestionIds = change.marked
      ? [...new Set([...state.markedQuestionIds, change.questionId])]
      : state.markedQuestionIds.filter((id) => id !== change.questionId);
  } else if (change.type === "elimination") {
    const choices = new Set(state.eliminatedChoices[change.questionId] ?? []);
    if (change.eliminated) choices.add(change.choiceId);
    else choices.delete(change.choiceId);
    if (choices.size) state.eliminatedChoices[change.questionId] = [...choices].sort();
    else delete state.eliminatedChoices[change.questionId];
  } else if (change.type === "navigation") {
    state.currentQuestionId = change.questionId;
  } else {
    state.calculatorState = change.state;
  }
  return state;
}

async function validateMutable(row: AttemptRow, token: string | null, expectedVersion: number | null, now: number): Promise<Response | null> {
  if (row.status !== "active") return failure(409, "attempt_changed", "This Attempt is no longer editable.");
  if (row.deadline_at_ms !== null && row.deadline_at_ms <= now)
    return failure(409, "attempt_expired", "The timed Attempt has ended.");
  if (expectedVersion === null || expectedVersion !== row.state_version)
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before editing.");
  if (row.editor_lease_expires_at_ms === null || row.editor_lease_expires_at_ms <= now)
    return failure(409, "editor_lease_expired", "Editing is unavailable. Take over editing to continue.");
  if (!token || !row.editor_token_hash || !sameSecret(await sha256(token), row.editor_token_hash))
    return failure(409, "editor_conflict", "This Attempt is being edited on another device. Refresh or take over editing.");
  return null;
}

async function readBody(request: Request): Promise<Record<string, unknown> | Response> {
  const body = await bodyObject(request);
  if (body instanceof Response) return body;
  return body;
}

async function updateEditorState(env: AttemptEnv, row: AttemptRow, token: string, state: Record<string, unknown>, now: number): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, state_version = state_version + 1, " +
      "editor_lease_expires_at_ms = ? WHERE id = ? AND account_id = ? AND status = 'active' " +
      "AND state_version = ? AND editor_token_hash = ? AND editor_lease_expires_at_ms > ? " +
      "AND (deadline_at_ms IS NULL OR deadline_at_ms > ?)")
    .bind(JSON.stringify(state), now + EDITOR_LEASE_MS, row.id, row.account_id, row.state_version,
      await sha256(token), now, now).run();
  return result.success && result.meta.changes === 1;
}

async function updateSectionLifecycle(
  env: AttemptEnv,
  row: AttemptRow,
  token: string,
  state: Record<string, unknown>,
  deadlineAt: number | null,
  now: number,
): Promise<boolean> {
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, deadline_at_ms = ?, " +
      "state_version = state_version + 1, editor_lease_expires_at_ms = ? WHERE id = ? AND account_id = ? " +
      "AND status = 'active' AND state_version = ? AND editor_token_hash = ? AND editor_lease_expires_at_ms > ? " +
      "AND deadline_at_ms IS ?")
    .bind(JSON.stringify(state), deadlineAt, now + EDITOR_LEASE_MS, row.id, row.account_id, row.state_version,
      await sha256(token), now, row.deadline_at_ms).run();
  return result.success && result.meta.changes === 1;
}

async function finishModule(request: Request, env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind !== "section_exam") return failure(409, "attempt_changed", "Only a Section Exam closes one Module at a time.");
  const token = parseEditorToken(body.editorToken);
  const denied = await validateMutable(row, token, parseVersion(body.expectedStateVersion), now);
  if (denied) return denied;
  if (parseState(row).phase !== "module")
    return failure(409, "attempt_changed", "There is no running Module to finish.");
  const updated = await closeSectionExamModule(env, row, now, now, true);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not close this Module. Try again.");
  const result = updated.status === "completed" && updated.result_json ? { result: JSON.parse(updated.result_json) } : {};
  return json({ ...snapshot(updated, now), ...result });
}

async function continueSectionExam(request: Request, env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind !== "section_exam") return failure(409, "attempt_changed", "This Attempt has no Section Exam transition.");
  const token = parseEditorToken(body.editorToken);
  const denied = await validateMutable(row, token, parseVersion(body.expectedStateVersion), now);
  if (denied) return denied;
  const state = parseState(row);
  if (state.phase !== "transition" || Number(state.activeModule) !== 1)
    return failure(409, "attempt_changed", "Module 2 can start only from the Section Exam transition.");
  const questions = parseQuestions(row);
  const first = questions.find((question) => question.module === 2);
  if (!first) return failure(503, "attempt_unavailable", "Module 2 questions are unavailable.");
  const config = JSON.parse(row.config_json) as AttemptConfig;
  const nextState = { ...state, phase: "module", activeModule: 2, currentQuestionId: first.questionId,
    remainingSeconds: null, pausedPhase: null, questionTimingStartedAtMs: now };
  const deadlineAt = now + (durationMs(config, questions) ?? 0);
  if (!(await updateSectionLifecycle(env, row, token!, nextState, deadlineAt, now)))
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before continuing.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json(snapshot(updated, now));
}

async function pauseSectionExam(request: Request, env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind !== "section_exam") return failure(409, "attempt_changed", "Pause is unavailable for this Attempt.");
  const token = parseEditorToken(body.editorToken);
  const denied = await validateMutable(row, token, parseVersion(body.expectedStateVersion), now);
  if (denied) return denied;
  const state = parseState(row);
  if (state.phase !== "module" && state.phase !== "transition")
    return failure(409, "attempt_changed", "This Attempt is already paused or closed.");
  const pausedPhase = state.phase;
  const pausedState = pausedPhase === "module"
    ? checkpointQuestionTime(state, now, row.deadline_at_ms)
    : { ...state };
  pausedState.phase = "paused";
  pausedState.pausedPhase = pausedPhase;
  pausedState.remainingSeconds = pausedPhase === "module" && row.deadline_at_ms !== null
    ? Math.floor(Math.max(0, row.deadline_at_ms - now) / 1000) : null;
  pausedState.questionTimingStartedAtMs = null;
  if (!(await updateSectionLifecycle(env, row, token!, pausedState, null, now)))
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before pausing.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json(snapshot(updated, now));
}

async function resumeSectionExam(request: Request, env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind !== "section_exam") return failure(409, "attempt_changed", "Resume is unavailable for this Attempt.");
  const token = parseEditorToken(body.editorToken);
  const denied = await validateMutable(row, token, parseVersion(body.expectedStateVersion), now);
  if (denied) return denied;
  const state = parseState(row);
  if (state.phase !== "paused" || (state.pausedPhase !== "module" && state.pausedPhase !== "transition"))
    return failure(409, "attempt_changed", "This Attempt is not paused.");
  const resumedState = { ...state, phase: state.pausedPhase, pausedPhase: null,
    remainingSeconds: null,
    questionTimingStartedAtMs: state.pausedPhase === "module" ? now : null };
  const deadlineAt = state.pausedPhase === "module"
    ? now + Number(state.remainingSeconds ?? 0) * 1000 : null;
  if (!(await updateSectionLifecycle(env, row, token!, resumedState, deadlineAt, now)))
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before resuming.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  const current = await enforceSectionDeadline(env, updated, now);
  if (!current) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  return json(snapshot(current, now));
}

async function writeAttempt(request: Request, env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  const token = parseEditorToken(body.editorToken);
  const expectedVersion = parseVersion(body.expectedStateVersion);
  const denied = await validateMutable(row, token, expectedVersion, now);
  if (denied) return denied;
  const change = parseChange(body.change, parseQuestions(row));
  if (!change) return failure(400, "invalid_attempt_change", "This Attempt change is invalid.");
  const originalState = parseState(row);
  if (row.kind === "section_exam") {
    if (originalState.phase !== "module")
      return failure(409, "attempt_changed", "Continue to the active Module before editing.");
    if (change.type === "calculator_state") {
      const config = JSON.parse(row.config_json) as AttemptConfig;
      if (config.section !== "Math") return failure(400, "invalid_attempt_change", "Calculator state is only available in Math.");
    } else {
      const question = parseQuestions(row).find((item) => item.questionId === change.questionId);
      if (!question || question.module !== Number(originalState.activeModule))
        return failure(400, "invalid_attempt_change", "Only the active Module can be changed.");
    }
  }
  const state = checkpointQuestionTime(originalState, now, row.deadline_at_ms);
  state.questionTimingStartedAtMs = now;
  const nextState = applyChange(state, change);
  if (!(await updateEditorState(env, row, token!, nextState, now)))
    return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before editing.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(updated, now), saveStatus: "saved" });
}

async function heartbeat(request: Request, env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  const token = parseEditorToken(body.editorToken);
  const expectedVersion = parseVersion(body.expectedStateVersion);
  const denied = await validateMutable(row, token, expectedVersion, now);
  if (denied) return denied;
  const state = parseState(row);
  if (row.kind === "section_exam" && state.phase !== "module")
    return failure(409, "attempt_changed", "A lease heartbeat is only accepted during a running Module.");
  const checkpointed = checkpointQuestionTime(state, now, row.deadline_at_ms);
  checkpointed.questionTimingStartedAtMs = now;
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, state_version = state_version + 1, " +
      "editor_lease_expires_at_ms = ? WHERE id = ? AND account_id = ? AND status = 'active' " +
      "AND state_version = ? AND editor_token_hash = ? AND editor_lease_expires_at_ms > ? " +
      "AND (deadline_at_ms IS NULL OR deadline_at_ms > ?)")
    .bind(JSON.stringify(checkpointed), now + EDITOR_LEASE_MS, row.id, accountId, row.state_version,
      await sha256(token!), now, now).run();
  if (!result.success) return failure(503, "attempt_unavailable", "Whitebook could not renew editing. Try again.");
  if (result.meta.changes !== 1) return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before editing.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(updated, now), saveStatus: "saved" });
}

async function takeover(env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.status !== "active") return failure(409, "attempt_changed", "This Attempt is no longer editable.");
  if (row.deadline_at_ms !== null && row.deadline_at_ms <= now)
    return failure(409, "attempt_expired", "The timed Attempt has ended.");
  const token = editorToken();
  const tokenHash = await sha256(token);
  const state = parseState(row);
  const nextState = row.kind === "practice"
    ? checkpointQuestionTime(state, Math.min(now, row.editor_lease_expires_at_ms ?? now), row.deadline_at_ms)
    : state;
  if (row.kind === "practice") nextState.questionTimingStartedAtMs = now;
  const result = await env.DB.prepare("UPDATE learner_attempts SET state_json = ?, editor_token_hash = ?, " +
      "editor_lease_expires_at_ms = ?, state_version = state_version + 1 WHERE id = ? AND account_id = ? " +
      "AND status = 'active' AND state_version = ? AND (deadline_at_ms IS NULL OR deadline_at_ms > ?)")
    .bind(JSON.stringify(nextState), tokenHash, now + EDITOR_LEASE_MS, row.id, accountId, row.state_version, now).run();
  if (!result.success) return failure(503, "attempt_unavailable", "Whitebook could not transfer editing. Try again.");
  if (result.meta.changes !== 1) return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before taking over.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(updated, now), editorToken: token });
}

type AnswerRow = { question_id: string; accepted_answers_json: string };

async function submitAttempt(request: Request, env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const body = await readBody(request);
  if (body instanceof Response) return body;
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.kind === "section_exam")
    return failure(409, "attempt_changed", "Finish both Section Exam Modules to complete this Attempt.");
  const token = parseEditorToken(body.editorToken);
  const expectedVersion = parseVersion(body.expectedStateVersion);
  const denied = await validateMutable(row, token, expectedVersion, now);
  if (denied) return denied;

  const questions = parseQuestions(row);
  const answerRows = await rows<AnswerRow>(env.DB.prepare("SELECT question_id, accepted_answers_json FROM publication_answers " +
      "WHERE revision_id = ?").bind(row.revision_id));
  const answers = new Map(answerRows.map((answer) => [answer.question_id, JSON.parse(answer.accepted_answers_json) as string[]]));
  if (questions.some((question) => !answers.has(question.questionId)))
    return failure(503, "attempt_unavailable", "Whitebook could not grade this Attempt. Try again.");
  const state = checkpointQuestionTime(parseState(row), now, row.deadline_at_ms) as unknown as AttemptState;
  const graded = questions.map((question) => {
    const acceptedAnswers = answers.get(question.questionId)!;
    const response = state.responses[question.questionId] ?? null;
    const correct = response !== null && acceptedAnswers.some((answer) => answer.trim().toLocaleLowerCase() === response.trim().toLocaleLowerCase());
    return { questionId: question.questionId, response, acceptedAnswers, correct };
  });
  const resultData = { correctCount: graded.filter((question) => question.correct).length,
    questionCount: graded.length, questions: graded };
  const resultJson = JSON.stringify(resultData);
  const update = await env.DB.prepare("UPDATE learner_attempts SET status = 'completed', state_json = ?, completed_at_ms = ?, " +
      "answers_exposed_at_ms = ?, result_json = ?, editor_token_hash = NULL, editor_lease_expires_at_ms = NULL, state_version = state_version + 1 " +
      "WHERE id = ? AND account_id = ? AND status = 'active' AND state_version = ? AND editor_token_hash = ? " +
      "AND editor_lease_expires_at_ms > ? AND (deadline_at_ms IS NULL OR deadline_at_ms > ?)")
    .bind(JSON.stringify(state), now, now, resultJson, row.id, accountId, row.state_version, await sha256(token!), now, now).run();
  if (!update.success) return failure(503, "attempt_unavailable", "Whitebook could not submit this Attempt. Try again.");
  if (update.meta.changes !== 1) return failure(409, "editor_conflict", "This Attempt changed on another device. Refresh before submitting.");
  const completed = await attemptRow(env, accountId, attemptId);
  if (!completed) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(completed, now), result: resultData });
}

async function getResults(env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const found = await attemptRow(env, accountId, attemptId);
  if (!found) return failure(404, "not_found", "This Attempt is unavailable.");
  const row = await enforceSectionDeadline(env, found, now);
  if (!row) return failure(503, "attempt_unavailable", "Whitebook could not refresh this Attempt. Try again.");
  if (row.status !== "completed" || !row.result_json)
    return failure(409, "attempt_incomplete", "Results are available after you submit this Attempt.");
  await env.DB.prepare("UPDATE learner_attempts SET answers_exposed_at_ms = ? " +
    "WHERE id = ? AND account_id = ? AND status = 'completed' AND answers_exposed_at_ms IS NULL")
    .bind(now, attemptId, accountId).run();
  return json({ attemptId, status: row.status, completedAt: row.completed_at_ms,
    result: JSON.parse(row.result_json) });
}

async function markAssisted(env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const row = await attemptRow(env, accountId, attemptId);
  if (!row) return failure(404, "not_found", "This Attempt is unavailable.");
  if (row.kind !== "practice" || row.status !== "active")
    return failure(409, "assisted_unavailable", "Only an active Practice Attempt can become Assisted Practice.");
  const saved = await env.DB.prepare("UPDATE learner_attempts SET assisted_at_ms = ? WHERE id = ? AND account_id = ? AND kind = 'practice' AND status = 'active' AND assisted_at_ms IS NULL")
    .bind(now, attemptId, accountId).run();
  if (!saved.success) return failure(503, "attempt_unavailable", "Whitebook could not enable Assisted Practice. Try again.");
  const updated = await attemptRow(env, accountId, attemptId);
  if (!updated) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(updated, now), assisted: true });
}

export function attemptRoute(request: Request, env: AttemptEnv, now: () => number = Date.now): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (path !== ROOT && !path.startsWith(ROOT + "/")) return null;

  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
    if (request.method !== "GET") {
      const denied = await requireMutation(request, env, session);
      if (denied) return denied;
    }

    const serverNow = now();
    if (request.method === "GET" && path === ROOT)
      return listAttempts(env, session.account_id, serverNow);
    if (request.method === "POST" && path === ROOT)
      return createAttempt(request, env, session.account_id, serverNow);

    const match = new RegExp("^/api/attempts/([0-9a-f-]{36})(?:/(start|write|heartbeat|takeover|submit|results|assisted|finish-module|continue|pause|resume))?$", "i").exec(path);
    if (!match) return failure(404, "not_found", "This Attempt action is unavailable.");
    const attemptId = match[1];
    if (request.method === "GET" && !match[2])
      return getAttempt(env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "start")
      return startAttempt(env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "finish-module")
      return finishModule(request, env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "continue")
      return continueSectionExam(request, env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "pause")
      return pauseSectionExam(request, env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "resume")
      return resumeSectionExam(request, env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "write") return writeAttempt(request, env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "heartbeat") return heartbeat(request, env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "takeover") return takeover(env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "submit") return submitAttempt(request, env, session.account_id, attemptId, serverNow);
    if (request.method === "POST" && match[2] === "assisted") return markAssisted(env, session.account_id, attemptId, serverNow);
    if (request.method === "GET" && match[2] === "results") return getResults(env, session.account_id, attemptId, serverNow);
    return failure(404, "not_found", "This Attempt action is unavailable.");
  })();
}
