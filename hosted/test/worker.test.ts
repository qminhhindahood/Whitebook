import { expect, it, vi } from "vitest";
import worker from "../src/worker";

const presentation = {
  version: 1,
  stimulus: [],
  stem: [
    { kind: "text", text: "What is the area of the triangle?" },
    { kind: "asset", src: "/content/v1/fixture-1/triangle.svg", alt: "Triangle" },
  ],
  choices: [
    { id: "A", content: [{ kind: "text", text: "4" }] },
    { id: "B", content: [{ kind: "text", text: "6" }] },
    { id: "C", content: [{ kind: "text", text: "8" }] },
    { id: "D", content: [{ kind: "text", text: "12" }] },
  ],
};

function environment(desmosApiKey?: string) {
  const sessions = new Set<string>();
  const learnerSessions = new Map<string, { token_hash: string; csrf_hash: string; expires_at: number; account_id: string }>();
  const assetFetch = vi.fn(async (request: Request) => new URL(request.url).pathname === "/assets/reference-sheet.png"
    ? new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { headers: { "content-type": "image/png" } })
    : new Response("<svg/>", { headers: { "content-type": "image/svg+xml" } }));
  const db = {
    async batch() { throw new Error("Unexpected D1 batch"); },
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...value: unknown[]) {
          args = value;
          return this;
        },
        async first<T>() {
          if (sql.includes("FROM learner_sessions")) return (learnerSessions.get(String(args[0])) ?? null) as T | null;
          return null;
        },
        async all() {
          if (sql.includes("FROM staging_sessions"))
            return { results: sessions.has(String(args[0])) ? [{ token_hash: args[0] }] : [], meta: { rows_read: 1, rows_written: 0 } };
          if (sql.includes("FROM fixture_questions"))
            return { results: [{ presentation_json: JSON.stringify(presentation), revision_id: "v1" }], meta: { rows_read: 1, rows_written: 0 } };
          if (sql.includes("FROM fixture_assets"))
            return { results: [{ path: "/content/v1/fixture-1/triangle.svg", content_type: "image/svg+xml" }], meta: { rows_read: 1, rows_written: 0 } };
          throw new Error(`Unexpected query: ${sql}`);
        },
        async run() {
          if (!sql.includes("INTO staging_sessions")) throw new Error(`Unexpected write: ${sql}`);
          sessions.add(String(args[0]));
          return { success: true, meta: { rows_read: 0, rows_written: 1 } };
        },
      };
    },
  };
  return {
    DB: db,
    ASSETS: { fetch: assetFetch },
    STAGING_ACCESS_CODE: "local-secret-for-test",
    ...(desmosApiKey === undefined ? {} : { DESMOS_API_KEY: desmosApiKey }),
    learnerSessions,
    assetFetch,
  };
}

async function addLearnerSession(env: ReturnType<typeof environment>, token = "a".repeat(64)) {
  const tokenHash = await hash(token);
  env.learnerSessions.set(tokenHash, { token_hash: tokenHash, csrf_hash: "c".repeat(64),
    expires_at: Math.floor(Date.now() / 1000) + 3600, account_id: "learner-a" });
  return `__Host-wb_session=${token}`;
}

