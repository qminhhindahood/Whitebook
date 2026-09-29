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
  const env: AssistantEnv = { DB, ASSETS: { fetch: async () => new Response(null, { status: 404 }) }, APP_ORIGIN: origin, AI_RELEASE_ENABLED: "true", ASSISTANT_KEY_KEK: "a".repeat(64), ASSISTANT_SNAPSHOT_KEY: "b".repeat(64), GEMINI_SHARED_KEY: "test-shared-credential", ASSISTANT_CATALOG: JSON.stringify({ reviewedUntil: clock + 86400000, audienceEligibility: "signed_in_adults_18_plus", providerEligibility: "approved", eligibilityEvidence: "test-only", failureCheckEvidence: "test-only", options: [option, { ...option, route: "personal_gemini", payer: "Your Gemini project" }] }) };
  const adapter = vi.fn(async (_payload: string, _model: string, _key: string) => "Fixture response");
  const call = (path: string, body?: unknown, account = "a") => assistantRoute(new Request(origin + "/api/assistant/" + path, { method: body === undefined ? "GET" : "POST", headers: { Cookie: `__Host-wb_session=${account.repeat(64)}`, Origin: origin, "X-CSRF-Token": "c".repeat(64), "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }), env, adapter, () => clock)!;
  const input = { visitId: crypto.randomUUID(), route: "shared_gemini", model: "gemini-test", locale: "en", currentMessage: "Explain linear functions", priorMessages: [] };
  const preview = async (overrides = {}) => { const response = await call("preview", { ...input, ...overrides }); expect(response.status).toBe(200); return response.json(); };
  return { db, env, adapter, call, input, preview, advance: (ms: number) => { clock += ms; } };
}

const visualBytes = new TextEncoder().encode("synthetic reviewed image bytes");

it("offers Personal Gemini without advertising an unconfigured shared key", async () => {
  const f = await fixture();
  f.env.GEMINI_SHARED_KEY = undefined;
  const response = await f.call("options");
  expect(response.status).toBe(200);
  const data = await response.json() as { options: { route: string }[] };
  expect(data.options.map(option => option.route)).toEqual(["personal_gemini"]);
});
const visualHash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", visualBytes)), byte => byte.toString(16).padStart(2, "0")).join("");

async function seedRevealedAttachment(f: Awaited<ReturnType<typeof fixture>>, revealed = true) {
  const reviewId = "reviewed-image";
  const revisionId = "attachment-revision";
  const questionId = "visual-question";
  const attemptId = crypto.randomUUID();
  const assetId = "a".repeat(64);
  const path = `/content/${revisionId}/${questionId}/${assetId}.png`;
  const presentation = { version: 3, stimulus: [], stem: [{ kind: "image_asset", assetId, width: 320, height: 180, alt: "A line graph with two points" }], choices: [] };
  f.db.prepare("INSERT INTO package_revisions VALUES (?, 'family', 'Visual fixture', 1, 1, 'hash', 1)").run(revisionId);
  f.db.prepare("INSERT INTO private_revision_entitlements (account_id, revision_id) VALUES ('a', ?)").run(revisionId);
  f.db.prepare("INSERT INTO publication_questions VALUES (?, ?, 'source-question', 1, 'Math', 1, 1, 'short_answer', ?)")
    .run(revisionId, questionId, JSON.stringify(presentation));
  f.db.prepare("INSERT INTO publication_assets VALUES (?, ?, ?, 'image/png', ?, ?)").run(path, revisionId, questionId, visualHash, visualBytes.byteLength);
  f.db.prepare("INSERT INTO learner_attempts (id, account_id, revision_id, kind, status, config_json, questions_json, state_json, created_at_ms, completed_at_ms, result_json) VALUES (?, 'a', ?, 'practice', 'completed', '{}', '[]', '{}', 0, 1, ?)")
    .run(attemptId, revisionId, JSON.stringify({ questions: [{ questionId, response: "B", acceptedAnswers: ["B"] }] }));
  f.db.prepare("INSERT INTO guided_reviews (id, account_id, attempt_id, revision_id, question_id, prior_answer_exposure, revealed_at_ms, created_at_ms, updated_at_ms) VALUES (?, 'a', ?, ?, ?, 'possible', ?, 0, 0)")
    .run(reviewId, attemptId, revisionId, questionId, revealed ? 1 : null);
  const assetFetch = vi.fn(async (request: Request) => new URL(request.url).pathname === path ? new Response(visualBytes) : new Response(null, { status: 404 }));
  Object.assign(f.env, { ASSETS: { fetch: assetFetch } });
  const catalog = JSON.parse(f.env.ASSISTANT_CATALOG!); catalog.options[0].vision = true; f.env.ASSISTANT_CATALOG = JSON.stringify(catalog);
  return { reviewId, revisionId, questionId, path, assetFetch };
}

async function seedGuidedReview(f: Awaited<ReturnType<typeof fixture>>, section: "Reading and Writing" | "Math" = "Reading and Writing", revealed = false, hint: string | null = "Compare the two claims before choosing.") {
  const reviewId = "guided-review";
  const revisionId = `guided-${section === "Math" ? "math" : "rw"}`;
  const questionId = `guided-question-${section === "Math" ? "math" : "rw"}`;
  const attemptId = crypto.randomUUID();
  const correctId = section === "Math" ? "A" : "C";
  const presentation = { version: 3, stimulus: [{ kind: "reviewed_text", runs: [{ text: "The skeptics doubted the findings; nevertheless, the evidence remained strong." }] }],
    stem: [{ kind: "text", text: section === "Math" ? "Which equation represents the relationship?" : "Which transition best completes the claim?" }],
    choices: (section === "Math" ? ["y = 3.5x + 15", "y = 15x + 3.5", "y = 3.5x - 15", "y = 15 - 3.5x"] : ["Therefore,", "Similarly,", "Nevertheless,", "For example,"]).map((text, index) => ({ id: "ABCD"[index], content: [{ kind: "text", text }] })) };
  f.db.prepare("INSERT INTO package_revisions VALUES (?, 'family', 'Guided fixture', 1, 1, 'hash', 1)").run(revisionId);
  f.db.prepare("INSERT INTO private_revision_entitlements (account_id, revision_id) VALUES ('a', ?)").run(revisionId);
  f.db.prepare("INSERT INTO publication_questions VALUES (?, ?, 'source-question', 1, ?, 1, 1, 'multiple_choice', ?)")
    .run(revisionId, questionId, section, JSON.stringify(presentation));
  f.db.prepare("INSERT INTO learner_attempts (id, account_id, revision_id, kind, status, config_json, questions_json, state_json, created_at_ms, completed_at_ms, result_json) VALUES (?, 'a', ?, 'practice', 'completed', '{}', '[]', '{}', 0, 1, ?)")
    .run(attemptId, revisionId, JSON.stringify({ questions: [{ questionId, response: "B", acceptedAnswers: [correctId] }] }));
  f.db.prepare("INSERT INTO guided_reviews (id, account_id, attempt_id, revision_id, question_id, prior_answer_exposure, revealed_at_ms, created_at_ms, updated_at_ms) VALUES (?, 'a', ?, ?, ?, 'possible', ?, 0, 0)")
    .run(reviewId, attemptId, revisionId, questionId, revealed ? 1 : null);
  if (hint !== null) f.db.prepare("INSERT INTO publication_review_help (revision_id, question_id, reviewed_hint, reviewed_explanation) VALUES (?, ?, ?, NULL)").run(revisionId, questionId, hint);
  return { reviewId, revisionId, questionId, presentation, correctId };
}

it("sends the exact verified image bytes for a revealed selected question and blocks stale or ineligible attachments", async () => {
  const f = await fixture();
  const image = await seedRevealedAttachment(f);
  const previewResponse = await f.call("preview", { ...f.input, reviewId: image.reviewId, includeVisuals: true });
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as { previewId: string; payload: string };
  expect((await f.call("send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true })).status).toBe(200);
  const transmitted = JSON.parse(f.adapter.mock.calls[0][0]);
  const parts = transmitted.contents.at(-1).parts;
  expect(parts.find((part: { inlineData?: unknown }) => part.inlineData)?.inlineData).toEqual({ mimeType: "image/png", data: btoa("synthetic reviewed image bytes") });
  expect(parts.some((part: { text?: string }) => part.text?.includes("320 × 180") && part.text.includes("A line graph with two points"))).toBe(true);

  const hidden = await fixture();
  const hiddenImage = await seedRevealedAttachment(hidden, false);
  expect((await hidden.call("preview", { ...hidden.input, reviewId: hiddenImage.reviewId, includeVisuals: true })).status).toBe(409);
  expect(hidden.adapter).not.toHaveBeenCalled();

  const wrongAccount = await fixture();
  const otherImage = await seedRevealedAttachment(wrongAccount);
  expect((await wrongAccount.call("preview", { ...wrongAccount.input, reviewId: otherImage.reviewId, includeVisuals: true }, "b")).status).toBe(404);
  expect(wrongAccount.adapter).not.toHaveBeenCalled();

  const stale = await fixture();
  const staleImage = await seedRevealedAttachment(stale);
  const stalePreview = await stale.preview({ reviewId: staleImage.reviewId, includeVisuals: true });
  stale.db.prepare("DELETE FROM private_revision_entitlements WHERE account_id = 'a' AND revision_id = ?").run(staleImage.revisionId);
  expect((await stale.call("send", { previewId: stalePreview.previewId, visitId: stale.input.visitId, consent: true })).status).toBe(409);
  expect(stale.adapter).not.toHaveBeenCalled();
});

it("requests a strict JSON array for flashcard drafts and keeps deck advice as plain text", async () => {
  const f = await fixture();
  const base = { visitId: crypto.randomUUID(), route: "shared_gemini", model: "gemini-test", locale: "en", words: "aberrant", context: "", deck: "Vocabulary", cardIds: [] };
  const draft = await f.call("flashcards-preview", { ...base, mode: "draft_cards" });
  expect(draft.status).toBe(200);
  const draftPayload = JSON.parse((await draft.json() as { payload: string }).payload);
  expect(draftPayload.systemInstruction.parts[0].text).toContain("exactly one valid JSON array");
  expect(draftPayload.systemInstruction.parts[0].text).toContain("no markdown fences");
  expect(draftPayload.systemInstruction.parts[0].text).toContain("partOfSpeech");

  f.db.prepare(`INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at)
    VALUES ('advice-card', 'a', 'Vocabulary', 'vocabulary', 'aberrant', 'aberrant', 'Departing from what is normal.', '', '', '', '', '', NULL, 0, 0)`).run();
  const advice = await f.call("flashcards-preview", { ...base, mode: "deck_advice", words: "What should I study next?" });
  expect(advice.status).toBe(200);
  const advicePayload = JSON.parse((await advice.json() as { payload: string }).payload);
  expect(advicePayload.systemInstruction.parts[0].text).toContain("concise plain text");
  expect(advicePayload.systemInstruction.parts[0].text).toContain("do not create or save cards");
});

it("isolates pasted words from selected Personal Cards and rejects stale or mixed sources", async () => {
  const f = await fixture();
  const selectedId = crypto.randomUUID();
  const otherAccountId = crypto.randomUUID();
  f.db.prepare(`INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at)
    VALUES (?, 'a', 'Source deck', 'source deck', 'selected term', 'selected term', 'Private definition', '', '', '', '', '', NULL, 0, 0)`).run(selectedId);
  f.db.prepare(`INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at)
    VALUES (?, 'b', 'Source deck', 'source deck', 'other learner term', 'other learner term', 'Other private definition', '', '', '', '', '', NULL, 0, 0)`).run(otherAccountId);
  const base = { visitId: crypto.randomUUID(), route: "shared_gemini", model: "gemini-test", locale: "en", context: "Keep it concise.", deck: "New destination", cardIds: [selectedId] };
  const response = await f.call("flashcards-preview", { ...base, mode: "draft_cards", words: "" });
  expect(response.status).toBe(200);
  const preview = await response.json() as { payload: string };
  const request = JSON.parse(preview.payload);
  const userPayload = JSON.parse(request.contents[0].parts[0].text);
  expect(userPayload).toMatchObject({ sourceWords: [{ front: "selected term" }], destinationDeck: "New destination" });
  expect(preview.payload).not.toContain("Private definition");
  expect((await f.call("flashcards-preview", { ...base, mode: "draft_cards", words: "also pasted" })).status).toBe(400);
  expect((await f.call("flashcards-preview", { ...base, cardIds: [otherAccountId], mode: "draft_cards", words: "" })).status).toBe(409);
  f.db.prepare("UPDATE personal_cards SET archived_at = 1 WHERE id = ?").run(selectedId);
  expect((await f.call("flashcards-preview", { ...base, mode: "draft_cards", words: "" })).status).toBe(409);
});

it("previews one selected deck with compact ratings and keeps advice visit-only", async () => {
  const f = await fixture();
  const insertCard = (id: string, deck: string, front: string, definition: string) => f.db.prepare(`INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at)
    VALUES (?, 'a', ?, ?, ?, ?, ?, '', '', '', '', '', NULL, 0, 0)`).run(id, deck, deck.toLowerCase(), front, front.toLowerCase(), definition);
  insertCard("advice-vocab-1", "Vocabulary", "aberrant", "Departing from what is normal.");
  insertCard("advice-vocab-2", "Vocabulary", "benevolent", "Kind and generous.");
  insertCard("advice-other", "Private deck", "secret-front", "Other deck private definition.");
  f.db.prepare("INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at) VALUES ('old-history-id', 'advice-vocab-1', 'a', 'not_sure', 'UTC', '2020-01-01', 100)").run();
  f.db.prepare("INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at) VALUES ('latest-history-id', 'advice-vocab-1', 'a', 'sure', 'UTC', '2999-01-01', 200)").run();
  const before = f.db.prepare("SELECT count(*) AS count FROM personal_cards WHERE account_id = 'a'").get() as { count: number };
  const visitId = crypto.randomUUID();
  const response = await f.call("flashcards-preview", { visitId, route: "shared_gemini", model: "gemini-test", locale: "en", mode: "deck_advice", words: "What should I review next?", deck: "Vocabulary", cardIds: [], context: "" });
  expect(response.status).toBe(200);
  const preview = await response.json() as { previewId: string; payload: string };
  const prompt = JSON.parse(JSON.parse(preview.payload).contents[0].parts[0].text);
  expect(prompt).toMatchObject({ selectedDeck: "Vocabulary", deckSnapshot: { summary: { total: 2, ratings: { sure: 1, notSure: 0, unrated: 1 } } } });
  expect(prompt.deckSnapshot.cards.map((card: { front: string }) => card.front)).toEqual(["aberrant", "benevolent"]);
  expect(preview.payload).not.toContain("secret-front");
  expect(preview.payload).not.toContain("Other deck private definition");
  expect(preview.payload).not.toContain("old-history-id");
  expect(preview.payload).not.toContain("latest-history-id");
  expect(preview.payload).not.toContain("2020-01-01");
  const sent = await f.call("flashcards-send", { previewId: preview.previewId, visitId, consent: true });
  expect(sent.status).toBe(200);
  expect(await sent.json()).toMatchObject({ text: "Fixture response", verified: false });
  expect(f.adapter).toHaveBeenCalledOnce();
  expect(f.db.prepare("SELECT count(*) AS count FROM assistant_previews").get()).toMatchObject({ count: 0 });
  const after = f.db.prepare("SELECT count(*) AS count FROM personal_cards WHERE account_id = 'a'").get() as { count: number };
  expect(after.count).toBe(before.count);
  expect(f.db.prepare("SELECT count(*) AS count FROM study_notes WHERE account_id = 'a'").get()).toMatchObject({ count: 0 });
});

async function makeReasoningPreview(f: Awaited<ReturnType<typeof fixture>>, reviewId: string, stage = "reasoning_steps") {
  const response = await f.call("reasoning-preview", { visitId: f.input.visitId, reviewId, route: "shared_gemini", model: "gemini-test", locale: "en", stage, message: "Help me reason through this." });
  expect(response.status).toBe(200);
  return await response.json() as { previewId: string; payload: string; revealed: boolean };
}

it.each([
  ["direct letter disclosure", "The answer is C."],
  ["Vietnamese letter disclosure", "Đáp án là C."],
  ["accepted choice text", "Nevertheless, is the transition that completes the claim."],
  ["answer-equivalent paraphrase", "Choose the word that signals contrast between the evidence and the skeptics."],
])("withholds pre-reveal %s entirely and uses only answer-neutral provider context", async (_label, generated) => {
  const f = await fixture();
  const review = await seedGuidedReview(f);
  const preview = await makeReasoningPreview(f, review.reviewId);
  const providerRequest = JSON.parse(preview.payload);
  const requestText = providerRequest.contents[0].parts[0].text as string;
  expect(preview.revealed).toBe(false);
  expect(requestText).not.toContain("C");
  expect(requestText).not.toContain("Nevertheless");
  expect(requestText).not.toContain("Learner response: B");
  expect(JSON.stringify(providerRequest)).not.toContain("acceptedAnswers");
  f.adapter.mockResolvedValueOnce(generated);
  const response = await f.call("reasoning-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true });
  expect(response.status).toBe(200);
  const body = await response.json() as { withheld: boolean; answerWithheld: boolean; hint: string | null; text?: string };
  expect(body).toMatchObject({ withheld: true, answerWithheld: true, hint: "Compare the two claims before choosing." });
  expect(JSON.stringify(body)).not.toContain(generated);
  expect(f.adapter).toHaveBeenCalledWith(preview.payload, "gemini-test", "test-shared-credential");
});

it("releases answer-neutral pre-reveal reasoning and uses a withholding state when no reviewed hint exists", async () => {
  const safe = await fixture();
  const review = await seedGuidedReview(safe);
  const preview = await makeReasoningPreview(safe, review.reviewId);
  const generated = "Decide whether the two claims agree or contrast.";
  safe.adapter.mockResolvedValueOnce(generated);
  const response = await safe.call("reasoning-send", { previewId: preview.previewId, visitId: safe.input.visitId, consent: true });
  expect(await response.json()).toMatchObject({ text: generated, verified: false, label: "Not verified against the answer key" });

  const noHint = await fixture();
  const noHintReview = await seedGuidedReview(noHint, "Reading and Writing", false, null);
  const noHintPreview = await makeReasoningPreview(noHint, noHintReview.reviewId);
  noHint.adapter.mockResolvedValueOnce("The answer is C.");
  const withheld = await noHint.call("reasoning-send", { previewId: noHintPreview.previewId, visitId: noHint.input.visitId, consent: true });
  expect(await withheld.json()).toMatchObject({ withheld: true, answerWithheld: true, hint: null });
});

it("always shows curated reviewed hints when generated pre-reveal text is withheld", async () => {
  const f = await fixture();
  const review = await seedGuidedReview(f, "Reading and Writing", false, "Answer is C.");
  const preview = await makeReasoningPreview(f, review.reviewId);
  f.adapter.mockResolvedValueOnce("The answer is C.");
  const response = await f.call("reasoning-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true });
  expect(await response.json()).toMatchObject({ withheld: true, answerWithheld: true, hint: "Answer is C." });
});

it("does not upgrade a hidden-state preview after the server reveals the answer", async () => {
  const f = await fixture();
  const review = await seedGuidedReview(f);
  const clientClaimedReveal = await f.call("reasoning-preview", { visitId: f.input.visitId, reviewId: review.reviewId, route: "shared_gemini", model: "gemini-test", locale: "en", stage: "reasoning_steps", message: "Help me.", revealed: true });
  expect(clientClaimedReveal.status).toBe(400);
  const preview = await makeReasoningPreview(f, review.reviewId);
  f.db.prepare("UPDATE guided_reviews SET revealed_at_ms = 100 WHERE id = ?").run(review.reviewId);
  const response = await f.call("reasoning-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true });
  expect(response.status).toBe(409);
  expect(f.adapter).not.toHaveBeenCalled();

  const postReveal = await fixture();
  const revealedReview = await seedGuidedReview(postReveal, "Math", true);
  const revealed = await makeReasoningPreview(postReveal, revealedReview.reviewId, "reading_help");
  expect(revealed.revealed).toBe(true);
  expect(revealed.payload).toContain("y = 3.5x + 15");
  expect(revealed.payload).toContain("standard, clear worked solution");
  expect(revealed.payload).toContain("Desmos approach only when graphing or checking intersections materially helps");
  postReveal.adapter.mockResolvedValueOnce("The verified equation is y = 3.5x + 15.");
  const answerAwareReply = await postReveal.call("reasoning-send", { previewId: revealed.previewId, visitId: postReveal.input.visitId, consent: true });
  expect(await answerAwareReply.json()).toMatchObject({ verified: false, label: "Not verified against the answer key" });
});

it("fails closed on uncertain Math guidance and provider errors without exposing generated fragments", async () => {
  const f = await fixture();
  const review = await seedGuidedReview(f, "Math");
  const preview = await makeReasoningPreview(f, review.reviewId);
  const uncertain = "Type each equation and find which line passes through (16, 71).";
  f.adapter.mockResolvedValueOnce(uncertain);
  const withheld = await f.call("reasoning-send", { previewId: preview.previewId, visitId: f.input.visitId, consent: true });
  expect(await withheld.json()).toMatchObject({ withheld: true, answerWithheld: true, hint: "Compare the two claims before choosing." });

  const equivalent = await fixture();
  const mathReview = await seedGuidedReview(equivalent, "Math");
  const equivalentPreview = await makeReasoningPreview(equivalent, mathReview.reviewId);
  equivalent.adapter.mockResolvedValueOnce("The relation is y = (7/2)x + 15.");
  const equivalentResponse = await equivalent.call("reasoning-send", { previewId: equivalentPreview.previewId, visitId: equivalent.input.visitId, consent: true });
  expect(await equivalentResponse.json()).toMatchObject({ withheld: true, answerWithheld: true });

  const failed = await fixture();
  const failedReview = await seedGuidedReview(failed);
  const failedPreview = await makeReasoningPreview(failed, failedReview.reviewId);
  failed.adapter.mockRejectedValueOnce(new Error("provider outage"));
  const providerError = await failed.call("reasoning-send", { previewId: failedPreview.previewId, visitId: failed.input.visitId, consent: true });
  expect(providerError.status).toBe(502);
  expect(JSON.stringify(await providerError.json())).not.toContain("provider outage");
});

it("shares Gemini preview and send limits and does not block an Attempt save after quota exhaustion", async () => {
  const f = await fixture();
  const hour = Math.floor(Date.now() / 3600000) * 3600000;
  f.db.prepare("INSERT INTO assistant_limits (scope, window_ms, requests, tokens) VALUES ('shared', ?, 100, 400000)").run(hour);
  const visitId = crypto.randomUUID();
  const request = { visitId, route: "shared_gemini", model: "gemini-test", locale: "en", mode: "draft_cards", words: "aberrant", cardIds: [], context: "", deck: "Vocabulary" };
  const previewResponse = await f.call("flashcards-preview", request);
  expect(previewResponse.status).toBe(200);
  const preview = await previewResponse.json() as { previewId: string };
  const exhausted = await f.call("flashcards-send", { previewId: preview.previewId, visitId, consent: true });
  expect(exhausted.status).toBe(429);
  expect(await exhausted.json()).toMatchObject({ error: { code: "quota_exhausted" } });
  expect(f.adapter).not.toHaveBeenCalled();

  const revisionId = "attempt-after-ai-quota";
  f.db.prepare("INSERT INTO package_revisions VALUES (?, 'family', 'Attempt fixture', 1, 1, 'hash', 1)").run(revisionId);
  f.db.prepare("INSERT INTO private_revision_entitlements (account_id, revision_id) VALUES ('a', ?)").run(revisionId);
  const presentation = { version: 3, stimulus: [], stem: [{ kind: "text", text: "Choose the answer." }], choices: ["A", "B"].map(id => ({ id, content: [{ kind: "text", text: `Option ${id}` }] })) };
  f.db.prepare("INSERT INTO publication_questions VALUES (?, 'quota-question', 'source-question', 1, 'Math', 1, 1, 'multiple_choice', ?)").run(revisionId, JSON.stringify(presentation));
  f.db.prepare("INSERT INTO publication_answers VALUES (?, 'quota-question', '[\"A\"]')").run(revisionId);
  const attemptHeaders = { Cookie: `__Host-wb_session=${"a".repeat(64)}`, Origin: origin, "X-CSRF-Token": "c".repeat(64), "Content-Type": "application/json" };
  const attemptEnv = f.env as AssistantEnv & { STAGING_ACCESS_CODE: string };
  const createdResponse = await worker.fetch(new Request(origin + "/api/attempts", { method: "POST", headers: attemptHeaders,
    body: JSON.stringify({ revisionId, section: "Math", modules: [1], count: 1, ordering: "source", timing: { mode: "custom", durationSeconds: 600 } }) }), attemptEnv);
  expect(createdResponse.status).toBe(201);
  const created = await createdResponse.json() as { attemptId: string };
  const startedResponse = await worker.fetch(new Request(`${origin}/api/attempts/${created.attemptId}/start`, { method: "POST", headers: attemptHeaders, body: "{}" }), attemptEnv);
  expect(startedResponse.status).toBe(200);
  const started = await startedResponse.json() as { editorToken: string; stateVersion: number };
  const saved = await worker.fetch(new Request(`${origin}/api/attempts/${created.attemptId}/write`, { method: "POST", headers: attemptHeaders,
    body: JSON.stringify({ editorToken: started.editorToken, expectedStateVersion: started.stateVersion, change: { type: "response", questionId: "quota-question", response: "A" } }) }), attemptEnv);
  expect(saved.status).toBe(200);
  const row = f.db.prepare("SELECT state_json FROM learner_attempts WHERE id = ?").get(created.attemptId) as { state_json: string } | undefined;
  expect(JSON.parse(row!.state_json).responses).toMatchObject({ "quota-question": "A" });
});

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

it("uses GCP_GEMINI_SHARED_KEY first and revokes previews when it rotates", async () => {
  const f = await fixture();
  f.env.GCP_GEMINI_SHARED_KEY = "canonical-gcp-shared-key";
  const first = await f.preview();
  const send = { previewId: first.previewId, visitId: f.input.visitId, consent: true };
  expect((await f.call("send", send)).status).toBe(200);
  expect(f.adapter.mock.calls[0][2]).toBe("canonical-gcp-shared-key");

  const second = await f.preview();
  f.env.GCP_GEMINI_SHARED_KEY = "rotated-gcp-shared-key";
  expect((await f.call("send", { ...send, previewId: second.previewId })).status).toBe(409);
  expect(f.adapter).toHaveBeenCalledOnce();
});

it("rejects client evidence, attachments, non-Gemini routes and known credentials; caps the exact prior turns", async () => {
  const f = await fixture();
  for (const extra of [{ account: { email: "private" } }, { acceptedAnswer: "C" }, { attachment: "review" }, { credentialId: "key" }, { route: "openrouter" }, { currentMessage: "test-shared-credential" }, { currentMessage: "AIza" + "x".repeat(35) }, { currentMessage: "AQ." + "x".repeat(35) }])
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
  const secret = "AQ.personal-test-credential-12345";
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
  expect((await f.call("options")).status).toBe(200);
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

it("rejects missing required fields and unknown keys at the request and nested-turn boundaries", async () => {
  const f = await fixture();
  const { priorMessages: _priorMessages, ...withoutPriorMessages } = f.input;
  expect((await f.call("preview", withoutPriorMessages)).status).toBe(400);
  expect((await f.call("preview", { ...f.input, priorMessages: [{ role: "learner", text: "hello", answerKey: "C" }] })).status).toBe(400);
  const { model: _model, ...withoutModel } = f.input;
  expect((await f.call("preview", withoutModel)).status).toBe(400);
});

it.each([
  ["audienceEligibility", "unknown_audience"],
  ["providerEligibility", "pending"],
  ["eligibilityEvidence", ""],
  ["failureCheckEvidence", ""],
])("does not offer Tutor Chat without an explicitly current and approved %s gate", async (field, value) => {
  const f = await fixture(); const catalog = JSON.parse(f.env.ASSISTANT_CATALOG!); catalog[field] = value; f.env.ASSISTANT_CATALOG = JSON.stringify(catalog);
  const response = await f.call("options");
  expect(response.status).toBe(503);
  expect((await response.json()).error.code).toBe("eligibility_required");
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
