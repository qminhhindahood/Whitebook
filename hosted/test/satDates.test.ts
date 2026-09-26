import { expect, it } from "vitest";
import { satDateRoute, SAT_CATALOG } from "../src/satDates";
import type { AccountEnv } from "../src/accounts";

const origin = "https://whitebook.example.test";

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function dbFixture() {
  const accounts = new Map<string, { time_zone: string }>();
  const sessions = new Map<string, { account_id: string; csrf_hash: string; expires_at: number }>();
  const selections = new Map<string, Map<string, number>>();
  return {
    accounts, sessions, selections,
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first<T>(): Promise<T | null> {
          if (sql.startsWith("SELECT token_hash")) {
            const session = sessions.get(String(args[0]));
            return (session && session.expires_at > Number(args[1]) ? session : null) as T | null;
          }
          if (sql.startsWith("SELECT time_zone")) {
            const account = accounts.get(String(args[0]));
            return (account ? { time_zone: account.time_zone } : null) as T | null;
          }
          throw new Error(`Unexpected read: ${sql}`);
        },
        async all() {
          if (sql.startsWith("SELECT test_date")) {
            const rows = selections.get(String(args[0]));
            return { results: rows ? [...rows].map(([test_date, is_primary]) => ({ test_date, is_primary })) : [], meta: { rows_read: rows?.size ?? 0, rows_written: 0 } };
          }
          throw new Error(`Unexpected query: ${sql}`);
        },
        async run() {
          if (sql.startsWith("DELETE FROM learner_sat_dates")) {
            const removed = selections.get(String(args[0]));
            selections.delete(String(args[0]));
            return { success: true, meta: { rows_read: 0, rows_written: removed?.size ?? 0 } };
          }
          if (sql.startsWith("INSERT INTO learner_sat_dates")) {
            const accountId = String(args[0]);
            const rows = selections.get(accountId) ?? new Map<string, number>();
            rows.set(String(args[1]), Number(args[2]));
            selections.set(accountId, rows);
            return { success: true, meta: { rows_read: 0, rows_written: 1 } };
          }
          if (sql.startsWith("UPDATE learner_accounts SET time_zone")) {
            const account = accounts.get(String(args[1]));
            if (!account) throw new Error("Unknown account");
            account.time_zone = String(args[0]);
            return { success: true, meta: { rows_read: 0, rows_written: 1 } };
          }
          throw new Error(`Unexpected write: ${sql}`);
        },
      };
    },
  };
}

type Fixture = ReturnType<typeof dbFixture>;

function environment(): { env: AccountEnv; db: Fixture } {
  const db = dbFixture();
  return { env: { DB: db, APP_ORIGIN: origin }, db };
}

function request(path: string, cookieJar: Record<string, string> = {}, init: RequestInit = {}): Request {
  return new Request(`${origin}${path}`, {
    ...init,
    headers: { Cookie: Object.entries(cookieJar).map(([key, value]) => `${key}=${value}`).join("; "), ...init.headers },
  });
}

async function signedInBrowser(env: AccountEnv, db: Fixture, accountId: string): Promise<Record<string, string>> {
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const csrf = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, "0")).join("");
  db.sessions.set(await sha256(token), { account_id: accountId, csrf_hash: await sha256(csrf), expires_at: Math.floor(Date.now() / 1000) + 3600 });
  return { "__Host-wb_session": token, "__Host-wb_csrf": csrf };
}

function mutationHeaders(jar: Record<string, string>): Record<string, string> {
  return { Origin: origin, "X-CSRF-Token": jar["__Host-wb_csrf"], "Content-Type": "application/json" };
}

