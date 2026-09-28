import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { geminiAdapter } from "../src/gemini";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const payload = '{"contents":[{"role":"user","parts":[{"text":"Synthetic transport check"}]}],"generationConfig":{"maxOutputTokens":8}}';

it("uses the real HTTP adapter with exactly the preview body and a header-only credential", async () => {
  const nativeFetch = globalThis.fetch;
  let received = ""; let header = "";
  const server = createServer((req, res) => {
    header = String(req.headers["x-goog-api-key"]);
    req.on("data", chunk => { received += chunk; });
    req.on("end", () => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "Fixture reply" }] } }] })); });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  vi.stubGlobal("fetch", vi.fn((url: string, init: RequestInit) => {
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent");
    expect(init.redirect).toBe("error");
    return nativeFetch(`http://127.0.0.1:${address.port}`, init);
  }));
  try {
    expect(await geminiAdapter(payload, "gemini-test", "synthetic-key")).toBe("Fixture reply");
    expect(received).toBe(payload); expect(received).not.toContain("synthetic-key"); expect(header).toBe("synthetic-key");
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

it.each([[429, "quota_exhausted"], [401, "credential_invalid"], [403, "credential_invalid"], [404, "model_unavailable"], [500, "provider_error"]])("sanitizes HTTP %s without a retry or provider switch", async (status, code) => {
  const fetch = vi.fn(async () => new Response("SECRET UPSTREAM BODY", { status: Number(status), headers: { "Retry-After": "17" } })); vi.stubGlobal("fetch", fetch);
  await expect(geminiAdapter(payload, "gemini-test", "synthetic-key")).rejects.toMatchObject({ code });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  [{ promptFeedback: { blockReason: "SAFETY" } }, "blocked_content"],
  [{ candidates: [{ finishReason: "SAFETY" }] }, "blocked_content"],
  [{ candidates: [] }, "provider_error"],
  [{ candidates: [{ finishReason: "STOP", content: { parts: [{ text: "synthetic-key" }] } }] }, "blocked_content"],
])("withholds blocked or invalid model responses", async (data, code) => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(data)));
  await expect(geminiAdapter(payload, "gemini-test", "synthetic-key")).rejects.toMatchObject({ code });
});

it("aborts a slow provider at the deadline and exposes only a timeout state", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("SECRET NETWORK ERROR"))))));
  const result = expect(geminiAdapter(payload, "gemini-test", "synthetic-key")).rejects.toMatchObject({ code: "timeout", retrySeconds: 5 });
  await vi.advanceTimersByTimeAsync(20000); await result;
});

// Explicit opt-in only. Intentionally invalid key, synthetic text, no learner data,
// no real secret, no successful generation or billing. This is not release approval.
it.skipIf(process.env.WHITEBOOK_GEMINI_FAILURE_CHECK !== "1")("controlled live Gemini rejection through the real adapter", async () => {
  await expect(geminiAdapter(payload, "gemini-intentionally-unavailable", "whitebook-intentionally-invalid-key")).rejects.toMatchObject({ code: "provider_error" });
}, 30000);
