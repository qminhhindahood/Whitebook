import { afterAll, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/worker";

const origin = "https://whitebook.test";
const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "reminders-test" } }));
afterAll(async () => { await mf.dispose(); });

async function digest(value: string) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), n => n.toString(16).padStart(2, "0")).join("");
}

function request(owner: string, path: string, method = "GET", body?: unknown, validCsrf = true) {
  const token = owner.repeat(64);
  return new Request(origin + path, { method, headers: {
    Cookie: `__Host-wb_session=${token}`,
    ...(method === "POST" ? { Origin: origin, "X-CSRF-Token": validCsrf ? owner.repeat(64) : "0".repeat(64), "Content-Type": "application/json" } : {}),
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}

it("evaluates reminders on the server and persists idempotent account-scoped dismissal", async () => {
  const db = await mf.getD1Database("DB");
  const migrationDir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(migrationDir).filter(name => name.endsWith(".sql")).sort())
    await db.exec(readFileSync(new URL(file, migrationDir), "utf8").replace(/--[^\r\n]*/g, "").replace(/\r?\n/g, " "));
  for (const owner of ["a", "b"]) {
    await db.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, created_at) VALUES (?, 'google', ?, ?, ?, 1)")
      .bind(owner, `sub-${owner}`, `${owner}@test.invalid`, owner).run();
    await db.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, ?, ?, 9999999999, 1)")
      .bind(await digest(owner.repeat(64)), owner, await digest(owner.repeat(64))).run();
  }
  const env = { DB: db, APP_ORIGIN: origin } as never;
  async function keys(owner: string) {
    const response = await worker.fetch(request(owner, "/api/reminders"), env);
    expect(response.status).toBe(200);
    return (await response.json() as { reminders: { key: string }[] }).reminders.map(item => item.key);
  }

  expect(await keys("a")).toEqual(["primary_sat_date", "personal_gemini_key"]);
  expect(await keys("b")).toEqual(["primary_sat_date", "personal_gemini_key"]);
  expect((await worker.fetch(request("a", "/api/reminders/dismiss", "POST", { key: "personal_gemini_key" }, false), env)).status).toBe(403);
  expect((await worker.fetch(request("a", "/api/reminders/dismiss", "POST", { key: "unknown" }), env)).status).toBe(400);
  for (let repeat = 0; repeat < 2; repeat++)
    expect((await worker.fetch(request("a", "/api/reminders/dismiss", "POST", { key: "personal_gemini_key" }), env)).status).toBe(204);
  expect(await keys("a")).toEqual(["primary_sat_date"]);
  expect(await keys("b")).toEqual(["primary_sat_date", "personal_gemini_key"]);
  await db.prepare("INSERT INTO learner_sat_dates (account_id, test_date, is_primary, selected_at) VALUES ('a', '2026-10-03', 1, 1)").run();
  expect(await keys("a")).toEqual([]);
});
