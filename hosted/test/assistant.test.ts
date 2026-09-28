import { afterEach, expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { assistantRoute, type AssistantEnv } from "../src/assistant";
import type { AccountEnv } from "../src/accounts";
import { accountDataRoute } from "../src/accountData";
import { accountRoute } from "../src/accounts";
import worker from "../src/worker";
import { GeminiFailure } from "../src/gemini";

const origin = "https://whitebook.example.test";
const digest = async (s: string) => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))).toString("hex");
const databases: DatabaseSync[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });

async function fixture() {
  const db = new DatabaseSync(":memory:"); databases.push(db);
  for (const name of readdirSync(new URL("../migrations/", import.meta.url)).sort())
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const DB: AccountEnv["DB"] = {
    prepare(sql) {
      let args: any[] = [];
      return {
        bind(...values) { args = values; return this; },
        async first<T>() { return (db.prepare(sql).get(...args) ?? null) as T | null; },
        async all() { return { results: db.prepare(sql).all(...args), meta: { rows_read: 0, rows_written: 0 } }; },
        async run() { const r = db.prepare(sql).run(...args); return { success: true, meta: { changes: Number(r.changes), rows_read: 0, rows_written: Number(r.changes) } }; },
      };
    },
    async batch(statements) {
      db.exec("BEGIN");
      try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec("COMMIT"); return results; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  for (const id of ["a", "b"]) {
    db.prepare("INSERT INTO learner_accounts (id,provider,provider_subject,email,display_name,created_at) VALUES (?, 'google', ?, ?, 'Private Name', 0)").run(id, id, `${id}@private.invalid`);
    db.prepare("INSERT INTO learner_sessions VALUES (?, ?, ?, ?, 0)").run(await digest(id.repeat(64)), id, await digest("c".repeat(64)), 9_999_999_999);
  }
  let clock = Date.now();
  const option = { route: "shared_gemini", model: "gemini-test", payer: "Shared AI Access", price: "USD 0 test fixture", terms: "Test terms", termsUrl: "https://ai.google.dev/gemini-api/terms", termsVersion: "test-1", languages: ["en", "vi"], vision: false, quota: "Test project allowance", healthy: true };
  const env: AssistantEnv = { DB, APP_ORIGIN: origin, AI_RELEASE_ENABLED: "true", ASSISTANT_KEY_KEK: "a".repeat(64), ASSISTANT_SNAPSHOT_KEY: "b".repeat(64), GEMINI_SHARED_KEY: "test-shared-credential", ASSISTANT_CATALOG: JSON.stringify({ reviewedUntil: clock + 86400000, audienceEligibility: "signed_in_adults_18_plus", providerEligibility: "approved", eligibilityEvidence: "test-only", failureCheckEvidence: "test-only", options: [option, { ...option, route: "personal_gemini", payer: "Your Gemini project" }] }) };
  const adapter = vi.fn(async (_payload: string, _model: string, _key: string) => "Fixture response");
  const call = (path: string, body?: unknown, account = "a") => assistantRoute(new Request(origin + "/api/assistant/" + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: `__Host-wb_session=${account.repeat(64)}`, Origin: origin, "X-CSRF-Token": "c".repeat(64), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, adapter, () => clock)!;
  const input = { visitId: crypto.randomUUID(), route: "shared_gemini", model: "gemini-test", locale: "en", currentMessage: "Explain linear functions", priorMessages: [] };
  const preview = async (overrides = {}) => { const response = await call("preview", { ...input, ...overrides }); expect(response.status).toBe(200); return response.json(); };
  return { db, env, adapter, call, input, preview, advance: (ms: number) => { clock += ms; } };
}

it("consumes the exact private-data-free preview once, bound to the signed-in visit", async () => {
  const f = await fixture();
  const p = await f.preview();
  expect(p.payload).toContain("Explain linear functions");
  expect(p.payload).not.toMatch(/private.invalid|Private Name|account|credential|score|deck/i);
  expect(await f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true }, "b").then(r => r.status)).toBe(409);
  const sent = await f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true });
  expect(sent.status).toBe(200);
  expect(f.adapter).toHaveBeenCalledWith(p.payload, "gemini-test", "test-shared-credential");
  expect(await f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true }).then(r => r.status)).toBe(409);
  expect(f.adapter).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.db.prepare("SELECT * FROM assistant_previews").all())).not.toContain("Explain linear functions");
});

