import { expect, it } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { accountRoute, verifyGoogleIdToken, type AccountEnv } from "../src/accounts";

const origin = "https://whitebook.example.test";

function dbFixture() {
  const accounts = new Map<string, { id: string; provider_subject: string; email: string; display_name: string; nickname: string }>();
  const sessions = new Map<string, { token_hash: string; account_id: string; csrf_hash: string; expires_at: number }>();
  const flows = new Map<string, { nonce: string; code_verifier: string; expires_at: number }>();
  return {
    accounts, sessions, flows,
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async all() { return { results: [], meta: { rows_read: 0, rows_written: 0 } }; },
        async first<T>(): Promise<T | null> {
          if (sql.startsWith("DELETE FROM oauth_flows")) {
            const flow = flows.get(String(args[0]));
            flows.delete(String(args[0]));
            return (flow && flow.expires_at > Number(args[1]) ? flow : null) as T | null;
          }
          if (sql.startsWith("SELECT id, provider_subject") && sql.includes("provider_subject ="))
            return ([...accounts.values()].find((item) => item.provider_subject === args[0]) ?? null) as T | null;
          if (sql.startsWith("SELECT id, provider_subject") && sql.includes("id ="))
            return ([...accounts.values()].find((item) => item.id === args[0]) ?? null) as T | null;
          if (sql.startsWith("SELECT token_hash")) {
            const session = sessions.get(String(args[0]));
            return (session && session.expires_at > Number(args[1]) ? session : null) as T | null;
          }
          throw new Error(`Unexpected read: ${sql}`);
        },
        async run() {
          let changes = 1;
          if (sql.startsWith("INSERT INTO oauth_flows"))
            flows.set(String(args[0]), { nonce: String(args[1]), code_verifier: String(args[2]), expires_at: Number(args[3]) });
          else if (sql.startsWith("INSERT INTO learner_accounts")) {
            const existing = [...accounts.values()].find((item) => item.provider_subject === args[1]);
            if (existing) { existing.email = String(args[2]); existing.display_name = String(args[3]); }
            else accounts.set(String(args[0]), { id: String(args[0]), provider_subject: String(args[1]), email: String(args[2]), display_name: String(args[3]), nickname: "" });
          } else if (sql.startsWith("INSERT INTO learner_sessions"))
            sessions.set(String(args[0]), { token_hash: String(args[0]), account_id: String(args[1]), csrf_hash: String(args[2]), expires_at: Number(args[3]) });
          else if (sql.startsWith("DELETE FROM learner_sessions")) changes = sessions.delete(String(args[0])) ? 1 : 0;
          else if (sql.startsWith("UPDATE learner_sessions")) {
            const old = sessions.get(String(args[3]));
            if (old && old.expires_at > Number(args[4])) {
              sessions.delete(String(args[3]));
              sessions.set(String(args[0]), { ...old, token_hash: String(args[0]), csrf_hash: String(args[1]), expires_at: Number(args[2]) });
            } else changes = 0;
          } else if (sql.startsWith("UPDATE learner_accounts")) {
            const account = accounts.get(String(args[1]));
            if (account) account.nickname = String(args[0]); else changes = 0;
          } else throw new Error(`Unexpected write: ${sql}`);
          return { success: true, meta: { changes, rows_read: 0, rows_written: changes } };
        },
      };
    },
  };
}

function cookies(response: Response): Record<string, string> {
  return Object.fromEntries(response.headers.getSetCookie().flatMap((line) => {
    const [pair] = line.split(";");
    const [key, value] = pair.split("=");
    return [[key, value]];
  }));
}

function request(path: string, cookieJar: Record<string, string> = {}, init: RequestInit = {}) {
  return new Request(`${origin}${path}`, {
    ...init,
    headers: { Cookie: Object.entries(cookieJar).map(([key, value]) => `${key}=${value}`).join("; "), ...init.headers },
  });
}

