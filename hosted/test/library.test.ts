import { expect, it, vi } from "vitest";
import { libraryRoute } from "../src/library";
import worker from "../src/worker";

const cookie = `__Host-wb_session=${"a".repeat(64)}`;
const question = { version: 1, stimulus: [], stem: [{ kind: "text", text: "Find x." }],
  choices: ["A", "B", "C", "D"].map((id) => ({ id, content: [{ kind: "text", text: id }] })) };
const bytes = new TextEncoder().encode("image bytes");
const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");

function env(accountId = "learner", category: string | null = null) {
  const assetFetch = vi.fn(async () => new Response(bytes));
  return {
    APP_ORIGIN: "https://whitebook.test",
    ASSETS: { fetch: assetFetch }, assetFetch,
    DB: { async batch() { return []; }, prepare(sql: string) {
      let values: unknown[] = [];
      return {
        bind(...args: unknown[]) { values = args; return this; },
        async first<T>() {
          if (sql.includes("FROM learner_sessions")) return { account_id: accountId } as T;
          if (sql.includes("FROM package_revisions p WHERE p.id"))
            return values[0] === "reviewed-revision" || (values[0] === "private-revision" && values[1] === "owner") ? { id: values[0] } as T : null;
          if (sql.includes("FROM publication_questions")) return { question_id: "q1", ordinal: 1,
            section: "Reading and Writing", module: 1, question_number: 1,
            response_type: "multiple_choice", presentation_json: JSON.stringify(question) } as T;
          if (sql.includes("FROM publication_assets")) return values[0] === "/content/reviewed-revision/q1/image.png" ?
            { path: values[0], content_type: "image/png", sha256: hash, byte_size: bytes.byteLength } as T : null;
          throw new Error(sql);
        },
        async all() {
          if (sql.includes("FROM package_revisions p WHERE")) return { results: [{ id: "reviewed-revision", family_id: "family",
            title: "August R&W", source_revision: 5, published_revision: 6, question_count: 1 }], meta: { rows_read: 1, rows_written: 0 } };
          if (sql.includes("FROM publication_questions")) return { results: [{ question_id: "q1", ordinal: 1,
            section: "Reading and Writing", module: 1, question_number: 1, category }], meta: { rows_read: 1, rows_written: 0 } };
          throw new Error(sql);
        },
        async run() { return { success: true, meta: { rows_read: 0, rows_written: 0 } }; },
      };
    } },
  };
}

function request(path: string, signedIn = true) {
  return new Request(`https://whitebook.test${path}`, { headers: signedIn ? { Cookie: cookie } : {} });
}

it("requires an account and entitlement for questions and manifest-listed visuals", async () => {
  const environment = env();
  expect((await libraryRoute(request("/api/library", false), environment))?.status).toBe(401);
  expect((await libraryRoute(request("/api/library/private-revision/questions/q1"), environment))?.status).toBe(404);
  expect((await libraryRoute(request("/api/library/private-revision/questions/q1"), env("owner")))?.status).toBe(200);
  const listing = await libraryRoute(request("/api/library"), environment);
  expect(await listing?.json()).toMatchObject({ packages: [{ revisionId: "reviewed-revision" }] });
  const response = await libraryRoute(request("/api/library/reviewed-revision/questions/q1"), environment);
  const text = await response?.text();
  expect(response?.status).toBe(200);
  expect(text).toContain("Find x.");
  expect(text).not.toMatch(/accepted|sourcePdf|\.pdf|[A-Za-z]:\\/i);
  expect((await libraryRoute(request("/content/reviewed-revision/q1/missing.png"), environment))?.status).toBe(404);
  expect(environment.assetFetch).not.toHaveBeenCalled();
  const visual = await libraryRoute(request("/content/reviewed-revision/q1/image.png"), environment);
  expect(visual?.status).toBe(200);
  expect(visual?.headers.get("cache-control")).toBe("private, no-store");
  expect(environment.assetFetch).toHaveBeenCalledTimes(1);
  environment.assetFetch.mockImplementationOnce(async () => new Response("wrong bytes"));
  expect((await libraryRoute(request("/content/reviewed-revision/q1/image.png"), environment))?.status).toBe(503);
});

it("lists only published category metadata for an entitled revision", async () => {
  const categorized = await libraryRoute(request("/api/library/reviewed-revision/questions"), env("learner", "Grammar"));
  expect(await categorized?.json()).toMatchObject({ questions: [{ questionId: "q1", category: "Grammar" }] });
  const legacy = await libraryRoute(request("/api/library/reviewed-revision/questions"), env());
  expect(await legacy?.json()).toMatchObject({ questions: [{ questionId: "q1", category: null }] });
  expect((await libraryRoute(request("/api/library/private-revision/questions"), env()))?.status).toBe(404);
});

it("keeps content paths behind the Worker on direct requests", async () => {
  const environment = env();
  const direct = await worker.fetch(request("/content/reviewed-revision/q1/image.png", false), environment as never);
  expect(direct.status).toBe(401);
  const pdf = await worker.fetch(request("/content/reviewed-revision/q1/source.pdf"), environment as never);
  expect(pdf.status).toBe(404);
  expect(environment.assetFetch).not.toHaveBeenCalled();
});
