import { expect, it } from "vitest";
import { scoresRoute } from "../src/scores";
import type { AccountEnv } from "../src/accounts";

const origin = "https://whitebook.example.test";

type Row = {
  id: string; account_id: string; administration_date: string;
  total_score: number; reading_writing_score: number; math_score: number;
  band_information_ideas: number | null; band_craft_structure: number | null;
  band_expression_of_ideas: number | null; band_standard_english_conventions: number | null;
  band_algebra: number | null; band_advanced_math: number | null;
  band_problem_solving_data_analysis: number | null; band_geometry_trigonometry: number | null;
  created_at: number; updated_at: number;
};

function row(overrides: Partial<Row>): Row {
  return {
    id: "result-1", account_id: "account-a", administration_date: "2026-08-23",
    total_score: 1310, reading_writing_score: 610, math_score: 700,
    band_information_ideas: 3, band_craft_structure: null, band_expression_of_ideas: null,
    band_standard_english_conventions: null, band_algebra: 5, band_advanced_math: null,
    band_problem_solving_data_analysis: null, band_geometry_trigonometry: null,
    created_at: 1000, updated_at: 1000, ...overrides,
  };
}

function dbFixture() {
  const sessions = new Map<string, { token_hash: string; account_id: string; csrf_hash: string; expires_at: number }>();
  const results = new Map<string, Row>();
  return {
    sessions, results,
    async batch(): Promise<unknown[]> { throw new Error("Unexpected D1 batch"); },
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async all() {
          if (sql.startsWith("SELECT") && sql.includes("FROM official_sat_results WHERE account_id = ?")) {
            const owned = [...results.values()].filter((item) => item.account_id === args[0]);
            return { results: owned, meta: { rows_read: owned.length, rows_written: 0 } };
          }
          throw new Error(`Unexpected read: ${sql}`);
        },
        async first<T>(): Promise<T | null> {
          if (sql.startsWith("SELECT token_hash")) {
            const session = sessions.get(String(args[0]));
            return (session && session.expires_at > Number(args[1]) ? session : null) as T | null;
          }
          if (sql.startsWith("SELECT") && sql.includes("FROM official_sat_results WHERE id = ? AND account_id = ?")) {
            const found = results.get(String(args[0]));
            return (found && found.account_id === args[1] ? found : null) as T | null;
          }
          throw new Error(`Unexpected read: ${sql}`);
        },
        async run() {
          if (sql.startsWith("INSERT INTO official_sat_results")) {
            const columns = sql.slice(sql.indexOf("(") + 1, sql.indexOf(")")).split(",").map((name) => name.trim());
            const record = Object.fromEntries(columns.map((column, index) => [column, args[index]])) as unknown as Row;
            results.set(record.id, record);
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.startsWith("UPDATE official_sat_results")) {
            const existing = results.get(String(args[13]));
            if (!existing || existing.account_id !== args[14]) return { success: true, meta: { changes: 0, rows_read: 0, rows_written: 0 } };
            results.set(String(args[13]), {
              ...existing,
              administration_date: String(args[0]), total_score: Number(args[1]),
              reading_writing_score: Number(args[2]), math_score: Number(args[3]),
              band_information_ideas: args[4] as number | null, band_craft_structure: args[5] as number | null,
              band_expression_of_ideas: args[6] as number | null, band_standard_english_conventions: args[7] as number | null,
              band_algebra: args[8] as number | null, band_advanced_math: args[9] as number | null,
              band_problem_solving_data_analysis: args[10] as number | null, band_geometry_trigonometry: args[11] as number | null,
              updated_at: Number(args[12]),
            });
            return { success: true, meta: { changes: 1, rows_read: 0, rows_written: 1 } };
          }
          if (sql.startsWith("DELETE FROM official_sat_results")) {
            const existing = results.get(String(args[0]));
            const removed = existing && existing.account_id === args[1];
            if (removed) results.delete(String(args[0]));
            return { success: true, meta: { changes: removed ? 1 : 0, rows_read: 0, rows_written: removed ? 1 : 0 } };
          }
          throw new Error(`Unexpected write: ${sql}`);
        },
      };
    },
  };
}