it("keeps the staging Worker closed without touching authentication, Gemini, or D1", async () => {
  const response = await worker.fetch(new Request(origin + "/api/assistant/preview", { method: "POST" }), { AI_RELEASE_ENABLED: "false", DB: { prepare() { throw new Error("Must not touch D1"); } } } as any);
  expect(response.status).toBe(404);
  expect(await response.json()).toMatchObject({ error: { code: "ai_disabled" } });
});

it("requires new consent for changed text, visit, model, payer, terms, price, credentials, or expiry", async () => {
  const f = await fixture();
  const p = await f.preview();
  const send = { previewId: p.previewId, visitId: f.input.visitId, consent: true };
  for (const extra of [{ currentMessage: "substitute" }, { credentialId: "other" }, { account: "b" }, { consent: false }, { visitId: crypto.randomUUID() }])
    expect((await f.call("send", { ...send, ...extra })).status).toBe(409);
  const original = f.env.ASSISTANT_CATALOG!;
  for (const field of ["model", "payer", "terms", "price", "termsVersion"]) {
    const catalog = JSON.parse(original); catalog.options[0][field] += "-changed"; f.env.ASSISTANT_CATALOG = JSON.stringify(catalog);
    expect((await f.call("send", send)).status).toBe(409);
  }
  f.env.ASSISTANT_CATALOG = original;
  f.env.GEMINI_SHARED_KEY = "rotated-shared-key";
  expect((await f.call("send", send)).status).toBe(409);
  f.env.GEMINI_SHARED_KEY = "test-shared-credential";
  f.advance(300001);
  expect((await f.call("send", send)).status).toBe(409);
  expect(f.adapter).not.toHaveBeenCalled();
});

it("rejects client evidence, attachments, non-Gemini routes and known credentials; caps the exact prior turns", async () => {
  const f = await fixture();
  for (const extra of [{ account: { email: "private" } }, { acceptedAnswer: "C" }, { attachment: "review" }, { credentialId: "key" }, { route: "openrouter" }, { currentMessage: "test-shared-credential" }, { currentMessage: "AIza" + "x".repeat(35) }])
    expect((await f.call("preview", { ...f.input, ...extra })).status).toBe(400);
  const p = await f.preview({ locale: "vi", priorMessages: Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "assistant" : "learner", text: `Turn ${i}` })) });
  const payload = JSON.parse(p.payload);
  expect(payload.contents).toHaveLength(9);
  expect(payload.contents[0].parts[0].text).toBe("Turn 4");
  expect(payload.systemInstruction.parts[0].text).toContain("Vietnamese");
  expect(payload).not.toHaveProperty("tools");
  const huge = await f.preview({ priorMessages: Array.from({ length: 8 }, () => ({ role: "learner", text: "x".repeat(8000) })) });
  expect(new TextEncoder().encode(huge.payload).length).toBeLessThanOrEqual(16000);
  expect((await f.call("preview", { ...f.input, currentMessage: "x".repeat(4001) })).status).toBe(400);
});

