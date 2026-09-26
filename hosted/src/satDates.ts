import { currentSession, failure, noStore, requireMutation, type AccountEnv, type Session } from "./accounts";

export type SatDateStatus = "confirmed" | "anticipated";
export type SatCatalogEntry = { date: string; status: SatDateStatus };
export type SatSelection = { dates: string[]; primary: string | null };

/**
 * Reviewed catalog of official SAT Weekend administrations, transcribed from
 * College Board's published schedule. School Day windows are deliberately absent:
 * every entry is a single Saturday administration. The owner re-checks the
 * College Board page and records the review date in lastCheckedAt.
 */
export const SAT_CATALOG: {
  source: string;
  sourceUrl: string;
  lastCheckedAt: string;
  dates: SatCatalogEntry[];
} = {
  source: "College Board SAT test dates and deadlines",
  sourceUrl: "https://satsuite.collegeboard.org/sat/dates-deadlines",
  lastCheckedAt: "2026-09-26",
  dates: [
    { date: "2026-10-03", status: "confirmed" },
    { date: "2026-11-07", status: "confirmed" },
    { date: "2026-12-05", status: "confirmed" },
    { date: "2027-03-06", status: "confirmed" },
    { date: "2027-05-01", status: "confirmed" },
    { date: "2027-06-05", status: "confirmed" },
    { date: "2027-08-28", status: "anticipated" },
    { date: "2027-09-18", status: "anticipated" },
    { date: "2027-10-02", status: "anticipated" },
    { date: "2027-11-06", status: "anticipated" },
    { date: "2027-12-04", status: "anticipated" },
    { date: "2028-03-04", status: "anticipated" },
    { date: "2028-05-06", status: "anticipated" },
    { date: "2028-06-03", status: "anticipated" },
  ],
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
function catalogDates(): Set<string> {
  return new Set(SAT_CATALOG.dates.map((entry) => entry.date));
}

function readSelection(rows: { test_date: string; is_primary: number }[]): SatSelection {
  const dates = rows.map((row) => row.test_date).sort();
  const primary = rows.find((row) => row.is_primary === 1);
  return { dates, primary: primary?.test_date ?? null };
}

async function replaceSelection(env: AccountEnv, accountId: string, dates: string[], primary: string | null): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const statements = [env.DB.prepare("DELETE FROM learner_sat_dates WHERE account_id = ?").bind(accountId)];
  for (const date of dates)
    statements.push(env.DB.prepare("INSERT INTO learner_sat_dates (account_id, test_date, is_primary, selected_at) VALUES (?, ?, ?, ?)")
      .bind(accountId, date, date === primary ? 1 : 0, now));
  await env.DB.batch(statements);
}

async function show(request: Request, env: AccountEnv): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const rows = await env.DB.prepare("SELECT test_date, is_primary FROM learner_sat_dates WHERE account_id = ? ORDER BY test_date")
    .bind(session.account_id).all();
  return Response.json(
    {
      catalog: SAT_CATALOG,
      selection: readSelection(rows.results as { test_date: string; is_primary: number }[]),
    },
    { headers: noStore },
  );
}

async function save(request: Request, env: AccountEnv, session: Session): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return failure(413, "too_large", "That SAT date selection is too large.");
    body = JSON.parse(raw);
  } catch {
    return failure(400, "invalid_sat_dates", "Choose your SAT dates and try again.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).some((key) => key !== "dates" && key !== "primary"))
    return failure(400, "invalid_sat_dates", "Only SAT dates and the primary target can be saved here.");
  const { dates, primary } = body as { dates?: unknown; primary?: unknown };
  const allowed = catalogDates();
  if (!Array.isArray(dates) || dates.length > SAT_CATALOG.dates.length ||
      dates.some((date) => typeof date !== "string" || !DATE_PATTERN.test(date) || !allowed.has(date)) ||
      new Set(dates).size !== dates.length)
    return failure(400, "invalid_sat_dates", "Choose SAT Weekend dates from the official list.");
  if (typeof primary !== "string" && primary !== null)
    return failure(400, "invalid_sat_dates", "Your primary SAT date must be one of your selected dates.");
  if ((dates.length === 0 && primary !== null) ||
      (dates.length > 0 && (primary === null || !dates.includes(primary))))
    return failure(400, "invalid_sat_dates", "Your primary SAT date must be one of your selected dates.");
  await replaceSelection(env, session.account_id, [...dates].sort(), primary);
  return Response.json(
    { selection: { dates: [...dates].sort(), primary } satisfies SatSelection },
    { headers: noStore },
  );
}

export function satDateRoute(request: Request, env: AccountEnv): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/account/sat-dates") return show(request, env);
  if (request.method === "POST" && path === "/api/account/sat-dates")
    return currentSession(request, env).then((session) =>
      session ? save(request, env, session) : failure(401, "signed_out", "Sign in with Google to open your workspace."));
  return null;
}