async function sha256(value: string): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))))
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function environment() {
  const db = dbFixture();
  const env: AccountEnv = { DB: db, APP_ORIGIN: origin };
  for (const [account, token, csrf] of [
    ["account-a", "a".repeat(64), "c".repeat(64)],
    ["account-b", "b".repeat(64), "d".repeat(64)],
  ] as const) {
    db.sessions.set(await sha256(token), { token_hash: await sha256(token), account_id: account, csrf_hash: await sha256(csrf), expires_at: Math.floor(Date.now() / 1000) + 600 });
  }
  const call = (request: Request) => scoresRoute(request, env)!;
  const headers = (token: string, csrf?: string, method?: string): Record<string, string> => ({
    Cookie: `__Host-wb_session=${token}`,
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    ...(method ? { Origin: origin, "Content-Type": "application/json" } : {}),
  });
  const json = (token: string, csrf: string | undefined, method: string, path: string, body?: unknown) =>
    new Request(`${origin}${path}`, { method, headers: headers(token, csrf, method), ...(body ? { body: JSON.stringify(body) } : {}) });
  return { db, env, call, headers, json };
}

const validBody = {
  administrationDate: "2026-08-23", readingWriting: 610, math: 700, total: 1310,
  bands: { informationIdeas: 3, algebra: 5 },
};

it("requires a signed-in session for every score route", async () => {
  const { call } = await environment();
  expect((await call(new Request(`${origin}/api/account/scores`))).status).toBe(401);
  expect((await call(new Request(`${origin}/api/account/scores`, { method: "POST" }))).status).toBe(401);
  expect((await call(new Request(`${origin}/api/account/scores/result-1`, { method: "PUT" }))).status).toBe(401);
  expect((await call(new Request(`${origin}/api/account/scores/result-1`, { method: "DELETE" }))).status).toBe(401);
});

it("rejects mutations without a same-origin request and CSRF token", async () => {
  const { call, json } = await environment();
  const crossOrigin = new Request(`${origin}/api/account/scores`, {
    method: "POST", headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}`, Origin: "https://evil.test", "X-CSRF-Token": "c".repeat(64) },
    body: JSON.stringify(validBody),
  });
  expect((await call(crossOrigin)).status).toBe(403);
  const noCsrf = await call(json("a".repeat(64), undefined, "POST", "/api/account/scores", validBody));
  expect(noCsrf.status).toBe(403);
  expect(((await noCsrf.json()) as { error: { code: string } }).error.code).toBe("invalid_csrf");
});

it("creates a result with section scores and optional bands, then lists only the owner's entries", async () => {
  const { db, call, json } = await environment();
  const created = await call(json("a".repeat(64), "c".repeat(64), "POST", "/api/account/scores", validBody));
  expect(created.status).toBe(201);
  const stored = await created.json() as Record<string, unknown>;
  expect(stored).toMatchObject({
    administrationDate: "2026-08-23", total: 1310, readingWriting: 610, math: 700, enteredBy: "learner",
    bands: { informationIdeas: 3, craftStructure: null, expressionOfIdeas: null, standardEnglishConventions: null,
      algebra: 5, advancedMath: null, problemSolvingDataAnalysis: null, geometryTrigonometry: null },
  });
  expect(db.results.size).toBe(1);

  const listed = await call(new Request(`${origin}/api/account/scores`, { headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}` } }));
  expect(listed.status).toBe(200);
  const body = await listed.json() as { results: { bands: Record<string, number | null> }[] };
  expect(body.results).toHaveLength(1);
  expect(Object.keys(body.results[0].bands)).toHaveLength(8);
  expect(JSON.stringify(body)).not.toMatch(/percent|%|predicted|subscore/i);

  const other = await call(new Request(`${origin}/api/account/scores`, { headers: { Cookie: `__Host-wb_session=${"b".repeat(64)}` } }));
  expect(((await other.json()) as { results: unknown[] }).results).toEqual([]);
});

