import { currentSession, failure, json, requireMutation, type AccountEnv, type LearnerSession } from "./accounts";

export const READING_WRITING_DOMAINS = [
  "informationIdeas",
  "craftStructure",
  "expressionOfIdeas",
  "standardEnglishConventions",
] as const;
export const MATH_DOMAINS = [
  "algebra",
  "advancedMath",
  "problemSolvingDataAnalysis",
  "geometryTrigonometry",
] as const;
const BAND_KEYS = [...READING_WRITING_DOMAINS, ...MATH_DOMAINS] as const;
type BandKey = (typeof BAND_KEYS)[number];

const BAND_COLUMNS: Record<BandKey, string> = {
  informationIdeas: "band_information_ideas",
  craftStructure: "band_craft_structure",
  expressionOfIdeas: "band_expression_of_ideas",
  standardEnglishConventions: "band_standard_english_conventions",
  algebra: "band_algebra",
  advancedMath: "band_advanced_math",
  problemSolvingDataAnalysis: "band_problem_solving_data_analysis",
  geometryTrigonometry: "band_geometry_trigonometry",
};

type ResultRow = {
  id: string;
  account_id: string;
  administration_date: string;
  total_score: number;
  reading_writing_score: number;
  math_score: number;
  band_information_ideas: number | null;
  band_craft_structure: number | null;
  band_expression_of_ideas: number | null;
  band_standard_english_conventions: number | null;
  band_algebra: number | null;
  band_advanced_math: number | null;
  band_problem_solving_data_analysis: number | null;
  band_geometry_trigonometry: number | null;
  created_at: number;
  updated_at: number;
};

type ParsedResult = {
  administration_date: string;
  total_score: number;
  reading_writing_score: number;
  math_score: number;
  bands: Record<BandKey, number | null>;
};

function sectionScore(value: unknown, low: number, high: number): number | null {
  if (typeof value !== "number" || !Number.isInteger(value) || value < low || value > high || value % 10 !== 0)
    return null;
  return value;
}

function isCalendarDate(value: string): boolean {
  if (!/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function parseBands(value: unknown): Record<BandKey, number | null> | null {
  const source = value === undefined ? {} : value;
  if (source === null || typeof source !== "object" || Array.isArray(source)) return null;
  const bands = Object.fromEntries(BAND_KEYS.map((key) => [key, null])) as Record<BandKey, number | null>;
  for (const [key, raw] of Object.entries(source)) {
    if (!(key in bands)) return null;
    if (raw === null) continue;
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1 || raw > 7) return null;
    bands[key as BandKey] = raw;
  }
  return bands;
}

// Official SAT scoring: sections 200–800 and total 400–1600, all in 10-point increments,
// and the total must equal the two Section scores. Bands stay ordinal 1–7 or Not provided.
function parseResult(body: unknown): { ok: true; value: ParsedResult } | { ok: false; response: Response } {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { ok: false, response: failure(400, "invalid_result", "Enter the test date, Section scores, and total score.") };
  const input = body as Record<string, unknown>;
  const unexpected = Object.keys(input).some((key) =>
    !["administrationDate", "readingWriting", "math", "total", "bands"].includes(key));
  if (unexpected)
    return { ok: false, response: failure(400, "invalid_result", "Only the test date, Section scores, total score, and bands can be saved.") };
  const date = input.administrationDate;
  if (typeof date !== "string" || !isCalendarDate(date))
    return { ok: false, response: failure(400, "invalid_date", "Enter the real calendar date you took the SAT.") };
  if (date > today())
    return { ok: false, response: failure(400, "invalid_date", "Official results cannot be dated in the future.") };
  const readingWriting = sectionScore(input.readingWriting, 200, 800);
  if (readingWriting === null)
    return { ok: false, response: failure(400, "invalid_section", "Reading and Writing scores run from 200 to 800 in 10-point increments.") };
  const math = sectionScore(input.math, 200, 800);
  if (math === null)
    return { ok: false, response: failure(400, "invalid_section", "Math scores run from 200 to 800 in 10-point increments.") };
  const total = sectionScore(input.total, 400, 1600);
  if (total === null)
    return { ok: false, response: failure(400, "invalid_total", "Total scores run from 400 to 1600 in 10-point increments.") };
  if (total !== readingWriting + math)
    return { ok: false, response: failure(400, "invalid_total", "The total must equal Reading and Writing plus Math.") };
  const bands = parseBands(input.bands);
  if (!bands)
    return { ok: false, response: failure(400, "invalid_band", "Each band is one position from 1 to 7, or leave it as Not provided.") };
  return { ok: true, value: { administration_date: date, total_score: total, reading_writing_score: readingWriting, math_score: math, bands } };
}

function rowJson(row: ResultRow) {
  const bands = Object.fromEntries(
    BAND_KEYS.map((key) => [key, row[BAND_COLUMNS[key] as keyof ResultRow] as number | null]),
  );
  return {
    id: row.id,
    administrationDate: row.administration_date,
    total: row.total_score,
    readingWriting: row.reading_writing_score,
    math: row.math_score,
    bands,
    enteredBy: "learner",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const RESULT_COLUMNS = `id, account_id, administration_date, total_score, reading_writing_score, math_score, ${BAND_KEYS.map((key) => BAND_COLUMNS[key]).join(", ")}, created_at, updated_at`;

async function readBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: Response }> {
  const raw = await request.text();
  if (raw.length > 4096) return { ok: false, response: failure(413, "too_large", "That score entry is too large.") };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, response: failure(400, "invalid_result", "Enter the test date, Section scores, and total score.") };
  }
}