it("encrypts personal credentials, redacts reads and export, and revokes old previews on key replacement", async () => {
  const f = await fixture();
  const secret = "personal-test-credential-12345";
  const saved = await f.call("credential", { key: secret });
  expect(await saved.json()).toEqual({ lastFour: "2345" });
  expect(JSON.stringify(f.db.prepare("SELECT * FROM assistant_credentials").all())).not.toContain(secret);
  expect(JSON.stringify(await f.call("options").then(r => r.json()))).not.toMatch(/ciphertext|version|personal-test-credential/);
  const p = await f.preview({ route: "personal_gemini" });
  expect(p.payload).not.toContain(secret);
  expect((await f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true })).status).toBe(200);
  expect(f.adapter).toHaveBeenCalledWith(p.payload, "gemini-test", secret);
  const stale = await f.preview({ route: "personal_gemini" });
  await f.call("credential", { key: "replacement-personal-credential" });
  expect((await f.call("send", { previewId: stale.previewId, visitId: f.input.visitId, consent: true })).status).toBe(409);
  const exported = await accountDataRoute(new Request(origin + "/api/account/export", { headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}` } }), f.env)!;
  expect(await exported.text()).not.toMatch(/assistant|credential|ciphertext|Explain linear/);
  await f.call("credential/remove", {});
  expect((await f.call("options").then(r => r.json())).credential).toBeNull();
});

it("atomically consumes competing sends, throttles per account, and isolates shared quota", async () => {
  const f = await fixture(); const p = await f.preview();
  const sends = await Promise.all([1, 2].map(() => f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true })));
  expect(sends.map(r => r.status).sort()).toEqual([200, 409]);
  const window = Math.floor(Date.now() / 3600000) * 3600000;
  f.db.prepare("UPDATE assistant_limits SET requests = 20 WHERE scope = 'send:a'").run();
  const throttled = await f.preview();
  const r = await f.call("send", { previewId: throttled.previewId, visitId: f.input.visitId, consent: true });
  expect(r.status).toBe(429); expect(Number(r.headers.get("Retry-After"))).toBeGreaterThan(0);
  expect((await r.json()).error.retryAt).toBeGreaterThan(Date.now());
  const other = await f.call("preview", f.input, "b").then(r => r.json());
  expect((await f.call("send", { previewId: other.previewId, visitId: f.input.visitId, consent: true }, "b")).status).toBe(200);
  f.db.prepare("UPDATE assistant_limits SET requests = 100 WHERE scope = 'shared' AND window_ms = ?").run(window);
  const shared = await f.call("preview", f.input, "b").then(r => r.json());
  expect((await f.call("send", { previewId: shared.previewId, visitId: f.input.visitId, consent: true }, "b")).status).toBe(429);
  await f.call("credential", { key: "personal-test-credential-12345" }, "b");
  const personal = await f.call("preview", { ...f.input, route: "personal_gemini" }, "b").then(r => r.json());
  expect((await f.call("send", { previewId: personal.previewId, visitId: f.input.visitId, consent: true }, "b")).status).toBe(200);
});

it("does not retry or switch provider on failure and opens the shared circuit breaker", async () => {
  const f = await fixture();
  f.adapter.mockRejectedValueOnce(new GeminiFailure("quota_exhausted", 60));
  const p = await f.preview();
  const failed = await f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true });
  expect((await failed.json()).error.code).toBe("quota_exhausted");
  const next = await f.preview();
  expect((await f.call("send", { previewId: next.previewId, visitId: f.input.visitId, consent: true })).status).toBe(429);
  expect(f.adapter).toHaveBeenCalledTimes(1);
});

it("invalidates previews on sign-out and removes secrets and ephemeral artifacts on account deletion", async () => {
  const f = await fixture(); const p = await f.preview();
  const request = (path: string, body?: unknown) => new Request(origin + path, { method: "POST", headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}`, Origin: origin, "X-CSRF-Token": "c".repeat(64), "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  expect((await accountRoute(request("/api/auth/signout"), f.env)!).status).toBe(204);
  expect((await f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true })).status).toBe(401);
  expect(f.db.prepare("SELECT * FROM assistant_previews").all()).toHaveLength(0);
  f.db.prepare("INSERT INTO learner_sessions VALUES (?, 'a', ?, 9999999999, 0)").run(await digest("a".repeat(64)), await digest("c".repeat(64)));
  await f.call("credential", { key: "personal-test-credential-12345" }); await f.preview();
  expect((await accountDataRoute(request("/api/account/delete", { confirmation: "DELETE MY ACCOUNT" }), f.env)!).status).toBe(204);
  expect(f.db.prepare("SELECT * FROM assistant_credentials").all()).toHaveLength(0);
  expect(f.db.prepare("SELECT * FROM assistant_previews").all()).toHaveLength(0);
  expect(f.db.prepare("SELECT * FROM assistant_limits WHERE scope LIKE '%:a'").all()).toHaveLength(0);
});

