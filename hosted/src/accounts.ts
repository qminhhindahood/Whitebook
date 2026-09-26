import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";

type Statement = {
  bind(...values: unknown[]): Statement;
  first<T>(): Promise<T | null>;
  all(): Promise<{ results: unknown[]; meta: { rows_read: number; rows_written: number } }>;
  run(): Promise<{ success: boolean; meta: { changes?: number; rows_read: number; rows_written: number } }>;
};

export type AccountEnv = {
  DB: {
    prepare(sql: string): Statement;
    batch(statements: Statement[]): Promise<unknown[]>;
  };
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  APP_ORIGIN?: string;
  OWNER_GOOGLE_SUB?: string;
};

type Identity = { sub: string; email: string; name: string };
type Account = { id: string; provider_subject: string; email: string; display_name: string; nickname: string };
export type Session = { token_hash: string; csrf_hash: string; expires_at: number; account_id: string };
type Flow = { nonce: string; code_verifier: string; expires_at: number };

const SESSION_SECONDS = 7 * 24 * 60 * 60;
const FLOW_SECONDS = 10 * 60;
export const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };
const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function randomToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function cookie(request: Request, name: string): string | null {
  const match = new RegExp(`(?:^|;\\s*)${name}=([a-f0-9]{64})(?:;|$)`).exec(request.headers.get("Cookie") ?? "");
  return match?.[1] ?? null;
}

function sessionCookie(value: string, age = SESSION_SECONDS): string {
  return `__Host-wb_session=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}

function csrfCookie(value: string, age = SESSION_SECONDS): string {
  return `__Host-wb_csrf=${value}; Path=/; Max-Age=${age}; Secure; SameSite=Lax`;
}

function flowCookie(value: string, age = FLOW_SECONDS): string {
  return `__Host-wb_oauth=${value}; Path=/; Max-Age=${age}; HttpOnly; Secure; SameSite=Lax`;
}

export function failure(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status, headers: noStore });
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: noStore });
}

function sameOrigin(request: Request, origin: string): boolean {
  return request.headers.get("Origin") === origin && new URL(request.url).origin === origin;
}

export async function currentSession(request: Request, env: AccountEnv): Promise<Session | null> {
  const token = cookie(request, "__Host-wb_session");
  if (!token) return null;
  return env.DB.prepare("SELECT token_hash, csrf_hash, expires_at, account_id FROM learner_sessions WHERE token_hash = ? AND expires_at > ?")
    .bind(await sha256(token), Math.floor(Date.now() / 1000)).first<Session>();
}

export async function requireMutation(request: Request, env: AccountEnv, session: Session): Promise<Response | null> {
  if (!env.APP_ORIGIN || !sameOrigin(request, env.APP_ORIGIN))
    return failure(403, "invalid_origin", "Open Whitebook from its official address and try again.");
  const csrf = request.headers.get("X-CSRF-Token");
  if (!csrf || !/^[a-f0-9]{64}$/.test(csrf) || await sha256(csrf) !== session.csrf_hash)
    return failure(403, "invalid_csrf", "Your session changed. Refresh Whitebook and try again.");
  return null;
}

export async function verifyGoogleIdToken(token: string, clientId: string, nonce: string, keys: JWTVerifyGetKey = googleKeys): Promise<Identity> {
  const { payload } = await jwtVerify(token, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: clientId,
    algorithms: ["RS256"],
  });
  if (payload.nonce !== nonce || typeof payload.sub !== "string" || !payload.sub ||
      typeof payload.email !== "string" || typeof payload.name !== "string")
    throw new Error("Invalid Google identity claims");
  return { sub: payload.sub, email: payload.email, name: payload.name };
}

type Provider = {
  exchange(code: string, verifier: string, env: AccountEnv): Promise<string>;
  verify(token: string, clientId: string, nonce: string): Promise<Identity>;
};

const google: Provider = {
  async exchange(code, verifier, env) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code, code_verifier: verifier, client_id: env.GOOGLE_CLIENT_ID!,
        client_secret: env.GOOGLE_CLIENT_SECRET!, grant_type: "authorization_code",
        redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`,
      }),
    });
    if (!response.ok) throw new Error("Google code exchange failed");
    const body = await response.json() as { id_token?: unknown };
    if (typeof body.id_token !== "string") throw new Error("Google did not return an ID token");
    return body.id_token;
  },
  verify: verifyGoogleIdToken,
};

async function start(request: Request, env: AccountEnv): Promise<Response> {
  if (!env.APP_ORIGIN || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET ||
      new URL(request.url).origin !== env.APP_ORIGIN)
    return failure(503, "sign_in_unavailable", "Google sign-in is not configured for this address.");
  const state = randomToken();
  const nonce = randomToken();
  const verifier = randomToken();
  const challenge = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  await env.DB.prepare("INSERT INTO oauth_flows (state_hash, nonce, code_verifier, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await sha256(state), nonce, verifier, Math.floor(Date.now() / 1000) + FLOW_SECONDS).run();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID, redirect_uri: `${env.APP_ORIGIN}/api/auth/google/callback`,
    response_type: "code", scope: "openid email profile", state, nonce,
    code_challenge: challenge, code_challenge_method: "S256",
  }).toString();
  return new Response(null, { status: 302, headers: { ...noStore, Location: url.toString(), "Set-Cookie": flowCookie(state) } });
}

