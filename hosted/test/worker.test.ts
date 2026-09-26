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

function environment() {
  const sessions = new Set<string>();
  const assetFetch = vi.fn(async () => new Response("<svg/>", {
    headers: { "content-type": "image/svg+xml" },
  }));
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...value: unknown[]) {
          args = value;
          return this;
        },
        async first() { return null; },
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
    assetFetch,
  };
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
