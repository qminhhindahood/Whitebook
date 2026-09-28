// Local-only signed-in browser rehearsal. Synthetic account + injected reply;
// the production assistant API, encryption, consent and SQLite schema run unchanged.
// No real sign-in, credential, learner data, or provider call. Never deploy this file.
import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync, mkdirSync, unlinkSync, rmdirSync } from "node:fs";
import { build } from "esbuild";
import { createServer } from "../../web/node_modules/vite/dist/node/index.js";
import react from "../../web/node_modules/@vitejs/plugin-react/dist/index.js";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../web/", import.meta.url));
const port = Number(process.env.TUTOR_REHEARSAL_PORT ?? 8788);
const origin = `http://localhost:${port}`;
const scratch = new URL("../.scratch/", import.meta.url); mkdirSync(scratch, { recursive: true });
const output = new URL("tutor-rehearsal-api.mjs", scratch);
await build({ entryPoints: [fileURLToPath(new URL("../src/assistant.ts", import.meta.url))], outfile: fileURLToPath(output), bundle: true, platform: "node", format: "esm" });
const { assistantRoute } = await import(output.href);
const sqlite = new DatabaseSync(":memory:");
for (const name of readdirSync(new URL("../migrations/", import.meta.url)).sort()) sqlite.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
const hash = async text => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))).toString("hex");
sqlite.prepare("INSERT INTO learner_accounts (id,provider,provider_subject,email,display_name,created_at) VALUES ('fixture','google','fixture','fixture@example.invalid','Rehearsal Learner',0)").run();
sqlite.prepare("INSERT INTO learner_sessions VALUES (?, 'fixture', ?, 9999999999, 0)").run(await hash("a".repeat(64)), await hash("c".repeat(64)));
const DB = {
  prepare(sql) {
    let args = [];
    return {
      bind(...values) { args = values; return this; },
      async first() { return sqlite.prepare(sql).get(...args) ?? null; },
      async all() { return { results: sqlite.prepare(sql).all(...args), meta: {} }; },
      async run() { const result = sqlite.prepare(sql).run(...args); return { success: true, meta: { changes: Number(result.changes) } }; },
    };
  },
};
const provider = { route: "shared_gemini", model: "gemini-fixture", payer: "Shared AI Access (fixture)", price: "No charge — local fixture", terms: "Synthetic rehearsal only. No text leaves this computer.", termsUrl: "https://ai.google.dev/gemini-api/terms", termsVersion: "fixture", languages: ["en", "vi"], vision: false, quota: "Local fixture; 20 sends/hour", healthy: true };
const env = { DB, APP_ORIGIN: origin, AI_RELEASE_ENABLED: "true", ASSISTANT_KEY_KEK: "a".repeat(64), ASSISTANT_SNAPSHOT_KEY: "b".repeat(64), GEMINI_SHARED_KEY: "local-fixture-key",
  ASSISTANT_CATALOG: JSON.stringify({ reviewedUntil: Date.now() + 3600000, audienceEligibility: "signed_in_adults_18_plus", providerEligibility: "approved", eligibilityEvidence: "local fixture only", failureCheckEvidence: "local fixture only", options: [provider, { ...provider, route: "personal_gemini", payer: "Personal project (fixture)" }] }) };
const server = await createServer({ root, configFile: false, define: { "import.meta.env.VITE_AI_RELEASE_ENABLED": JSON.stringify("true") }, plugins: [react(), {
  name: "local-tutor-rehearsal",
  configureServer(vite) { vite.middlewares.use(async (req, res, next) => {
    if (!req.url?.startsWith("/api/")) return next();
    try {
      let result;
      if (req.url === "/api/account/me") {
        result = Response.json({ account: { id: "fixture", email: "fixture@example.invalid", displayName: "Rehearsal Learner", nickname: "", timeZone: "", role: "learner" }, session: { expiresAt: 9999999999 } });
        res.setHeader("Set-Cookie", `__Host-wb_csrf=${"c".repeat(64)}; Path=/; Secure; SameSite=Lax`);
      } else if (req.url === "/api/account/sat-dates") result = Response.json({ catalog: { dates: [] }, selection: { dates: [], primary: null } });
      else if (req.url === "/api/account/scores") result = Response.json({ results: [] });
      else if (req.url === "/api/auth/signout") { sqlite.prepare("DELETE FROM learner_sessions").run(); result = new Response(null, { status: 204 }); }
      else {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
        headers.set("Cookie", `__Host-wb_session=${"a".repeat(64)}`);
        result = await assistantRoute(new Request(origin + req.url, { method: req.method, headers, ...(req.method === "POST" ? { body: Buffer.concat(chunks) } : {}) }), env,
          async payload => JSON.parse(payload).systemInstruction.parts[0].text.includes("Vietnamese") ? "Phản hồi thử nghiệm: hãy so sánh độ dốc và giao điểm." : "Fixture reply: compare the slope and the intercept. This is synthetic rehearsal text.");
      }
      if (!result) result = new Response(null, { status: 404 });
      res.statusCode = result.status; result.headers.forEach((value, name) => res.setHeader(name, value)); res.end(Buffer.from(await result.arrayBuffer()));
    } catch { res.statusCode = 500; res.end('Fixture unavailable'); }
  }); },
}], server: { host: "127.0.0.1", port, strictPort: true } });
await server.listen();
console.log(`Synthetic Tutor Chat rehearsal: ${origin}/app.html`);
const close = async () => {
  await server.close(); sqlite.close();
  try { unlinkSync(fileURLToPath(output)); } catch {}
  try { rmdirSync(fileURLToPath(scratch)); } catch {}
  process.exit(0);
};
process.on("SIGINT", close); process.on("SIGTERM", close);