it("keeps a Saturday-only Weekend catalog with source, last-check and status; no School Day entries", () => {
  expect(SAT_CATALOG.source).toMatch(/College Board/);
  expect(SAT_CATALOG.sourceUrl).toBe("https://satsuite.collegeboard.org/sat/dates-deadlines");
  expect(SAT_CATALOG.lastCheckedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(SAT_CATALOG.dates.length).toBeGreaterThan(1);
  for (const entry of SAT_CATALOG.dates) {
    expect(entry.status === "confirmed" || entry.status === "anticipated").toBe(true);
    expect(entry.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const [year, month, day] = entry.date.split("-").map(Number);
    expect(new Date(Date.UTC(year, month - 1, day)).getUTCDay()).toBe(6);
    expect(JSON.stringify(entry).toLowerCase()).not.toContain("school");
  }
  const statuses = new Set(SAT_CATALOG.dates.map((entry) => entry.status));
  expect(statuses).toEqual(new Set(["confirmed", "anticipated"]));
});

it("requires a signed-in learner and shows the catalog with the account's saved selections", async () => {
  const { env, db } = environment();
  expect((await satDateRoute(request("/api/account/sat-dates"), env))!.status).toBe(401);
  db.accounts.set("account-1", { time_zone: "Asia/Ho_Chi_Minh" });
  const jar = await signedInBrowser(env, db, "account-1");
  db.selections.set("account-1", new Map([["2026-10-03", 1], ["2026-12-05", 0]]));
  const response = await satDateRoute(request("/api/account/sat-dates", jar), env)!;
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const body = await response.json() as { catalog: typeof SAT_CATALOG; selection: { dates: string[]; primary: string | null; timeZone: string | null } };
  expect(body.catalog).toMatchObject({ source: SAT_CATALOG.source, lastCheckedAt: SAT_CATALOG.lastCheckedAt });
  expect(body.catalog.dates).toEqual(SAT_CATALOG.dates);
  expect(body.selection).toEqual({ dates: ["2026-10-03", "2026-12-05"], primary: "2026-10-03", timeZone: "Asia/Ho_Chi_Minh" });
});

it("persists multiple dates and one primary so a second browser sees the same selections", async () => {
  const { env, db } = environment();
  db.accounts.set("account-1", { time_zone: "" });
  const first = await signedInBrowser(env, db, "account-1");
  const save = await satDateRoute(request("/api/account/sat-dates", first, {
    method: "POST", headers: mutationHeaders(first), body: JSON.stringify({
      dates: ["2026-12-05", "2026-10-03"], primary: "2026-10-03", timeZone: "Asia/Ho_Chi_Minh",
    }),
  }), env)!;
  expect(save.status).toBe(200);
  expect(await save.json()).toEqual({ selection: { dates: ["2026-10-03", "2026-12-05"], primary: "2026-10-03", timeZone: "Asia/Ho_Chi_Minh" } });

  const secondBrowser = await signedInBrowser(env, db, "account-1");
  const synced = await (await satDateRoute(request("/api/account/sat-dates", secondBrowser), env)!).json() as { selection: { dates: string[]; primary: string | null; timeZone: string | null } };
  expect(synced.selection).toEqual({ dates: ["2026-10-03", "2026-12-05"], primary: "2026-10-03", timeZone: "Asia/Ho_Chi_Minh" });

  const other = await signedInBrowser(env, db, "account-2");
  db.accounts.set("account-2", { time_zone: "" });
  const isolated = await (await satDateRoute(request("/api/account/sat-dates", other), env)!).json() as { selection: { dates: string[] } };
  expect(isolated.selection.dates).toEqual([]);

  const cleared = await satDateRoute(request("/api/account/sat-dates", first, {
    method: "POST", headers: mutationHeaders(first), body: JSON.stringify({ dates: [], primary: null, timeZone: "Asia/Ho_Chi_Minh" }),
  }), env)!;
  expect(cleared.status).toBe(200);
  const afterClear = await (await satDateRoute(request("/api/account/sat-dates", secondBrowser), env)!).json() as { selection: { dates: string[]; primary: string | null } };
  expect(afterClear.selection).toEqual({ dates: [], primary: null, timeZone: "Asia/Ho_Chi_Minh" });
});

it("guards the mutation with origin, CSRF, and strict selection validation", async () => {
  const { env, db } = environment();
  db.accounts.set("account-1", { time_zone: "" });
  const jar = await signedInBrowser(env, db, "account-1");
  const body = JSON.stringify({ dates: ["2026-10-03"], primary: "2026-10-03", timeZone: "Asia/Ho_Chi_Minh" });
  const post = { method: "POST", headers: mutationHeaders(jar), body };

  expect((await satDateRoute(request("/api/account/sat-dates", jar, { ...post, headers: { ...post.headers, Origin: "https://evil.test" } }), env))!.status).toBe(403);
  expect((await satDateRoute(request("/api/account/sat-dates", jar, { ...post, headers: { ...post.headers, "X-CSRF-Token": "f".repeat(64) } }), env))!.status).toBe(403);

  const rejects: [string, unknown][] = [
    ["primary outside the selection", { dates: ["2026-10-03"], primary: "2026-12-05", timeZone: "Asia/Ho_Chi_Minh" }],
    ["a date missing from the catalog", { dates: ["2026-10-04"], primary: null, timeZone: "Asia/Ho_Chi_Minh" }],
    ["a malformed date", { dates: ["October 3"], primary: null, timeZone: "Asia/Ho_Chi_Minh" }],
    ["an impossible calendar date", { dates: ["2026-02-30"], primary: null, timeZone: "Asia/Ho_Chi_Minh" }],
    ["a duplicated date", { dates: ["2026-10-03", "2026-10-03"], primary: null, timeZone: "Asia/Ho_Chi_Minh" }],
    ["an unknown time zone", { dates: ["2026-10-03"], primary: null, timeZone: "Mars/Olympus_Mons" }],
    ["a missing time zone", { dates: ["2026-10-03"], primary: null }],
    ["a non-array date list", { dates: "2026-10-03", primary: null, timeZone: "Asia/Ho_Chi_Minh" }],
    ["a stray field", { dates: ["2026-10-03"], primary: null, timeZone: "Asia/Ho_Chi_Minh", reminder: true }],
  ];
  for (const [label, payload] of rejects) {
    const response = await satDateRoute(request("/api/account/sat-dates", jar, {
      method: "POST", headers: mutationHeaders(jar), body: JSON.stringify(payload),
    }), env)!;
    expect(response.status, label).toBe(400);
    const error = (await response.json() as { error: { code: string } }).error;
    expect(error.code, label).toBe("invalid_sat_dates");
  }
  expect(db.selections.get("account-1")).toBeUndefined();
});

it("rejects an oversized body and unknown methods fall through as unavailability", async () => {
  const { env, db } = environment();
  db.accounts.set("account-1", { time_zone: "" });
  const jar = await signedInBrowser(env, db, "account-1");
  const oversized = await satDateRoute(request("/api/account/sat-dates", jar, {
    method: "POST", headers: mutationHeaders(jar), body: JSON.stringify({ dates: [], primary: null, timeZone: "Asia/Ho_Chi_Minh", pad: "x".repeat(2048) }),
  }), env)!;
  expect(oversized.status).toBe(413);
  expect(await satDateRoute(request("/api/account/sat-dates", jar, { method: "DELETE", headers: mutationHeaders(jar) }), env)).toBeNull();
});
