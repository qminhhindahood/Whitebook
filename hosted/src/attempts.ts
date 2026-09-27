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
};
type QuestionLink = {
  questionId: string;
  ordinal: number;
  section: Section;
  module: number;
  questionNumber: number;
  responseType: string;
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
};

const ROOT = "/api/attempts";
const ATTEMPT_ID = /^[0-9a-f-]{36}$/i;
const MAX_BODY_CHARS = 16_384;
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
      "result_json, editor_token_hash, editor_lease_expires_at_ms FROM learner_attempts " +
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
    questionCount: parseQuestions(row).length,
    createdAt: row.created_at_ms,
    startedAt: row.started_at_ms,
    deadlineAt: row.deadline_at_ms,
    completedAt: row.completed_at_ms,
  };
}

async function listAttempts(env: AttemptEnv, accountId: string): Promise<Response> {
  const items = await rows<AttemptRow>(env.DB.prepare("SELECT id, account_id, revision_id, kind, status, " +
      "config_json, questions_json, state_json, state_version, created_at_ms, started_at_ms, deadline_at_ms, " +
      "completed_at_ms, result_json, editor_token_hash, editor_lease_expires_at_ms " +
      "FROM learner_attempts WHERE account_id = ? ORDER BY created_at_ms DESC").bind(accountId));
  return json({ attempts: items.map(summary) });
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

  const placeholders = config.modules.map(() => "?").join(", ");
  const candidates = await rows<QuestionRow>(env.DB.prepare("SELECT question_id, ordinal, section, module, " +
      "question_number, response_type FROM publication_questions " +
      "WHERE revision_id = ? AND section = ? AND module IN (" + placeholders + ") ORDER BY ordinal")
    .bind(revisionId, config.section, ...config.modules));
  if (config.count > candidates.length)
    return failure(400, "invalid_attempt", "The selected question count exceeds this Section and Module selection.");
  if (config.timing.mode === "sat_paced" &&
      (config.modules.length !== 1 ||
       !((config.section === "Math" && config.count === 22) ||
         (config.section === "Reading and Writing" && config.count === 27)) ||
       candidates.length !== config.count)) {
    return failure(400, "invalid_attempt", "SAT-Paced Timing requires one complete Module.");
  }

  const selected = config.ordering === "random" ? shuffle(candidates).slice(0, config.count)
    : candidates.slice(0, config.count);
  const questions: QuestionLink[] = selected.map((question) => ({
    questionId: question.question_id,
    ordinal: question.ordinal,
    section: question.section,
    module: question.module,
    questionNumber: question.question_number,
    responseType: question.response_type,
  }));
  const questionIds = questions.map((question) => question.questionId);
  if (new Set(questionIds).size !== questionIds.length)
    return failure(503, "attempt_unavailable", "Whitebook could not prepare this Attempt. Try again.");

  const id = crypto.randomUUID();
  const state = { responses: {}, markedQuestionIds: [], eliminatedChoices: {}, currentQuestionId: questionIds[0] };
  const result = await env.DB.prepare("INSERT INTO learner_attempts " +
      "(id, account_id, revision_id, kind, status, config_json, questions_json, state_json, state_version, created_at_ms) " +
      "VALUES (?, ?, ?, 'practice', 'preparing', ?, ?, ?, 0, ?)")
    .bind(id, accountId, revisionId, JSON.stringify(config), JSON.stringify(questions), JSON.stringify(state), now).run();
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
  const result = await env.DB.prepare("UPDATE learner_attempts SET status = 'active', started_at_ms = ?, " +
      "deadline_at_ms = ?, editor_token_hash = ?, editor_lease_expires_at_ms = ?, state_version = state_version + 1 " +
      "WHERE id = ? AND account_id = ? AND status = 'preparing'")
    .bind(now, duration === null ? null : now + duration, await sha256(token), expiresAt, attemptId, accountId).run();
  if (!result.success) return failure(503, "attempt_unavailable", "Whitebook could not start this Attempt. Try again.");
  if (result.meta.changes !== 1) return failure(409, "attempt_changed", "This Attempt has already changed.");
  const started = await attemptRow(env, accountId, attemptId);
  if (!started) return failure(503, "attempt_unavailable", "Whitebook could not load this Attempt. Try again.");
  return json({ ...snapshot(started, now), editorToken: token });
}

async function getAttempt(env: AttemptEnv, accountId: string, attemptId: string, now: number): Promise<Response> {
  const row = await attemptRow(env, accountId, attemptId);
  if (!row) return failure(404, "not_found", "This Attempt is unavailable.");
  return json(snapshot(row, now));
}