it("denies active assessments at preview and send while Attempt saves ignore the AI breaker", async () => {
  const f = await fixture(); const p = await f.preview();
  f.db.prepare("INSERT INTO package_revisions VALUES ('rev', 'family', 'Fixture', 1, 1, 'hash', 1)").run();
  const id = crypto.randomUUID(); const token = "d".repeat(64);
  f.db.prepare("INSERT INTO learner_attempts (id,account_id,revision_id,kind,status,config_json,questions_json,state_json,created_at_ms,started_at_ms,editor_token_hash,editor_lease_expires_at_ms) VALUES (?, 'a','rev','section_exam','active',?,?,?,0,0,?,?)")
    .run(id, JSON.stringify({ section: "Math", modules: [1], timing: { mode: "elapsed" } }), JSON.stringify([{ questionId: "q", module: 1, responseType: "multiple_choice", choiceIds: ["A", "B"] }]), JSON.stringify({ phase: "module", activeModule: 1, currentQuestionId: "q", responses: {}, markedQuestionIds: [], eliminatedChoices: {}, questionElapsedMs: {} }), await digest(token), Date.now() + 600000);
  expect((await f.call("options")).status).toBe(409);
  expect((await f.call("preview", f.input).then(r => r.json())).error.code).toBe("active_section_exam");
  expect((await f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true }).then(r => r.json())).error.code).toBe("active_section_exam");
  f.db.prepare("UPDATE learner_attempts SET kind = 'practice'").run();
  expect((await f.call("preview", f.input).then(r => r.json())).error.code).toBe("assisted_practice_required");
  f.db.prepare("INSERT INTO assistant_limits VALUES ('shared', ?, 100, 400000)").run(Math.floor(Date.now() / 3600000) * 3600000);
  const saved = await worker.fetch(new Request(origin + `/api/attempts/${id}/write`, { method: "POST", headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}`, Origin: origin, "X-CSRF-Token": "c".repeat(64), "Content-Type": "application/json" }, body: JSON.stringify({ editorToken: token, expectedStateVersion: 0, change: { type: "response", questionId: "q", response: "B" } }) }), f.env as any);
  expect(saved.status).toBe(200);
  expect(await saved.json()).toMatchObject({ saveStatus: "saved", state: { responses: { q: "B" } } });
  expect(f.adapter).not.toHaveBeenCalled();
});

it("fails closed on expired eligibility, unavailable capability, missing authentication, CSRF, and tampered snapshots", async () => {
  const f = await fixture();
  expect((await f.call("preview", f.input, "z")).status).toBe(401);
  const p = await f.preview();
  expect((await f.call("send", { previewId: p.previewId.slice(0, -2) + "00", visitId: f.input.visitId, consent: true })).status).toBe(409);
  const noCsrf = new Request(origin + "/api/assistant/preview", { method: "POST", headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}`, Origin: origin }, body: JSON.stringify(f.input) });
  expect((await assistantRoute(noCsrf, f.env, f.adapter)!).status).toBe(403);
  const c = JSON.parse(f.env.ASSISTANT_CATALOG!); c.options[0].languages = ["en"]; f.env.ASSISTANT_CATALOG = JSON.stringify(c);
  expect((await f.call("preview", { ...f.input, locale: "vi" }).then(r => r.json())).error.code).toBe("capability_missing");
  f.advance(86400001);
  expect((await f.call("options").then(r => r.json())).error.code).toBe("eligibility_required");
  expect(f.adapter).not.toHaveBeenCalled();
});

it("enforces preview and token budgets independently, with bounded retry timing", async () => {
  const f = await fixture(); const p = await f.preview();
  const window = Math.floor(Date.now() / 3600000) * 3600000;
  f.db.prepare("INSERT INTO assistant_limits VALUES ('send:a', ?, 1, 80000)").run(window);
  expect((await f.call("send", { previewId: p.previewId, visitId: f.input.visitId, consent: true }).then(r => r.json())).error.code).toBe("rate_limited");
  f.db.prepare("UPDATE assistant_limits SET requests = 60 WHERE scope = 'preview:a'").run();
  expect((await f.call("preview", f.input)).status).toBe(429);
  f.advance(3600000);
  expect((await f.call("preview", f.input)).status).toBe(200);
});

it("returns generic JSON from the Worker for assistant storage errors without logging secrets", async () => {
  const logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const f = await fixture();
  f.env.DB.prepare = () => { throw new Error("SECRET DATABASE ERROR"); };
  const response = await worker.fetch(new Request(origin + "/api/assistant/options", { headers: { Cookie: `__Host-wb_session=${"a".repeat(64)}` } }), f.env as any);
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("SECRET");
  expect(logged).not.toHaveBeenCalled();
});