async function hash(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function get(path: string, cookie?: string, host = "staging.example.test") {
  return new Request(`https://${host}${path}`, {
    headers: cookie ? { Cookie: cookie } : {},
  });
}

it("closes direct, malformed, alternate-host and PDF asset paths before static serving", async () => {
  const env = environment();
  for (const path of [
    "/content/v1/fixture-1/triangle.svg",
    "/content/v1/fixture-1/%74riangle.svg",
    "/content/v1/fixture-1/triangle.svg/extra",
    "/content/v1/fixture-1/source.pdf",
    "/source.pdf",
  ]) {
    const response = await worker.fetch(get(path), env);
    expect(response.status, path).toBe(404);
  }
  expect((await worker.fetch(get("/content/v1/fixture-1/triangle.svg", undefined, "preview.example.test"), env)).status).toBe(404);
  expect(env.assetFetch).not.toHaveBeenCalled();
});
it("serves only the versioned presentation and approved visual after test authorization", async () => {
  const env = environment();
  const login = await worker.fetch(new Request("https://staging.example.test/api/staging/session", {
    method: "POST",
    headers: { Origin: "https://staging.example.test", "Content-Type": "application/json" },
    body: JSON.stringify({ accessCode: "local-secret-for-test" }),
  }), env);
  expect(login.status).toBe(204);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  expect(login.headers.get("set-cookie")).toContain("HttpOnly");
  expect(login.headers.get("set-cookie")).toContain("Secure");
  expect(login.headers.get("x-staging-d1-rows-written")).toBe("1");
  expect(cookie).toBeTruthy();

  const question = await worker.fetch(get("/api/staging/questions/v1/fixture-1", cookie), env);
  expect(question.status).toBe(200);
  expect(question.headers.get("x-staging-d1-rows-read")).toBe("2");
  const payload = await question.json();
  expect(payload).toMatchObject({ revisionId: "v1", questionId: "fixture-1", presentation });
  expect(JSON.stringify(payload)).not.toMatch(/accepted|sourcePdf|\.pdf|local-secret/i);

  const asset = await worker.fetch(get("/content/v1/fixture-1/triangle.svg", cookie), env);
  expect(asset.status).toBe(200);
  expect(asset.headers.get("x-staging-d1-rows-read")).toBe("2");
  expect(asset.headers.get("cache-control")).toBe("private, no-store");
  expect(await asset.text()).toBe("<svg/>");
  expect(env.assetFetch).toHaveBeenCalledTimes(1);
  expect((await worker.fetch(get("/content/v1/fixture-1/source.pdf", cookie), env)).status).toBe(404);
});

it("rejects wrong codes and cross-origin login", async () => {
  const env = environment();
  for (const [origin, accessCode, status] of [
    ["https://evil.example.test", "local-secret-for-test", 403],
    ["https://staging.example.test", "wrong", 401],
  ] as const) {
    const response = await worker.fetch(new Request("https://staging.example.test/api/staging/session", {
      method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ accessCode }),
    }), env);
    expect(response.status).toBe(status);
  }
});

it("routes learner Attempt requests through account authentication", async () => {
  const env = environment();
  const response = await worker.fetch(new Request("https://staging.example.test/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revisionId: "reviewed-rw" }),
  }), env);

  expect(response.status).toBe(401);
  expect(await response.json()).toMatchObject({ error: { code: "signed_out" } });
});

it("returns calculator configuration only to a learner and falls back when Desmos is not configured", async () => {
  const env = environment();
  const anonymous = await worker.fetch(get("/api/math/calculator-config"), env);
  expect(anonymous.status).toBe(401);
  const cookie = await addLearnerSession(env);
  const configured = await worker.fetch(get("/api/math/calculator-config", cookie), env);
  expect(configured.status).toBe(200);
  expect(configured.headers.get("cache-control")).toBe("private, no-store");
  expect(await configured.json()).toEqual({ configured: false, scriptUrl: null });
});

it("returns the configured Desmos script URL only to an authenticated learner", async () => {
  const env = environment("test-desmos-key");
  const anonymous = await worker.fetch(get("/api/math/calculator-config"), env);
  expect(anonymous.status).toBe(401);
  const cookie = await addLearnerSession(env);
  const response = await worker.fetch(get("/api/math/calculator-config", cookie), env);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ configured: true,
    scriptUrl: "https://www.desmos.com/api/v1.12/calculator.js?apiKey=test-desmos-key" });
});

it("serves the Reference Sheet only through authenticated non-cacheable delivery", async () => {
  const env = environment();
  const anonymous = await worker.fetch(get("/api/math/reference-sheet.png"), env);
  expect(anonymous.status).toBe(401);
  const cookie = await addLearnerSession(env);
  const response = await worker.fetch(get("/api/math/reference-sheet.png", cookie), env);
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  expect(new URL((env.assetFetch.mock.calls[0] as unknown as [Request])[0].url).pathname)
    .toBe("/assets/reference-sheet.png");
  const publicPath = await worker.fetch(get("/assets/reference-sheet.png"), env);
  expect(publicPath.status).toBe(404);
  expect(env.assetFetch).toHaveBeenCalledTimes(1);
});

it("opens the hosted Dashboard shell and preserves the old account URL", async () => {
  const env = environment();
  const legacy = await worker.fetch(get("/app"), env);
  expect(legacy.status).toBe(302);
  expect(legacy.headers.get("location")).toBe("https://staging.example.test/dashboard");
  const dashboard = await worker.fetch(get("/dashboard"), env);
  expect(dashboard.status).toBe(200);
  expect(dashboard.headers.get("cache-control")).toBe("private, no-store");
  expect(dashboard.headers.get("content-security-policy")).toContain("script-src 'self'");
  expect(dashboard.headers.get("content-security-policy")).toContain("frame-src 'self'");
  expect(new URL((env.assetFetch.mock.calls[0] as unknown as [Request])[0].url).pathname).toBe("/app");
});