async function listResults(env: AccountEnv, session: LearnerSession): Promise<Response> {
  const result = await env.DB.prepare(
    `SELECT ${RESULT_COLUMNS} FROM official_sat_results WHERE account_id = ? ORDER BY administration_date DESC, created_at DESC`,
  ).bind(session.account_id).all();
  return json({ results: (result.results as ResultRow[]).map(rowJson) });
}

async function createResult(request: Request, env: AccountEnv, session: LearnerSession): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const parsed = parseResult(body.value);
  if (!parsed.ok) return parsed.response;
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  const bands = parsed.value.bands;
  await env.DB.prepare(
    `INSERT INTO official_sat_results (id, account_id, administration_date, total_score, reading_writing_score, math_score, ${BAND_KEYS.map((key) => BAND_COLUMNS[key]).join(", ")}, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ${BAND_KEYS.map(() => "?").join(", ")}, ?, ?)`,
  ).bind(id, session.account_id, parsed.value.administration_date, parsed.value.total_score,
    parsed.value.reading_writing_score, parsed.value.math_score,
    ...BAND_KEYS.map((key) => bands[key]), now, now).run();
  return json({
    id,
    administrationDate: parsed.value.administration_date,
    total: parsed.value.total_score,
    readingWriting: parsed.value.reading_writing_score,
    math: parsed.value.math_score,
    bands,
    enteredBy: "learner",
    createdAt: now,
    updatedAt: now,
  }, 201);
}

async function getResult(env: AccountEnv, session: LearnerSession, id: string): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT ${RESULT_COLUMNS} FROM official_sat_results WHERE id = ? AND account_id = ?`,
  ).bind(id, session.account_id).first<ResultRow>();
  return row ? json(rowJson(row)) : failure(404, "not_found", "That score entry does not exist.");
}

async function updateResult(request: Request, env: AccountEnv, session: LearnerSession, id: string): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const body = await readBody(request);
  if (!body.ok) return body.response;
  const parsed = parseResult(body.value);
  if (!parsed.ok) return parsed.response;
  const now = Math.floor(Date.now() / 1000);
  const bands = parsed.value.bands;
  const result = await env.DB.prepare(
    `UPDATE official_sat_results SET administration_date = ?, total_score = ?, reading_writing_score = ?, math_score = ?, ${BAND_KEYS.map((key) => `${BAND_COLUMNS[key]} = ?`).join(", ")}, updated_at = ?
     WHERE id = ? AND account_id = ?`,
  ).bind(parsed.value.administration_date, parsed.value.total_score, parsed.value.reading_writing_score, parsed.value.math_score,
    ...BAND_KEYS.map((key) => bands[key]), now, id, session.account_id).run();
  if (!result.meta.changes) return failure(404, "not_found", "That score entry does not exist.");
  return getResult(env, session, id);
}

async function deleteResult(request: Request, env: AccountEnv, session: LearnerSession, id: string): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const result = await env.DB.prepare("DELETE FROM official_sat_results WHERE id = ? AND account_id = ?")
    .bind(id, session.account_id).run();
  if (!result.meta.changes) return failure(404, "not_found", "That score entry does not exist.");
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

const SCORE_ID = /^\/api\/account\/scores\/([A-Za-z0-9-]+)$/;
const SCORE_COLLECTION = /^\/api\/account\/scores$/;

export function scoresRoute(request: Request, env: AccountEnv): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (SCORE_COLLECTION.test(path))
    return request.method === "GET" ? listRoute(request, env) :
      request.method === "POST" ? createRoute(request, env) : Promise.resolve(notMatched());
  const match = SCORE_ID.exec(path);
  if (!match) return null;
  const id = match[1];
  if (request.method === "GET") return guarded(request, env, (session) => getResult(env, session, id));
  if (request.method === "PUT") return guarded(request, env, (session) => updateResult(request, env, session, id));
  if (request.method === "DELETE") return guarded(request, env, (session) => deleteResult(request, env, session, id));
  return Promise.resolve(notMatched());
}

function notMatched(): Response {
  return failure(404, "not_found", "This score action is unavailable.");
}

async function listRoute(request: Request, env: AccountEnv): Promise<Response> {
  const session = await currentSession(request, env);
  return session ? listResults(env, session) : failure(401, "signed_out", "Sign in with Google to open your workspace.");
}

async function createRoute(request: Request, env: AccountEnv): Promise<Response> {
  const session = await currentSession(request, env);
  return session ? createResult(request, env, session) : failure(401, "signed_out", "Sign in with Google to open your workspace.");
}

async function guarded(request: Request, env: AccountEnv, action: (session: LearnerSession) => Promise<Response>): Promise<Response> {
  const session = await currentSession(request, env);
  return session ? action(session) : failure(401, "signed_out", "Sign in with Google to open your workspace.");
}