it("validates official ranges, increments, sum consistency, date, and bands", async () => {
  const { db, call, json } = await environment();
  db.results.set("result-1", row({}));
  const cases: { body: unknown; code: string }[] = [
    { body: { ...validBody, administrationDate: "2026-13-40" }, code: "invalid_date" },
    { body: { ...validBody, administrationDate: "2026-02-30" }, code: "invalid_date" },
    { body: { ...validBody, administrationDate: "23 August 2026" }, code: "invalid_date" },
    { body: { ...validBody, administrationDate: "2999-01-01" }, code: "invalid_date" },
    { body: { ...validBody, readingWriting: 795 }, code: "invalid_section" },
    { body: { ...validBody, readingWriting: 199 }, code: "invalid_section" },
    { body: { ...validBody, math: 801 }, code: "invalid_section" },
    { body: { ...validBody, math: 705.5 }, code: "invalid_section" },
    { body: { ...validBody, total: 390 }, code: "invalid_total" },
    { body: { ...validBody, total: 1610 }, code: "invalid_total" },
    { body: { ...validBody, total: 1320 }, code: "invalid_total" },
    { body: { ...validBody, total: "1310" }, code: "invalid_total" },
    { body: { ...validBody, bands: { informationIdeas: 0 } }, code: "invalid_band" },
    { body: { ...validBody, bands: { algebra: 8 } }, code: "invalid_band" },
    { body: { ...validBody, bands: { algebra: 3.5 } }, code: "invalid_band" },
    { body: { ...validBody, bands: { algebra: "5" } }, code: "invalid_band" },
    { body: { ...validBody, bands: { trapSusceptibility: 3 } }, code: "invalid_band" },
    { body: { ...validBody, bands: [] }, code: "invalid_band" },
    { body: { ...validBody, predictedScore: 1400 }, code: "invalid_result" },
  ];
  for (const testCase of cases) {
    const response = await call(json("a".repeat(64), "c".repeat(64), "POST", "/api/account/scores", testCase.body));
    expect(response.status, JSON.stringify(testCase.body)).toBe(400);
    expect(((await response.json()) as { error: { code: string } }).error.code, JSON.stringify(testCase.body)).toBe(testCase.code);
  }
  // Bands absent entirely means every domain is Not provided, never an inferred value.
  const absent = await call(json("a".repeat(64), "c".repeat(64), "POST", "/api/account/scores",
    { administrationDate: "2026-08-23", readingWriting: 610, math: 700, total: 1310 }));
  expect(absent.status).toBe(201);
  expect((await absent.json() as { bands: Record<string, number | null> }).bands).toEqual({
    informationIdeas: null, craftStructure: null, expressionOfIdeas: null, standardEnglishConventions: null,
    algebra: null, advancedMath: null, problemSolvingDataAnalysis: null, geometryTrigonometry: null,
  });
  expect(db.results.size).toBe(2);
});

it("corrects and deletes an owned result, and hides another account's entry", async () => {
  const { db, call, json } = await environment();
  db.results.set("result-1", row({}));
  const updated = await call(json("a".repeat(64), "c".repeat(64), "PUT", "/api/account/scores/result-1", {
    administrationDate: "2026-08-23", readingWriting: 590, math: 720, total: 1310,
    bands: { informationIdeas: null, algebra: 6 },
  }));
  expect(updated.status).toBe(200);
  expect(await updated.json()).toMatchObject({ readingWriting: 590, math: 720, bands: { informationIdeas: null, algebra: 6 } });
  expect(db.results.get("result-1")).toMatchObject({ reading_writing_score: 590, math_score: 720, band_algebra: 6, band_information_ideas: null });
  const badUpdate = await call(json("a".repeat(64), "c".repeat(64), "PUT", "/api/account/scores/result-1",
    { ...validBody, total: 999 }));
  expect(badUpdate.status).toBe(400);

  // A different account cannot read, change, or delete the entry.
  const foreignToken = "b".repeat(64);
  expect((await call(new Request(`${origin}/api/account/scores/result-1`, { headers: { Cookie: `__Host-wb_session=${foreignToken}` } }))).status).toBe(404);
  expect((await call(json(foreignToken, "d".repeat(64), "PUT", "/api/account/scores/result-1", validBody))).status).toBe(404);
  expect((await call(json(foreignToken, "d".repeat(64), "DELETE", "/api/account/scores/result-1"))).status).toBe(404);
  expect(db.results.get("result-1")).toMatchObject({ reading_writing_score: 590 });

  const removed = await call(json("a".repeat(64), "c".repeat(64), "DELETE", "/api/account/scores/result-1"));
  expect(removed.status).toBe(204);
  expect(db.results.has("result-1")).toBe(false);
  expect((await call(new Request(`${origin}/api/account/scores/result-1`, { headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}` } }))).status).toBe(404);
});

it("returns a useful 404 for unknown score actions", async () => {
  const { call, json } = await environment();
  expect((await call(new Request(`${origin}/api/account/scores`, { method: "PATCH", headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}` } }))).status).toBe(404);
  expect((await call(json("a".repeat(64), "c".repeat(64), "POST", "/api/account/scores/result-1", validBody))).status).toBe(404);
  expect(scoresRoute(new Request(`${origin}/api/account/other`), { DB: dbFixture(), APP_ORIGIN: origin })).toBeNull();
});
