import { afterAll, beforeAll, expect, it } from "vitest";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import worker from "../src/worker";

const mf = new Miniflare(convertV4MiniflareOptions({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: { DB: "bank-test" } }));
let db: Awaited<ReturnType<typeof mf.getD1Database>>;
const token = "a".repeat(64);
const presentation = (passage: string, visual = false) => ({ version: 1,
  stimulus: passage ? [{ kind: "text", text: passage }] : [],
  stem: [{ kind: "text", text: "Prompt-only secret" }, ...(visual ? [{ kind: "asset", src: "/content/new/q2/figure.png", alt: "figure-only secret" }] : [])],
  choices: ["A", "B"].map(id => ({ id, content: [{ kind: "text", text: `Choice-only secret ${id}` }] })) });
beforeAll(async () => {
  db = await mf.getD1Database("DB");
  const dir = new URL("../migrations/", import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith(".sql")).sort())
    await db.exec(readFileSync(new URL(file, dir), "utf8").replace(/--[^\r\n]*/g, "").replace(/\r?\n/g, " "));
  await db.exec("INSERT INTO learner_accounts (id,provider,provider_subject,email,display_name,created_at) VALUES ('learner','google','test','test@example.invalid','Test',1)");
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), b => b.toString(16).padStart(2, "0")).join("");
  await db.prepare("INSERT INTO learner_sessions VALUES (?, 'learner', 'csrf', 9999999999, 1)").bind(hash).run();
  for (const [id, family, version] of [["old", "rw", 1], ["new", "rw", 2], ["private", "private", 1]] as const) {
    await db.prepare("INSERT INTO package_revisions VALUES (?, ?, ?, 1, ?, 'hash', 3)").bind(id, family, `${family} bank`, version).run();
    await db.prepare("INSERT INTO publication_releases VALUES (?, 'hash', 1)").bind(id).run();
    await db.prepare("INSERT INTO publication_release_revisions VALUES (?, ?)").bind(id, id).run();
  }
  await db.exec("INSERT INTO active_publication VALUES (1,'old'); UPDATE active_publication SET release_id='new'; INSERT INTO private_revision_entitlements VALUES ('learner','old')");
  for (const revision of ["old", "new", "private"]) {
    for (const [id, number, passage, section, type, category, visual] of [
      ["q1", 1, "The   RIVER\nflows past a riverside village.", "Reading and Writing", "multiple_choice", "Vocabulary", false],
      ["q2", 2, "", "Math", "student_produced_response", "Algebra", true],
      ["q3", 3, "A bird flies over the valley.", "Reading and Writing", "multiple_choice", "Grammar", false],
    ] as const) {
      await db.prepare("INSERT INTO publication_questions VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)")
        .bind(revision, id, `source-${id}`, number, section, number, type, JSON.stringify(presentation(passage, visual))).run();
      await db.prepare("INSERT INTO publication_question_categories VALUES (?, ?, ?)").bind(revision, id, category).run();
      if (id !== "q3") await db.prepare("INSERT INTO publication_answers VALUES (?, ?, ?)").bind(revision, id, JSON.stringify(id === "q1" ? ["B"] : ["2", "2.0"])).run();
    }
  }
}, 60000);
afterAll(async () => { await mf.dispose(); });
async function call(path: string, signedIn = true) {
  return (await worker.fetch(new Request(`https://whitebook.test${path}`, { headers: signedIn ? { Cookie: `__Host-wb_session=${token}` } : {} }),
    { DB: db, APP_ORIGIN: "https://whitebook.test", ASSETS: { fetch: async () => new Response(null, { status: 404 }) } } as never))!;
}

it("searches only entitled current passages with normalized phrases and whole words", async () => {
  expect((await call("/api/library/search?q=river", false)).status).toBe(401);
  const response = await call("/api/library/search?q=%20RIVER%20%20flows%20");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ total: 1, questions: [{ revisionId: "new", questionId: "q1", snippet: "The RIVER flows past a riverside village." }] });
  for (const q of ["prompt-only", "choice-only", "figure-only", "rive", "2.0"])
    expect(await (await call(`/api/library/search?q=${q}`)).json()).toMatchObject({ total: 0 });
  expect(await (await call("/api/library/search?bank=private")).json()).toMatchObject({ total: 0 });
  expect(await (await call("/api/library")).json()).toMatchObject({ packages: [{ revisionId: "new" }] });
  expect((await call("/api/library/old/questions/q1")).status).toBe(200);
  const payload = await (await call("/api/library/search")).text();
  expect(payload).not.toMatch(/acceptedAnswers|presentation|Choice-only|sourcePdf/);
});

it("combines browse filters, paginates deterministically, and reveals keys only on the separate entitled operation", async () => {
  expect(await (await call("/api/library/search?bank=new&section=Math&category=Algebra&responseType=student_produced_response&visual=yes&number=2")).json())
    .toMatchObject({ total: 1, questions: [{ questionId: "q2", hasVisual: true, snippet: "" }] });
  expect(await (await call("/api/library/search?visual=no&offset=1")).json()).toMatchObject({ total: 2, questions: [{ questionId: "q3" }] });
  expect((await call("/api/library/search?offset=-1")).status).toBe(400);
  expect((await call("/api/library/private/questions/q1/answer")).status).toBe(404);
  expect((await call("/api/library/new/questions/q1/answer", false)).status).toBe(401);
  expect(await (await call("/api/library/new/questions/q1/answer")).json()).toEqual({ responseType: "multiple_choice", choices: [{ id: "B", content: [{ kind: "text", text: "Choice-only secret B" }] }] });
  expect(await (await call("/api/library/new/questions/q2/answer")).json()).toEqual({ responseType: "student_produced_response", acceptedAnswers: ["2", "2.0"] });
  expect(await (await call("/api/library/new/questions/q3/answer")).json()).toMatchObject({ error: { code: "answer_unavailable" } });
  expect((await (await call("/api/library/new/questions/q1")).text())).not.toMatch(/accepted|correctAnswer/);
});

it("searches explicitly reviewed fallback passage transcription without indexing image labels", async () => {
  await db.prepare("INSERT INTO publication_passage_search VALUES ('new','q3',?)").bind("Reviewed transcription of an image passage.").run();
  expect(await (await call("/api/library/search?q=transcription%20of%20an%20image")).json()).toMatchObject({ total: 1, questions: [{ questionId: "q3" }] });
  expect(await (await call("/api/library/search?q=figure-only")).json()).toMatchObject({ total: 0 });
});

it("keeps missing reviewed choice content unavailable and creates no Attempts during browsing or reveal", async () => {
  expect(await (await call("/api/attempts")).json()).toMatchObject({ attempts: [] });
  await db.prepare("INSERT INTO publication_answers VALUES ('new','q3','[\"B\"]')").run();
  const fallback = { version: 1, stimulus: [], stem: [{ kind: "text", text: "Fallback question" }], choices: [{ id: "B", content: [] }] };
  await db.prepare("UPDATE publication_questions SET presentation_json=? WHERE revision_id='new' AND question_id='q3'").bind(JSON.stringify(fallback)).run();
  expect(await (await call("/api/library/new/questions/q3/answer")).json()).toMatchObject({ error: { code: "answer_unavailable" } });
  await call("/api/library/search");
  await call("/api/library/new/questions/q2/answer");
  expect(await (await call("/api/attempts")).json()).toMatchObject({ attempts: [] });
});
