import { accountRoute, type AccountEnv } from "./accounts";
import { satDateRoute } from "./satDates";
import { cardRoute } from "./cards";
import { scoresRoute } from "./scores";
import { studyRoute } from "./study";
import { libraryRoute } from "./library";

type Statement = {
  bind(...values: unknown[]): Statement;
  all(): Promise<{ results: unknown[]; meta: { rows_read: number; rows_written: number } }>;
  run(): Promise<{ success: boolean; meta: { rows_read: number; rows_written: number } }>;
};

type Env = AccountEnv & {
  DB: { prepare(sql: string): Statement };
  ASSETS: { fetch(request: Request): Promise<Response> };
  STAGING_ACCESS_CODE: string;
};

const QUESTION_PATH = /^\/api\/staging\/questions\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/;
const CONTENT_PATH = /^\/content\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+\.svg)$/;
const PUBLIC_ASSET_PATH = /^\/assets\/[A-Za-z0-9_-]+\.(?:js|css|woff2?|ttf)$/;
const SESSION_SECONDS = 30 * 60;
type Meter = { rowsRead: number; rowsWritten: number };

async function one(env: Env, meter: Meter, sql: string, ...values: unknown[]): Promise<unknown | null> {
  const result = await env.DB.prepare(sql).bind(...values).all();
  meter.rowsRead += result.meta.rows_read;
  meter.rowsWritten += result.meta.rows_written;
  return result.results[0] ?? null;
}

function measured(response: Response, meter: Meter): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Staging-D1-Rows-Read", String(meter.rowsRead));
  headers.set("X-Staging-D1-Rows-Written", String(meter.rowsWritten));
  return new Response(response.body, { status: response.status, headers });
}

function closed(status = 404): Response {
  return new Response(null, {
    status,
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function matchesCode(value: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(value), sha256(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function cookieToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie") ?? "";
  const match = /(?:^|;\s*)wb_staging=([a-f0-9]{64})(?:;|$)/.exec(cookie);
  return match?.[1] ?? null;
}

async function authorized(request: Request, env: Env, meter: Meter): Promise<boolean> {
  const token = cookieToken(request);
  if (!token) return false;
  const row = await one(env, meter,
    "SELECT token_hash FROM staging_sessions WHERE token_hash = ? AND expires_at > ?",
    await sha256(token), Math.floor(Date.now() / 1000));
  return row !== null;
}

async function session(request: Request, env: Env, meter: Meter): Promise<Response> {
  if (request.headers.get("Origin") !== new URL(request.url).origin) return closed(403);
  if (!env.STAGING_ACCESS_CODE) return closed(503);
  let accessCode: unknown;
  try {
    const body = await request.text();
    if (body.length > 1024) return closed(413);
    accessCode = JSON.parse(body).accessCode;
  } catch {
    return closed(400);
  }
  if (typeof accessCode !== "string" || !(await matchesCode(accessCode, env.STAGING_ACCESS_CODE)))
    return closed(401);

  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const result = await env.DB.prepare(
    "INSERT INTO staging_sessions (token_hash, expires_at) VALUES (?, ?)",
  ).bind(await sha256(token), expiresAt).run();
  meter.rowsRead += result.meta.rows_read;
  meter.rowsWritten += result.meta.rows_written;
  if (!result.success) return closed(503);
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": `wb_staging=${token}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Strict`,
      "Cache-Control": "private, no-store",
    },
  });
}

async function question(request: Request, env: Env, meter: Meter, revisionId: string, questionId: string): Promise<Response> {
  if (!(await authorized(request, env, meter))) return closed();
  const row = await one(env, meter,
    "SELECT revision_id, presentation_json FROM fixture_questions WHERE revision_id = ? AND question_id = ?",
    revisionId, questionId) as { revision_id: string; presentation_json: string } | null;
  if (!row) return closed();
  return Response.json(
    { revisionId: row.revision_id, questionId, presentation: JSON.parse(row.presentation_json) },
    { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } },
  );
}

async function content(request: Request, env: Env, meter: Meter, revisionId: string, questionId: string, name: string): Promise<Response> {
  if (!(await authorized(request, env, meter))) return closed();
  const path = `/content/${revisionId}/${questionId}/${name}`;
  const row = await one(env, meter,
    "SELECT path, content_type FROM fixture_assets WHERE path = ? AND revision_id = ? AND question_id = ?",
    path, revisionId, questionId) as { path: string; content_type: string } | null;
  if (!row || row.path !== path || row.content_type !== "image/svg+xml") return closed();
  const asset = await env.ASSETS.fetch(request);
  if (!asset.ok) return closed();
  const headers = new Headers(asset.headers);
  headers.set("Content-Type", row.content_type);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Security-Policy", "default-src 'none'; sandbox");
  return new Response(asset.body, { status: 200, headers });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && (path === "/" || path === "/app" || path === "/app.html"))
      return new Response(null, { status: 302, headers: { Location: new URL("/dashboard", request.url).toString(), "Cache-Control": "private, no-store" } });
    if (request.method === "GET" && path === "/dashboard") {
      const asset = await env.ASSETS.fetch(new Request(new URL("/app", request.url), request));
      const headers = new Headers(asset.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
      return new Response(asset.body, { status: asset.status, headers });
    }
    if (request.method === "GET" && (path === "/staging" || path === "/staging.html" || PUBLIC_ASSET_PATH.test(path)))
      return env.ASSETS.fetch(request);
    const meter: Meter = { rowsRead: 0, rowsWritten: 0 };
    try {
      const scoresResponse = scoresRoute(request, env);
      if (scoresResponse) return await scoresResponse;
      const satResponse = satDateRoute(request, env);
      if (satResponse) return await satResponse;
      const accountResponse = accountRoute(request, env);
      if (accountResponse) return await accountResponse;
      const studyResponse = studyRoute(request, env);
      if (studyResponse) return await studyResponse;
      const cardsResponse = cardRoute(request, env);
      if (cardsResponse) return await cardsResponse;
      const libraryResponse = libraryRoute(request, env);
      if (libraryResponse) return await libraryResponse;
      if (request.method === "POST" && path === "/api/staging/session")
        return measured(await session(request, env, meter), meter);
      const questionMatch = request.method === "GET" && QUESTION_PATH.exec(path);
      if (questionMatch) return measured(await question(request, env, meter, questionMatch[1], questionMatch[2]), meter);
      const contentMatch = request.method === "GET" && CONTENT_PATH.exec(path);
      if (contentMatch) return measured(await content(request, env, meter, contentMatch[1], contentMatch[2], contentMatch[3]), meter);
    } catch {
      if (path.startsWith("/api/account/") || path.startsWith("/api/auth/") || path.startsWith("/api/cards/") || path.startsWith("/api/library") || path.startsWith("/content/"))
        return Response.json({ error: { code: "service_unavailable", message: "Whitebook could not reach your account. Try again." } },
          { status: 503, headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
      return closed(503);
    }
    return closed();
  },
};