it("creates separate accounts by Google subject, returns to the same account, renews and revokes sessions", async () => {
  const db = dbFixture();
  const env: AccountEnv = { DB: db, APP_ORIGIN: origin, GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "secret", OWNER_GOOGLE_SUB: "owner-sub" };
  const provider = {
    async exchange(code: string) { return code; },
    async verify(token: string, _clientId: string, nonce: string) {
      expect(nonce).toMatch(/^[a-f0-9]{64}$/);
      return { sub: token, email: token === "owner-sub" || token === "owner-email-sub" ? "owner@example.test" : "same@example.test", name: "Google Name" };
    },
  };
  const call = (req: Request) => accountRoute(req, env, provider)!;
  async function login(subject: string) {
    const started = await call(request("/api/auth/google/start"));
    expect(started.status).toBe(302);
    const jar = cookies(started);
    const authorization = new URL(started.headers.get("location")!);
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256");
    expect(jar["__Host-wb_oauth"]).toBeTruthy();
    const callback = await call(request(`/api/auth/google/callback?code=${subject}&state=${authorization.searchParams.get("state")}`, jar));
    expect(callback.status).toBe(302);
    expect(callback.headers.get("cache-control")).toContain("no-store");
    const sessionJar = cookies(callback);
    expect(callback.headers.getSetCookie().join(" ")).toMatch(/HttpOnly.*Secure.*SameSite=Lax/);
    return sessionJar;
  }
  const first = await login("learner-sub");
  const firstMe = await call(request("/api/account/me", first));
  const firstBody = await firstMe.json() as { account: { id: string; nickname: string; role: string } };
  expect(firstBody.account).toMatchObject({ nickname: "", role: "learner" });
  expect(firstMe.headers.get("cache-control")).toContain("no-store");

  const invalid = await call(request("/api/account/profile", first, { method: "POST", headers: { Origin: "https://evil.test", "X-CSRF-Token": first["__Host-wb_csrf"] }, body: JSON.stringify({ nickname: "Wrong" }) }));
  expect(invalid.status).toBe(403);
  expect((await call(request("/api/account/profile", first, { method: "POST", headers: { Origin: origin }, body: JSON.stringify({ nickname: "Wrong" }) }))).status).toBe(403);
  expect((await call(request("/api/account/profile", first, { method: "POST", headers: { Origin: origin, "X-CSRF-Token": first["__Host-wb_csrf"] }, body: JSON.stringify({ nickname: "Name", role: "owner", email: "owner@example.test" }) }))).status).toBe(400);

  const saved = await call(request("/api/account/profile", first, { method: "POST", headers: { Origin: origin, "X-CSRF-Token": first["__Host-wb_csrf"] }, body: JSON.stringify({ nickname: "My space" }) }));
  expect(saved.status).toBe(200);
  const secondBrowser = await login("learner-sub");
  const returned = await (await call(request("/api/account/me", secondBrowser))).json() as typeof firstBody;
  expect(returned.account).toMatchObject({ id: firstBody.account.id, nickname: "My space", role: "learner" });
  const other = await login("other-sub");
  const otherBody = await (await call(request("/api/account/me", other))).json() as typeof firstBody;
  expect(otherBody.account.id).not.toBe(firstBody.account.id);
  expect(otherBody.account.nickname).toBe("");
  const owner = await login("owner-sub");
  expect(((await (await call(request("/api/account/me", owner))).json()) as typeof firstBody).account.role).toBe("owner");
  const matchingEmail = await login("owner-email-sub");
  expect(((await (await call(request("/api/account/me", matchingEmail))).json()) as typeof firstBody).account.role).toBe("learner");

  const renewal = await call(request("/api/auth/renew", secondBrowser, { method: "POST", headers: { Origin: origin, "X-CSRF-Token": secondBrowser["__Host-wb_csrf"] } }));
  expect(renewal.status).toBe(200);
  const renewed = cookies(renewal);
  expect((await call(request("/api/account/me", secondBrowser))).status).toBe(401);
  expect((await call(request("/api/account/me", renewed))).status).toBe(200);
  const signedOut = await call(request("/api/auth/signout", renewed, { method: "POST", headers: { Origin: origin, "X-CSRF-Token": renewed["__Host-wb_csrf"] } }));
  expect(signedOut.status).toBe(204);
  expect(signedOut.headers.get("clear-site-data")).toContain("cache");
  expect((await call(request("/api/account/me", renewed))).status).toBe(401);
  expect((await call(request("/api/account/me", first))).status).toBe(200);
});

it("rejects a forged callback and gives a useful provider failure", async () => {
  const db = dbFixture();
  const env: AccountEnv = { DB: db, APP_ORIGIN: origin, GOOGLE_CLIENT_ID: "client-id", GOOGLE_CLIENT_SECRET: "secret" };
  const provider = { async exchange() { throw new Error("provider down"); }, async verify() { throw new Error("unused"); } };
  const call = (req: Request) => accountRoute(req, env, provider)!;
  const started = await call(request("/api/auth/google/start"));
  const jar = cookies(started);
  const state = new URL(started.headers.get("location")!).searchParams.get("state");
  expect((await call(request("/api/auth/google/callback?code=x&state=wrong", jar))).status).toBe(403);
  const failed = await call(request(`/api/auth/google/callback?code=x&state=${state}`, jar));
  expect(failed.headers.get("location")).toBe(`${origin}/app?error=google_failed`);
  expect((await call(request(`/api/auth/google/callback?code=x&state=${state}`, jar))).status).toBe(403);
});

it("verifies Google's signature, audience, issuer, expiry and login nonce", async () => {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const key = { ...await exportJWK(publicKey), kid: "test-key", alg: "RS256", use: "sig" };
  const keys = createLocalJWKSet({ keys: [key] });
  const sign = (audience = "client-id", issuer = "https://accounts.google.com", expiration = "5m") =>
    new SignJWT({ sub: "stable-subject", email: "learner@example.test", name: "Learner", nonce: "expected-nonce" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer(issuer).setAudience(audience)
      .setIssuedAt().setExpirationTime(expiration).sign(privateKey);
  const valid = await sign();
  expect(await verifyGoogleIdToken(valid, "client-id", "expected-nonce", keys)).toMatchObject({ sub: "stable-subject" });
  await expect(verifyGoogleIdToken(valid, "wrong-client", "expected-nonce", keys)).rejects.toThrow();
  await expect(verifyGoogleIdToken(valid, "client-id", "wrong-nonce", keys)).rejects.toThrow();
  await expect(verifyGoogleIdToken(await sign("client-id", "https://evil.test"), "client-id", "expected-nonce", keys)).rejects.toThrow();
  await expect(verifyGoogleIdToken(await sign("client-id", "https://accounts.google.com", "-1s"), "client-id", "expected-nonce", keys)).rejects.toThrow();
  const otherKey = await generateKeyPair("RS256");
  const forged = await new SignJWT({ sub: "forged", nonce: "expected-nonce", email: "x", name: "x" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" }).setIssuer("https://accounts.google.com")
    .setAudience("client-id").setIssuedAt().setExpirationTime("5m").sign(otherKey.privateKey);
  await expect(verifyGoogleIdToken(forged, "client-id", "expected-nonce", keys)).rejects.toThrow();
});