async function callback(request: Request, env: AccountEnv, provider: Provider): Promise<Response> {
  if (!env.APP_ORIGIN || !env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET ||
      new URL(request.url).origin !== env.APP_ORIGIN)
    return failure(503, "sign_in_unavailable", "Google sign-in is not configured for this address.");
  const url = new URL(request.url);
  const state = cookie(request, "__Host-wb_oauth");
  if (!state || state !== url.searchParams.get("state"))
    return failure(403, "invalid_login_state", "Sign-in expired. Start again from Whitebook.");
  const flow = await env.DB.prepare("DELETE FROM oauth_flows WHERE state_hash = ? AND expires_at > ? RETURNING nonce, code_verifier, expires_at")
    .bind(await sha256(state), Math.floor(Date.now() / 1000)).first<Flow>();
  if (!flow) return failure(403, "invalid_login_state", "Sign-in expired. Start again from Whitebook.");
  const code = url.searchParams.get("code");
  if (url.searchParams.has("error") || !code || code.length > 2048)
    return new Response(null, { status: 302, headers: { ...noStore, Location: `${env.APP_ORIGIN}/dashboard?error=google_cancelled`, "Set-Cookie": flowCookie("", 0) } });
  let identity: Identity;
  try {
    identity = await provider.verify(await provider.exchange(code, flow.code_verifier, env), env.GOOGLE_CLIENT_ID, flow.nonce);
  } catch {
    return new Response(null, { status: 302, headers: { ...noStore, Location: `${env.APP_ORIGIN}/dashboard?error=google_failed`, "Set-Cookie": flowCookie("", 0) } });
  }
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, created_at) VALUES (?, 'google', ?, ?, ?, ?) ON CONFLICT(provider_subject) DO UPDATE SET email = excluded.email, display_name = excluded.display_name")
    .bind(crypto.randomUUID(), identity.sub, identity.email, identity.name, now).run();
  const account = await env.DB.prepare("SELECT id, provider_subject, email, display_name, nickname FROM learner_accounts WHERE provider_subject = ?")
    .bind(identity.sub).first<Account>();
  if (!account) return failure(503, "account_unavailable", "Your account could not be opened. Try again.");
  const token = randomToken();
  const csrf = randomToken();
  await env.DB.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(await sha256(token), account.id, await sha256(csrf), now + SESSION_SECONDS, now).run();
  const headers = new Headers({ ...noStore, Location: `${env.APP_ORIGIN}/dashboard` });
  headers.append("Set-Cookie", sessionCookie(token));
  headers.append("Set-Cookie", csrfCookie(csrf));
  headers.append("Set-Cookie", flowCookie("", 0));
  return new Response(null, { status: 302, headers });
}

async function me(request: Request, env: AccountEnv): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const account = await env.DB.prepare("SELECT id, provider_subject, email, display_name, nickname FROM learner_accounts WHERE id = ?")
    .bind(session.account_id).first<Account>();
  if (!account) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  return json({
    account: { id: account.id, email: account.email, displayName: account.display_name,
      nickname: account.nickname, role: env.OWNER_GOOGLE_SUB === account.provider_subject ? "owner" : "learner" },
    session: { expiresAt: session.expires_at },
  });
}

async function mutate(request: Request, env: AccountEnv, action: "renew" | "signout" | "profile"): Promise<Response> {
  const session = await currentSession(request, env);
  if (!session) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  if (action === "signout") {
    await env.DB.prepare("DELETE FROM learner_sessions WHERE token_hash = ?").bind(session.token_hash).run();
    const headers = new Headers({ ...noStore, "Clear-Site-Data": '"cache"' });
    headers.append("Set-Cookie", sessionCookie("", 0));
    headers.append("Set-Cookie", csrfCookie("", 0));
    return new Response(null, { status: 204, headers });
  }
  if (action === "renew") {
    const token = randomToken();
    const csrf = randomToken();
    const expiresAt = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
    const result = await env.DB.prepare("UPDATE learner_sessions SET token_hash = ?, csrf_hash = ?, expires_at = ? WHERE token_hash = ? AND expires_at > ?")
      .bind(await sha256(token), await sha256(csrf), expiresAt, session.token_hash, Math.floor(Date.now() / 1000)).run();
    if (!result.meta.changes) return failure(401, "signed_out", "Your session expired. Sign in again.");
    const headers = new Headers(noStore);
    headers.append("Set-Cookie", sessionCookie(token));
    headers.append("Set-Cookie", csrfCookie(csrf));
    return Response.json({ expiresAt }, { headers });
  }
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 2048) return failure(413, "too_large", "That profile update is too large.");
    body = JSON.parse(raw);
  } catch {
    return failure(400, "invalid_profile", "Enter a valid nickname.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "nickname"))
    return failure(400, "invalid_profile", "Only your nickname can be changed here.");
  const nickname = (body as { nickname?: unknown }).nickname;
  if (typeof nickname !== "string" || nickname.length > 80)
    return failure(400, "invalid_profile", "Nickname must be 80 characters or fewer.");
  await env.DB.prepare("UPDATE learner_accounts SET nickname = ? WHERE id = ?").bind(nickname.trim(), session.account_id).run();
  return json({ nickname: nickname.trim() });
}

export function accountRoute(request: Request, env: AccountEnv, provider: Provider = google): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && path === "/api/auth/status")
    return Promise.resolve(json({ googleReady: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.APP_ORIGIN === new URL(request.url).origin) }));
  if (request.method === "GET" && path === "/api/auth/google/start") return start(request, env);
  if (request.method === "GET" && path === "/api/auth/google/callback") return callback(request, env, provider);
  if (request.method === "GET" && path === "/api/account/me") return me(request, env);
  if (request.method === "POST" && path === "/api/auth/renew") return mutate(request, env, "renew");
  if (request.method === "POST" && path === "/api/auth/signout") return mutate(request, env, "signout");
  if (request.method === "POST" && path === "/api/account/profile") return mutate(request, env, "profile");
  if (path.startsWith("/api/auth/") || path.startsWith("/api/account/"))
    return Promise.resolve(failure(404, "not_found", "This account action is unavailable."));
  return null;
}
