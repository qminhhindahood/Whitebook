import { currentSession, failure, json as accountJson, noStore, requireMutation, type AccountEnv, type Session } from "./accounts";
import { hasPackageEntitlement } from "./library";
import { seal, unseal } from "./assistantSecrets";
import { geminiAdapter, GeminiFailure, type GeminiAdapter } from "./gemini";
import { isValidZone, localCalendarDate } from "./schedule";

export type AssistantEnv = AccountEnv & {
  ASSETS: { fetch(request: Request): Promise<Response> };
  AI_RELEASE_ENABLED?: string;
  ASSISTANT_CATALOG?: string;
  ASSISTANT_KEY_KEK?: string;
  ASSISTANT_SNAPSHOT_KEY?: string;
  GEMINI_SHARED_KEY?: string;
};
type Option = { route: "shared_gemini" | "personal_gemini"; model: string; payer: string; price: string; terms: string; termsUrl: string; termsVersion: string; languages: ("en" | "vi")[]; vision: boolean; quota: string; healthy: boolean };
type Snapshot = { id: string; account: string; session: string; visit: string; expires: number; provider: Option; credentialVersion: string; payload: string; tokens: number; attachmentReviewId?: string; attachmentVisuals?: boolean; attachmentHash?: string; flow?: "tutor" | "reasoning" | "flashcards"; reviewId?: string; stage?: string; revealed?: boolean; acceptedAnswers?: string[]; questionText?: string[]; correctChoiceText?: string[]; section?: string; fallbackHint?: string | null };
type Credential = { version: string; ciphertext: string; last_four: string };
type AttachmentVisual = { path: string; width: number; height: number; alt: string; mimeType: string; data: string };
type Attachment = { reviewId: string; revisionId: string; questionId: string; section: string; module: number; questionNumber: number; response: string | null; acceptedAnswers: string[]; presentation: unknown; visuals: AttachmentVisual[] };
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const HOUR = 3600000;
const MAX_OUTPUT = 1024;
const MAX_PAYLOAD = 16000;
const MAX_MULTIMODAL_PAYLOAD = 4_100_000;
const MAX_ATTACHMENT_BYTES = 3_000_000;
const MAX_SEND_BODY_BYTES = 10_000_000;
const json = (data: unknown) => Response.json(data, { headers: noStore });
const invalid = () => failure(400, "invalid_request", "Check the prompt and Gemini selection, then preview again.");
const consentRequired = () => failure(409, "consent_required", "This preview changed or expired. Preview and consent again.");
const bodyHasExactly = (body: Record<string, unknown>, required: string[], optional: string[] = []) =>
  required.every(key => Object.prototype.hasOwnProperty.call(body, key)) && Object.keys(body).every(key => required.includes(key) || optional.includes(key));
const CARD_FIELDS = ["front", "definition", "vietnamese", "partOfSpeech", "pronunciation", "synonyms", "example"] as const;

// No default model, price, audience eligibility, or capability claims. Operators must
// supply a dated, reviewed catalog; fixture metadata cannot enable the deployed app.
function catalog(env: AssistantEnv, now: number): Option[] {
  if (env.AI_RELEASE_ENABLED !== "true" || !env.ASSISTANT_KEY_KEK || !env.ASSISTANT_SNAPSHOT_KEY) return [];
  try {
    const data = JSON.parse(env.ASSISTANT_CATALOG ?? "null");
    if (!data || !Number.isFinite(data.reviewedUntil) || data.reviewedUntil <= now || data.reviewedUntil > now + 7 * 86400000 ||
      data.audienceEligibility !== "signed_in_adults_18_plus" || data.providerEligibility !== "approved" ||
      typeof data.eligibilityEvidence !== "string" || !data.eligibilityEvidence.trim() || typeof data.failureCheckEvidence !== "string" || !data.failureCheckEvidence.trim() || !Array.isArray(data.options)) return [];
    const options: Option[] = [];
    for (const row of data.options) {
      if (!["shared_gemini", "personal_gemini"].includes(row.route) || !/^gemini-[a-z0-9.-]+$/.test(row.model) ||
        ![row.payer, row.price, row.terms, row.termsVersion, row.quota].every(v => typeof v === "string" && v.trim() && v.length <= 2000) ||
        row.termsUrl !== "https://ai.google.dev/gemini-api/terms" || typeof row.vision !== "boolean" || typeof row.healthy !== "boolean" ||
        !Array.isArray(row.languages) || !row.languages.length || !row.languages.every((v: unknown) => v === "en" || v === "vi")) return [];
      // Explicit allowlist prevents operator metadata from crossing the public boundary.
      options.push({ route: row.route, model: row.model, payer: row.payer, price: row.price, terms: row.terms, termsUrl: row.termsUrl, termsVersion: row.termsVersion, languages: row.languages, vision: row.vision, quota: row.quota, healthy: row.healthy });
    }
    if (new Set(options.map(o => o.route + o.model)).size !== options.length) return [];
    return options;
  } catch { return []; }
}

async function credential(env: AssistantEnv, account: string) {
  return env.DB.prepare("SELECT version, ciphertext, last_four FROM assistant_credentials WHERE account_id = ?").bind(account).first<Credential>();
}
async function routeKey(env: AssistantEnv, account: string, option: Option): Promise<{ key: string; version: string } | null> {
  if (option.route === "shared_gemini") {
    if (!env.GEMINI_SHARED_KEY) return null;
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(env.GEMINI_SHARED_KEY));
    return { key: env.GEMINI_SHARED_KEY, version: Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("") };
  }
  const row = await credential(env, account);
  return row ? { key: await unseal(row.ciphertext, env.ASSISTANT_KEY_KEK!, `credential:${account}`), version: row.version } : null;
}
async function assessmentBlock(env: AssistantEnv, account: string): Promise<Response | null> {
  const exam = await env.DB.prepare("SELECT id FROM learner_attempts WHERE account_id = ? AND kind = 'section_exam' AND status = 'active' LIMIT 1").bind(account).first();
  if (exam) return failure(409, "active_section_exam", "Finish the active Section Exam before opening Tutor Chat.");
  const practice = await env.DB.prepare("SELECT id FROM learner_attempts WHERE account_id = ? AND kind = 'practice' AND status = 'active' AND assisted_at_ms IS NULL LIMIT 1").bind(account).first();
  return practice ? failure(409, "assisted_practice_required", "Tutor Chat is unavailable during unassisted Practice.") : null;
}
function rateLimitedResponse(code: string, seconds: number, now: number): Response {
  return Response.json({ error: { code, message: `Tutor Chat is unavailable. Try again in ${seconds} seconds.`, retryAt: now + seconds * 1000 } }, { status: 429, headers: { ...noStore, "Retry-After": String(seconds) } });
}
async function reserve(env: AssistantEnv, scope: string, tokens: number, requests: number, budget: number, now: number): Promise<boolean> {
  const row = await env.DB.prepare("INSERT INTO assistant_limits (scope, window_ms, requests, tokens) VALUES (?, ?, 1, ?) ON CONFLICT(scope, window_ms) DO UPDATE SET requests = requests + 1, tokens = tokens + excluded.tokens WHERE requests < ? AND tokens + excluded.tokens <= ? RETURNING requests")
    .bind(scope, Math.floor(now / HOUR) * HOUR, tokens, requests, budget).first();
  return !!row;
}
async function bodyOf(request: Request, limit = 70000): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json")) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const decoder = new TextDecoder(); let raw = ""; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.length;
    if (size > limit) { await reader.cancel(); return null; }
    raw += decoder.decode(next.value, { stream: true });
  }
  try { const b = JSON.parse(raw + decoder.decode()); return b && typeof b === "object" && !Array.isArray(b) ? b : null; } catch { return null; }
}
function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + 0x8000, bytes.length)));
  return btoa(binary);
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function estimateTokens(payload: string, visuals: Attachment["visuals"] = []): number {
  const textOnly = payload.replace(/("data"\s*:\s*")[A-Za-z0-9+/=]*(")/g, "$1$2");
  const textTokens = Math.ceil(new TextEncoder().encode(textOnly).length / 4);
  const imageTokens = visuals.reduce((sum, visual) => sum + 258 * Math.ceil((visual.width * visual.height) / (768 * 768)), 0);
  return textTokens + imageTokens + MAX_OUTPUT;
}

function payloadOf(body: Record<string, unknown>, attachment: Attachment | null): string | null {
  if (body.locale !== "en" && body.locale !== "vi" || typeof body.currentMessage !== "string" || !body.currentMessage.trim() || body.currentMessage.length > 4000 || !Array.isArray(body.priorMessages) || body.priorMessages.length > 40) return null;
  const turns: { role: string; parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[] }[] = [];
  for (const m of body.priorMessages) {
    if (!m || typeof m !== "object" || !bodyHasExactly(m, ["role", "text"]) || !["learner", "assistant"].includes(m.role) || typeof m.text !== "string" || m.text.length > 8000) return null;
    turns.push({ role: m.role === "learner" ? "user" : "model", parts: [{ text: m.text }] });
  }
  const contents = turns.slice(-8);
  const attachmentText = attachment ? `\n\nReviewed question attachment (authoritative answer key remains outside Gemini grading):\n${JSON.stringify({
    section: attachment.section, module: attachment.module, questionNumber: attachment.questionNumber,
    response: attachment.response, acceptedAnswers: attachment.acceptedAnswers, presentation: attachment.presentation,
    visuals: attachment.visuals.map(({ width, height, alt, mimeType }) => ({ width, height, alt, mimeType })),
  })}` : "";
  const visualParts = attachment?.visuals.flatMap((visual, index) => [
    { text: `Attached visual ${index + 1}: ${visual.width} × ${visual.height}; alt: ${visual.alt}` },
    { inlineData: { mimeType: visual.mimeType, data: visual.data } },
  ]) ?? [];
  contents.push({ role: "user", parts: [{ text: body.currentMessage + attachmentText }, ...visualParts] });
  const serialize = () => JSON.stringify({ systemInstruction: { parts: [{ text: `You are a study tutor. Respond in ${body.locale === "vi" ? "Vietnamese" : "English"}. Your responses are unverified learning help, not authoritative grades.` }] }, contents, generationConfig: { maxOutputTokens: MAX_OUTPUT }, store: false });
  const maxPayload = attachment?.visuals.length ? MAX_MULTIMODAL_PAYLOAD : MAX_PAYLOAD;
  while (contents.length > 1 && new TextEncoder().encode(serialize()).length > maxPayload) contents.shift();
  const result = serialize();
  return new TextEncoder().encode(result).length <= maxPayload ? result : null;
}

type ReasoningContext = { reviewId: string; revisionId: string; questionId: string; section: string; responseType: string; revealed: boolean; response: string | null; acceptedAnswers: string[]; presentation: unknown; questionText: string[]; correctChoiceText: string[]; fallbackHint: string | null };

function presentationText(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const blocks: unknown[] = [];
  const presentation = value as { stimulus?: unknown[]; stem?: unknown[]; choices?: { content?: unknown[] }[] };
  blocks.push(...(presentation.stimulus ?? []), ...(presentation.stem ?? []), ...(presentation.choices ?? []).flatMap(choice => choice.content ?? []));
  return blocks.flatMap((block) => {
    if (!block || typeof block !== "object") return [];
    const item = block as { text?: unknown; latex?: unknown; runs?: { text?: unknown }[] };
    if (typeof item.text === "string") return [item.text];
    if (typeof item.latex === "string") return [item.latex];
    return Array.isArray(item.runs) ? item.runs.flatMap(run => typeof run.text === "string" ? [run.text] : []) : [];
  });
}

function normalized(value: string): string {
  return value.toLocaleLowerCase().normalize("NFKC")
    .replace(/\\frac\s*\{([^}]*)\}\s*\{([^}]*)\}/g, "($1/$2)")
    .replace(/(\d+(?:\.\d+)?)\s*[×x]\s*10\s*\^\s*(\d+)/g, (_match, coefficient: string, power: string) => String(Number(coefficient) * 10 ** Number(power)))
    .replace(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/g, (_match, numerator: string, denominator: string) => String(Number(numerator) / Number(denominator)))
    .replace(/\d+(?:\.\d+)?/g, number => String(Number(number)))
    .replace(/[^a-z0-9.+/=\-]/g, "");
}

function unsafeReasoning(text: string, context: ReasoningContext, stage = "reasoning_steps"): boolean {
  const value = normalized(text);
  for (const answer of context.acceptedAnswers) {
    const key = answer.trim();
    const normalizedAnswer = normalized(key);
    if (normalizedAnswer.length >= 2 && value.includes(normalizedAnswer)) return true;
    const disclosureText = text.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
    if (/^[a-d]$/i.test(key) && (new RegExp(`\\b(answer|correct|choose|select|pick|option|choice)\\b.{0,32}\\b${key}\\b`, "i").test(text) || new RegExp(`\\b(dap\\s+an|chon)\\b.{0,32}\\b${key}\\b`, "i").test(disclosureText))) return true;
    if (/^[-+]?\$?\d+(?:,\d{3})*(?:\.\d+)?$/.test(key)) {
      const expected = Number(key.replace(/[$,]/g, ""));
      if (Array.from(text.matchAll(/[-+]?\$?\d+(?:,\d{3})*(?:\.\d+)?/g), match => Number(match[0].replace(/[$,]/g, ""))).some(number => Number.isFinite(number) && Math.abs(number - expected) < 1e-9)) return true;
    }
  }
  if (context.correctChoiceText.some(choice => normalized(choice).length >= 3 && value.includes(normalized(choice)))) return true;
  if (context.correctChoiceText.some(choice => /however|nevertheless|nonetheless/i.test(choice) && /\b(however|nevertheless|nonetheless|still|yet|even so)\b/i.test(text))) return true;
  if (/\b(only one|one and only one|single remaining)\b.{0,36}\b(option|choice|candidate|answer)\b|\b(only|just) one (option|choice|candidate) (?:is )?left\b/i.test(text)) return true;
  if (context.correctChoiceText.some(choice => /however|nevertheless|nonetheless/i.test(choice)) && /\bword\b.{0,48}\b(signal|indicate|show)\w*\b.{0,32}\bcontrast\b|\bword meaning ["“]?however/i.test(text)) return true;
  const choices = context.questionText.map(normalized).filter(choice => choice.length >= 12);
  if (choices.some(choice => value.includes(choice))) return true;
  if (!context.revealed && context.section === "Math" && stage !== "follow_up" && /\b(desmos|graph|plot|calculator|passes through|test each equation|substitute)\b/i.test(text)) return true;
  return false;
}

function providerQuestionText(presentation: unknown, acceptedAnswers: string[], revealed: boolean): string[] {
  if (revealed || !presentation || typeof presentation !== "object") return presentationText(presentation);
  const value = presentation as { choices?: { id?: unknown; content?: unknown[] }[] };
  const accepted = new Set(acceptedAnswers.map(answer => answer.trim().toUpperCase()));
  return presentationText({ ...value, choices: (value.choices ?? []).filter(choice => !accepted.has(String(choice.id ?? "").toUpperCase())) });
}

async function reasoningContext(env: AssistantEnv, accountId: string, reviewId: string): Promise<ReasoningContext | Response> {
  const review = await env.DB.prepare("SELECT id, attempt_id, revision_id, question_id, revealed_at_ms FROM guided_reviews WHERE id = ? AND account_id = ?")
    .bind(reviewId, accountId).first<{ id: string; attempt_id: string; revision_id: string; question_id: string; revealed_at_ms: number | null }>();
  if (!review) return failure(404, "not_found", "This reviewed question is unavailable.");
  if (!await hasPackageEntitlement(env, accountId, review.revision_id)) return failure(404, "not_found", "This reviewed question is unavailable.");
  const attempt = await env.DB.prepare("SELECT status, result_json FROM learner_attempts WHERE id = ? AND account_id = ?")
    .bind(review.attempt_id, accountId).first<{ status: string; result_json: string | null }>();
  const question = await env.DB.prepare("SELECT section, response_type, presentation_json FROM publication_questions WHERE revision_id = ? AND question_id = ?")
    .bind(review.revision_id, review.question_id).first<{ section: string; response_type: string; presentation_json: string }>();
  if (!attempt || attempt.status !== "completed" || !attempt.result_json || !question) return failure(409, "review_incomplete", "Guided Reasoning is available after this Attempt is complete.");
  const grade = (JSON.parse(attempt.result_json) as { questions: { questionId: string; response: string | null; acceptedAnswers: string[] }[] }).questions.find(item => item.questionId === review.question_id);
  if (!grade) return failure(404, "not_found", "This reviewed question is unavailable.");
  const presentation = JSON.parse(question.presentation_json);
  const help = await env.DB.prepare("SELECT reviewed_hint FROM publication_review_help WHERE revision_id = ? AND question_id = ?")
    .bind(review.revision_id, review.question_id).first<{ reviewed_hint: string | null }>();
  const questionText = presentationText(presentation);
  const acceptedKeys = new Set(grade.acceptedAnswers.map(answer => answer.trim().toUpperCase()));
  const correctChoiceText = ((presentation as { choices?: { id?: unknown; content?: unknown[] }[] }).choices ?? [])
    .filter(choice => acceptedKeys.has(String(choice.id ?? "").toUpperCase())).flatMap(choice => presentationText({ stimulus: [], stem: choice.content ?? [], choices: [] }));
  const revealed = review.revealed_at_ms !== null;
  const contextForHint: ReasoningContext = { reviewId, revisionId: review.revision_id, questionId: review.question_id,
    section: question.section, responseType: question.response_type, revealed, response: grade.response,
    acceptedAnswers: grade.acceptedAnswers, presentation, questionText, correctChoiceText, fallbackHint: null };
  const fallbackHint = help?.reviewed_hint && !unsafeReasoning(help.reviewed_hint, contextForHint) ? help.reviewed_hint : null;
  return { ...contextForHint, fallbackHint };
}

async function reasoningPreview(body: Record<string, unknown>, env: AssistantEnv, session: Session, options: Option[], now: number): Promise<Response> {
  if (!bodyHasExactly(body, ["visitId", "reviewId", "route", "model", "locale", "stage", "message"]) || typeof body.visitId !== "string" || !UUID.test(body.visitId) || typeof body.reviewId !== "string" || typeof body.message !== "string" || !body.message.trim() || body.message.length > 4000 || !["en", "vi"].includes(String(body.locale)) || !["reasoning_steps", "reading_help", "follow_up"].includes(String(body.stage))) return invalid();
  const provider = options.find(item => item.route === body.route && item.model === body.model);
  if (!provider || !provider.healthy || !provider.languages.includes(body.locale as "en" | "vi")) return failure(400, "model_unavailable", "Choose an available Gemini route and model.");
  const context = await reasoningContext(env, session.account_id, body.reviewId);
  if (context instanceof Response) return context;
  const answer = context.revealed ? `\nAccepted answer (server verified; do not regrade): ${JSON.stringify(context.acceptedAnswers)}` : "";
  const mathHelp = context.section === "Math" && context.revealed
    ? " Give a standard, clear worked solution using the verified answer. Include a Desmos approach only when graphing or checking intersections materially helps; do not force calculator instructions."
    : "";
  const responseText = context.revealed ? context.response ?? "unanswered" : "Withheld until the learner reveals the answer.";
  const visibleQuestionText = providerQuestionText(context.presentation, context.acceptedAnswers, context.revealed);
  const instruction = `You are Guided Reasoning for a reviewed Whitebook question. Respond in ${body.locale === "vi" ? "Vietnamese" : "English"}. Before reveal, provide only answer-neutral reasoning steps and never identify, quote, paraphrase, eliminate choices toward, or narrow to the accepted answer. After reveal, explain the answer but do not claim grading authority.${mathHelp}`;
  const payload = JSON.stringify({ systemInstruction: { parts: [{ text: instruction }] }, contents: [{ role: "user", parts: [{ text: `${body.stage}: ${body.message}\nQuestion presentation text: ${JSON.stringify(visibleQuestionText)}\nLearner response: ${responseText}${answer}` }] }], generationConfig: { maxOutputTokens: MAX_OUTPUT }, store: false });
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD) return invalid();
  const key = await routeKey(env, session.account_id, provider);
  if (!key) return failure(409, "credential_required", "Save a Gemini credential or choose an available shared route.");
  if (!await reserve(env, `preview:${session.account_id}`, 0, 60, 1, now)) return rateLimitedResponse("rate_limited", Math.ceil((HOUR - now % HOUR) / 1000), now);
  const snapshot: Snapshot = { id: crypto.randomUUID(), account: session.account_id, session: session.token_hash, visit: body.visitId, expires: now + 5 * 60000, provider, credentialVersion: key.version, payload, tokens: new TextEncoder().encode(payload).length + MAX_OUTPUT, flow: "reasoning", reviewId: context.reviewId, stage: String(body.stage), revealed: context.revealed, acceptedAnswers: context.acceptedAnswers, questionText: context.questionText, correctChoiceText: context.correctChoiceText, section: context.section, fallbackHint: context.fallbackHint };
  const previewId = await seal(JSON.stringify(snapshot), env.ASSISTANT_SNAPSHOT_KEY!, "tutor-preview");
  await env.DB.prepare("DELETE FROM assistant_previews WHERE expires_at_ms <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO assistant_previews (id, account_id, session_hash, visit_id, expires_at_ms) VALUES (?, ?, ?, ?, ?)").bind(snapshot.id, session.account_id, session.token_hash, body.visitId, snapshot.expires).run();
  return json({ previewId, expiresAt: snapshot.expires, provider, payload, revealed: context.revealed, question: { revisionId: context.revisionId, questionId: context.questionId, presentation: context.presentation }, fallbackHint: context.fallbackHint });
}

async function reasoningSend(body: Record<string, unknown>, env: AssistantEnv, session: Session, options: Option[], adapter: GeminiAdapter, now: number): Promise<Response> {
  if (!bodyHasExactly(body, ["previewId", "visitId", "consent"]) || body.consent !== true || typeof body.previewId !== "string" || typeof body.visitId !== "string") return consentRequired();
  let snapshot: Snapshot;
  try { snapshot = JSON.parse(await unseal(body.previewId, env.ASSISTANT_SNAPSHOT_KEY!, "tutor-preview")); } catch { return consentRequired(); }
  if (snapshot.flow !== "reasoning" || snapshot.account !== session.account_id || snapshot.session !== session.token_hash || snapshot.visit !== body.visitId || snapshot.expires <= now) return consentRequired();
  const provider = options.find(item => item.route === snapshot.provider.route && item.model === snapshot.provider.model);
  const key = provider && await routeKey(env, session.account_id, provider);
  if (!provider || JSON.stringify(provider) !== JSON.stringify(snapshot.provider) || !key || key.version !== snapshot.credentialVersion) return consentRequired();
  const current = await reasoningContext(env, session.account_id, snapshot.reviewId!);
  if (current instanceof Response || current.revealed !== snapshot.revealed) return consentRequired();
  const consumed = await env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ? AND session_hash = ? AND visit_id = ? AND expires_at_ms > ? RETURNING id").bind(snapshot.id, session.account_id, session.token_hash, body.visitId, now).first();
  if (!consumed) return consentRequired();
  const retry = Math.ceil((HOUR - now % HOUR) / 1000);
  if (!await reserve(env, `send:${session.account_id}`, snapshot.tokens, 20, 80000, now)) return rateLimitedResponse("rate_limited", retry, now);
  if (provider.route === "shared_gemini" && !await reserve(env, "shared", snapshot.tokens, 100, 400000, now)) return rateLimitedResponse("quota_exhausted", retry, now);
  try {
    const text = await adapter(snapshot.payload, provider.model, key.key);
    if (!text.trim() || text.length > 8000 || text.includes(key.key)) return failure(502, "provider_error", "Guided Reasoning could not produce a safe explanation.");
    if (!snapshot.revealed && unsafeReasoning(text, current, snapshot.stage)) return json({ withheld: true, answerWithheld: true, hint: snapshot.fallbackHint, message: snapshot.fallbackHint ? "A reviewed hint is available instead of generated text." : "This generated step was withheld because its answer safety could not be verified." });
    return json({ text, verified: false, label: "Not verified against the answer key" });
  } catch { return failure(502, "provider_error", "Guided Reasoning could not complete this request. Your draft is preserved."); }
}

async function flashcardPreview(body: Record<string, unknown>, env: AssistantEnv, session: Session, options: Option[], now: number): Promise<Response> {
  if (!bodyHasExactly(body, ["visitId", "route", "model", "locale", "mode", "words", "deck", "cardIds"], ["context"]) || typeof body.visitId !== "string" || !UUID.test(body.visitId) || !["draft_cards", "deck_advice"].includes(String(body.mode)) || typeof body.deck !== "string" || body.deck.length > 80 || !Array.isArray(body.cardIds) || body.cardIds.length > 20 || body.cardIds.some(id => typeof id !== "string" || !UUID.test(id)) || new Set(body.cardIds).size !== body.cardIds.length || (body.mode === "draft_cards" && (typeof body.words !== "string" || (Boolean(body.words.trim()) === (body.cardIds.length > 0)) || body.words.length > 4000)) || (body.mode === "deck_advice" && (typeof body.words !== "string" || !body.words.trim() || body.cardIds.length > 0))) return invalid();
  const provider = options.find(item => item.route === body.route && item.model === body.model);
  if (!provider || !provider.healthy || !provider.languages.includes(body.locale as "en" | "vi")) return failure(400, "model_unavailable", "Choose an available Gemini route and model.");
  let selected: unknown;
  let cardRows: { id: string; front: string; definition: string; vietnamese: string; part_of_speech: string; pronunciation: string; synonyms: string; example: string; rating: string | null; next_due: string | null }[] = [];
  if (body.mode === "deck_advice") {
    const cards = await env.DB.prepare("SELECT p.id, p.front, p.definition, p.vietnamese, p.part_of_speech, p.pronunciation, p.synonyms, p.example, r.rating, r.next_due FROM personal_cards p LEFT JOIN (SELECT card_id, rating, next_due, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY rated_at DESC, id DESC) AS rn FROM card_rating_events WHERE account_id = ?) r ON r.card_id = p.id AND r.rn = 1 WHERE p.account_id = ? AND p.deck_key = ? AND p.archived_at IS NULL ORDER BY p.front LIMIT 100").bind(session.account_id, session.account_id, body.deck.toLocaleLowerCase().replace(/\s+/g, " ").trim()).all();
    cardRows = cards.results as typeof cardRows;
    const zoneRow = await env.DB.prepare("SELECT time_zone FROM learner_accounts WHERE id = ?").bind(session.account_id).first<{ time_zone: string | null }>();
    const zone = zoneRow?.time_zone && isValidZone(zoneRow.time_zone) ? zoneRow.time_zone : "UTC";
    const today = localCalendarDate(now, zone);
    const due = cardRows.filter(card => !card.next_due || card.next_due <= today).length;
    selected = {
      cards: cardRows.map(({ front, definition, vietnamese, part_of_speech, pronunciation, synonyms, example }) => ({ front, definition, vietnamese, partOfSpeech: part_of_speech, pronunciation, synonyms, example })),
      summary: { total: cardRows.length, due, notDue: cardRows.length - due,
        ratings: { sure: cardRows.filter(card => card.rating === "sure").length, notSure: cardRows.filter(card => card.rating === "not_sure").length, unrated: cardRows.filter(card => !card.rating).length } },
    };
  } else if (body.cardIds.length) {
    const cards = await env.DB.prepare(`SELECT id, front, '' AS definition, '' AS vietnamese, '' AS part_of_speech, '' AS pronunciation, '' AS synonyms, '' AS example, NULL AS rating, NULL AS next_due FROM personal_cards WHERE account_id = ? AND archived_at IS NULL AND id IN (${body.cardIds.map(() => "?").join(", ")})`)
      .bind(session.account_id, ...body.cardIds).all();
    const byId = new Map((cards.results as typeof cardRows).map(card => [card.id, card]));
    if (body.cardIds.some(id => !byId.has(id))) return failure(409, "source_cards_changed", "A selected Personal Card is no longer available. Refresh the selection before previewing again.");
    selected = body.cardIds.map(id => ({ front: byId.get(id)!.front }));
  } else selected = String(body.words).split(/[\n,]+/).map(word => word.trim()).filter(Boolean).slice(0, 20).map(front => ({ front }));
  if (body.mode === "deck_advice" && !cardRows.length) return failure(404, "deck_unavailable", "Choose a Personal Deck with cards before requesting advice.");
  const outputFormat = body.mode === "draft_cards"
    ? "For card drafts, return exactly one valid JSON array and nothing else: no markdown fences, headings, or extra prose. Each item must be an object with string fields front, definition, vietnamese, partOfSpeech, pronunciation, synonyms, and example. Use empty strings for unknown optional fields; include a non-empty front and at least one non-empty back field. Return at most 20 items."
    : "For deck advice, respond with concise plain text and do not create or save cards.";
  const userPrompt = body.mode === "deck_advice"
    ? { mode: body.mode, question: String(body.words).slice(0, 4000), selectedDeck: body.deck, deckSnapshot: selected, context: typeof body.context === "string" ? body.context.slice(0, 2000) : "" }
    : { mode: body.mode, sourceWords: selected, context: typeof body.context === "string" ? body.context.slice(0, 2000) : "", destinationDeck: body.deck };
  const payload = JSON.stringify({ systemInstruction: { parts: [{ text: `You are Flashcard Assistant. Respond in ${body.locale === "vi" ? "Vietnamese" : "English"}. Propose learner-editable Personal Card content only; never save cards. ${outputFormat}` }] }, contents: [{ role: "user", parts: [{ text: JSON.stringify(userPrompt) }] }], generationConfig: { maxOutputTokens: MAX_OUTPUT }, store: false });
  if (new TextEncoder().encode(payload).length > MAX_PAYLOAD) return invalid();
  const key = await routeKey(env, session.account_id, provider); if (!key) return failure(409, "credential_required", "Save a Gemini credential or choose an available shared route.");
  if (!await reserve(env, `preview:${session.account_id}`, 0, 60, 1, now)) return rateLimitedResponse("rate_limited", Math.ceil((HOUR - now % HOUR) / 1000), now);
  const snapshot: Snapshot = { id: crypto.randomUUID(), account: session.account_id, session: session.token_hash, visit: body.visitId, expires: now + 5 * 60000, provider, credentialVersion: key.version, payload, tokens: new TextEncoder().encode(payload).length + MAX_OUTPUT, flow: "flashcards" };
  const previewId = await seal(JSON.stringify(snapshot), env.ASSISTANT_SNAPSHOT_KEY!, "tutor-preview");
  await env.DB.prepare("DELETE FROM assistant_previews WHERE expires_at_ms <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO assistant_previews (id, account_id, session_hash, visit_id, expires_at_ms) VALUES (?, ?, ?, ?, ?)").bind(snapshot.id, session.account_id, session.token_hash, body.visitId, snapshot.expires).run();
  return json({ previewId, expiresAt: snapshot.expires, provider, payload, mode: body.mode, deck: body.deck });
}

async function flashcardSend(body: Record<string, unknown>, env: AssistantEnv, session: Session, options: Option[], adapter: GeminiAdapter, now: number): Promise<Response> {
  if (!bodyHasExactly(body, ["previewId", "visitId", "consent"]) || body.consent !== true || typeof body.previewId !== "string" || typeof body.visitId !== "string") return consentRequired();
  let snapshot: Snapshot; try { snapshot = JSON.parse(await unseal(body.previewId, env.ASSISTANT_SNAPSHOT_KEY!, "tutor-preview")); } catch { return consentRequired(); }
  if (snapshot.flow !== "flashcards" || snapshot.account !== session.account_id || snapshot.session !== session.token_hash || snapshot.visit !== body.visitId || snapshot.expires <= now) return consentRequired();
  const provider = options.find(item => item.route === snapshot.provider.route && item.model === snapshot.provider.model); const key = provider && await routeKey(env, session.account_id, provider);
  if (!provider || JSON.stringify(provider) !== JSON.stringify(snapshot.provider) || !key || key.version !== snapshot.credentialVersion) return consentRequired();
  const consumed = await env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ? AND session_hash = ? AND visit_id = ? AND expires_at_ms > ? RETURNING id").bind(snapshot.id, session.account_id, session.token_hash, body.visitId, now).first();
  if (!consumed) return consentRequired();
  const retry = Math.ceil((HOUR - now % HOUR) / 1000);
  if (!await reserve(env, `send:${session.account_id}`, snapshot.tokens, 20, 80000, now)) return rateLimitedResponse("rate_limited", retry, now);
  if (provider.route === "shared_gemini" && !await reserve(env, "shared", snapshot.tokens, 100, 400000, now)) return rateLimitedResponse("quota_exhausted", retry, now);
  try { const text = await adapter(snapshot.payload, provider.model, key.key); if (!text.trim() || text.length > 12000 || text.includes(key.key)) return failure(502, "provider_error", "Flashcard Assistant returned an unavailable draft."); return json({ text, provider, verified: false }); }
  catch { return failure(502, "provider_error", "Flashcard Assistant could not complete this request. Your draft is preserved."); }
}

async function attachment(env: AssistantEnv, accountId: string, reviewId: string, includeVisuals: boolean, requestUrl: string): Promise<Attachment | Response> {
  const review = await env.DB.prepare("SELECT id, attempt_id, revision_id, question_id, revealed_at_ms FROM guided_reviews WHERE id = ? AND account_id = ?")
    .bind(reviewId, accountId).first<{ id: string; attempt_id: string; revision_id: string; question_id: string; revealed_at_ms: number | null }>();
  if (!review) return failure(404, "not_found", "This reviewed question is unavailable.");
  if (review.revealed_at_ms === null) return failure(409, "review_hidden", "Reveal this reviewed question before attaching it.");
  if (!await hasPackageEntitlement(env, accountId, review.revision_id)) return failure(409, "attachment_unavailable", "This reviewed question is no longer available.");
  const source = await env.DB.prepare("SELECT status, result_json FROM learner_attempts WHERE id = ? AND account_id = ?")
    .bind(review.attempt_id, accountId).first<{ status: string; result_json: string | null }>();
  const question = await env.DB.prepare("SELECT section, module, question_number, presentation_json FROM publication_questions WHERE revision_id = ? AND question_id = ?")
    .bind(review.revision_id, review.question_id).first<{ section: string; module: number; question_number: number; presentation_json: string }>();
  if (!source || source.status !== "completed" || !source.result_json || !question) return failure(404, "not_found", "This reviewed question is unavailable.");
  const result = (JSON.parse(source.result_json) as { questions: { questionId: string; response: string | null; acceptedAnswers: string[] }[] }).questions.find(item => item.questionId === review.question_id);
  if (!result) return failure(404, "not_found", "This reviewed question is unavailable.");
  const presentation = JSON.parse(question.presentation_json) as { stimulus?: unknown[]; stem?: unknown[]; choices?: { content?: unknown[] }[] };
  const blocks = [...(presentation.stimulus ?? []), ...(presentation.stem ?? []), ...(presentation.choices ?? []).flatMap(choice => choice.content ?? [])] as { kind?: string; src?: string; assetId?: string; width?: number; height?: number; alt?: string }[];
  const visuals: AttachmentVisual[] = [];
  let attachmentBytes = 0;
  if (includeVisuals) {
    for (const block of blocks) {
      if (block.kind === "asset") return failure(409, "attachment_unavailable", "Only reviewed derived PNG visuals can be shared with Gemini.");
      if (block.kind !== "image_asset") continue;
      if (typeof block.assetId !== "string" || !/^[a-f0-9]{64}$/.test(block.assetId) ||
        !Number.isSafeInteger(block.width) || !Number.isSafeInteger(block.height) || block.width! <= 0 || block.height! <= 0 ||
        typeof block.alt !== "string" || block.alt.length > 500)
        return failure(409, "attachment_unavailable", "This reviewed visual is unavailable for sharing.");
      const path = `/content/${review.revision_id}/${review.question_id}/${block.assetId}.png`;
      const stored = await env.DB.prepare("SELECT content_type, sha256, byte_size FROM publication_assets WHERE path = ? AND revision_id = ? AND question_id = ?")
        .bind(path, review.revision_id, review.question_id).first<{ content_type: string; sha256: string; byte_size: number }>();
      if (!stored || stored.content_type !== "image/png" || !/^[a-f0-9]{64}$/.test(stored.sha256) ||
        !Number.isSafeInteger(stored.byte_size) || stored.byte_size <= 0)
        return failure(409, "attachment_unavailable", "This reviewed visual is no longer available.");
      attachmentBytes += stored.byte_size;
      if (attachmentBytes > MAX_ATTACHMENT_BYTES) return failure(413, "attachment_too_large", "The selected visuals exceed the Gemini attachment limit.");
      const asset = await env.ASSETS.fetch(new Request(new URL(path, requestUrl), { method: "GET" }));
      if (!asset.ok) return failure(503, "visual_unavailable", "A selected visual could not be loaded. Preview again before sending.");
      const bytes = await asset.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (bytes.byteLength !== stored.byte_size || hash !== stored.sha256)
        return failure(503, "visual_unavailable", "A selected visual changed or failed verification. Preview again before sending.");
      visuals.push({ path, width: block.width!, height: block.height!, alt: block.alt, mimeType: stored.content_type, data: encodeBase64(new Uint8Array(bytes)) });
    }
  }
  return { reviewId, revisionId: review.revision_id, questionId: review.question_id, section: question.section, module: question.module, questionNumber: question.question_number, response: result.response, acceptedAnswers: result.acceptedAnswers, presentation, visuals: includeVisuals ? visuals : [] };
}

async function attachmentList(env: AssistantEnv, accountId: string): Promise<Response> {
  const rows = await env.DB.prepare("SELECT g.id, g.attempt_id, g.revision_id, g.question_id, g.revealed_at_ms, a.completed_at_ms, pq.section, pq.module, pq.question_number FROM guided_reviews g JOIN learner_attempts a ON a.id = g.attempt_id AND a.account_id = g.account_id JOIN publication_questions pq ON pq.revision_id = g.revision_id AND pq.question_id = g.question_id WHERE g.account_id = ? AND g.revealed_at_ms IS NOT NULL AND a.status = 'completed' ORDER BY g.updated_at_ms DESC").bind(accountId).all();
  const eligible = [];
  for (const row of rows.results as { id: string; attempt_id: string; revision_id: string; question_id: string; section: string; module: number; question_number: number; completed_at_ms: number }[]) {
    if (await hasPackageEntitlement(env, accountId, row.revision_id)) eligible.push({ reviewId: row.id, attemptId: row.attempt_id, revisionId: row.revision_id, questionId: row.question_id, section: row.section, module: row.module, questionNumber: row.question_number, completedAt: row.completed_at_ms });
  }
  return accountJson({ reviews: eligible });
}

async function preview(body: Record<string, unknown>, env: AssistantEnv, session: Session, options: Option[], now: number, requestUrl: string): Promise<Response> {
  if (!bodyHasExactly(body, ["visitId", "route", "model", "locale", "currentMessage", "priorMessages"], ["reviewId", "includeVisuals"]) || typeof body.visitId !== "string" || !UUID.test(body.visitId)) return invalid();
  const provider = options.find(o => o.route === body.route && o.model === body.model);
  if (!provider) return failure(400, "model_unavailable", "Choose an available Gemini route and model.");
  if (!provider.healthy) return failure(503, "provider_error", "This Gemini route is unavailable. Try again later.");
  if (!provider.languages.includes(body.locale as "en" | "vi")) return failure(400, "capability_missing", "This model does not support the selected response language.");
  let attached: Attachment | null = null;
  if (body.reviewId !== undefined) {
    if (typeof body.reviewId !== "string" || typeof body.includeVisuals !== "boolean") return invalid();
    if (body.includeVisuals && !provider.vision) return failure(409, "capability_missing", "Choose a vision-capable Gemini model before sharing visuals.");
    const found = await attachment(env, session.account_id, body.reviewId, body.includeVisuals, requestUrl);
    if (found instanceof Response) return found;
    attached = found;
  }
  const payload = payloadOf(body, attached); if (!payload) return invalid();
  const key = await routeKey(env, session.account_id, provider);
  if (!key) return failure(409, "credential_required", "Save a Gemini credential or choose an available shared route.");
  const personal = await credential(env, session.account_id);
  const secrets = [key.key, env.GEMINI_SHARED_KEY, personal ? await unseal(personal.ciphertext, env.ASSISTANT_KEY_KEK!, `credential:${session.account_id}`) : null];
  if (/AIza[0-9A-Za-z_-]{30,}|-----BEGIN .*PRIVATE KEY-----/.test(payload) || secrets.some(s => s && payload.includes(s))) return failure(400, "blocked_content", "Remove credentials from the prompt and preview again.");
  if (!await reserve(env, `preview:${session.account_id}`, 0, 60, 1, now)) return rateLimitedResponse("rate_limited", Math.ceil((HOUR - now % HOUR) / 1000), now);
   const snapshot: Snapshot = { id: crypto.randomUUID(), account: session.account_id, session: session.token_hash, visit: body.visitId, expires: now + 5 * 60000, provider, credentialVersion: key.version, payload, tokens: estimateTokens(payload, attached?.visuals), ...(attached ? { attachmentReviewId: attached.reviewId, attachmentVisuals: body.includeVisuals === true, attachmentHash: await sha256(JSON.stringify(attached)) } : {}) };
  const previewId = await seal(JSON.stringify(snapshot), env.ASSISTANT_SNAPSHOT_KEY!, "tutor-preview");
  await env.DB.prepare("DELETE FROM assistant_previews WHERE expires_at_ms <= ?").bind(now).run();
  await env.DB.prepare("INSERT INTO assistant_previews (id, account_id, session_hash, visit_id, expires_at_ms) VALUES (?, ?, ?, ?, ?)").bind(snapshot.id, session.account_id, session.token_hash, body.visitId, snapshot.expires).run();
  return json({ previewId, expiresAt: snapshot.expires, provider, payload, visuals: attached?.visuals.map(({ width, height, alt, mimeType }) => ({ width, height, alt, mimeType })) ?? [], neverSent: ["Account profile", "Scores and Study Plan", "Decks", "Current question", "Source PDFs and paths", "Provider credentials and internal references", "Diagnostic logs"], retention: "This conversation ends on sign-out, reload, or closing this browser tab. It is not account history." });
}

async function send(body: Record<string, unknown>, env: AssistantEnv, session: Session, options: Option[], adapter: GeminiAdapter, now: number, requestUrl: string): Promise<Response> {
  if (!bodyHasExactly(body, ["previewId", "visitId", "consent"]) || body.consent !== true || typeof body.previewId !== "string" || typeof body.visitId !== "string") return consentRequired();
  let snapshot: Snapshot;
  try { snapshot = JSON.parse(await unseal(body.previewId, env.ASSISTANT_SNAPSHOT_KEY!, "tutor-preview")); } catch { return consentRequired(); }
  if (snapshot.account !== session.account_id || snapshot.session !== session.token_hash || snapshot.visit !== body.visitId || snapshot.expires <= now) return consentRequired();
  const provider = options.find(o => o.route === snapshot.provider.route && o.model === snapshot.provider.model);
  if (!provider || JSON.stringify(provider) !== JSON.stringify(snapshot.provider)) return consentRequired();
  const key = await routeKey(env, session.account_id, provider);
  if (!key || key.version !== snapshot.credentialVersion) return consentRequired();
  if (snapshot.attachmentReviewId) {
    const currentAttachment = await attachment(env, session.account_id, snapshot.attachmentReviewId, snapshot.attachmentVisuals === true, requestUrl);
    if (currentAttachment instanceof Response) return currentAttachment;
    if (!snapshot.attachmentHash || await sha256(JSON.stringify(currentAttachment)) !== snapshot.attachmentHash) return consentRequired();
  }
  // Atomic consumption precedes quota reservation and network I/O. Duplicate sends,
  // including simultaneous requests, cannot call Gemini twice. Failures need a preview.
  const consumed = await env.DB.prepare("DELETE FROM assistant_previews WHERE id = ? AND account_id = ? AND session_hash = ? AND visit_id = ? AND expires_at_ms > ? RETURNING id")
    .bind(snapshot.id, session.account_id, session.token_hash, body.visitId, now).first();
  if (!consumed) return consentRequired();
  await env.DB.prepare("DELETE FROM assistant_limits WHERE window_ms < ?").bind(Math.floor(now / HOUR) * HOUR).run();
  const retry = Math.ceil((HOUR - now % HOUR) / 1000);
  if (!await reserve(env, `send:${session.account_id}`, snapshot.tokens, 20, 80000, now)) return rateLimitedResponse("rate_limited", retry, now);
  if (provider.route === "shared_gemini" && !await reserve(env, "shared", snapshot.tokens, 100, 400000, now)) return rateLimitedResponse("quota_exhausted", retry, now);
  try {
    const text = await adapter(snapshot.payload, provider.model, key.key);
    if (!text.trim() || text.length > 8000 || text.includes(key.key) || /AIza[0-9A-Za-z_-]{30,}/.test(text)) return failure(502, "blocked_content", "Gemini returned content that cannot be displayed.");
    return json({ text, provider, verified: false });
  } catch (error) {
    const known = error instanceof GeminiFailure ? error : new GeminiFailure("provider_error", 30);
    if (known.code === "quota_exhausted" && provider.route === "shared_gemini") {
      await env.DB.prepare("UPDATE assistant_limits SET requests = 100 WHERE scope = 'shared' AND window_ms = ?").bind(Math.floor(now / HOUR) * HOUR).run();
      return rateLimitedResponse(known.code, retry, now);
    }
    return Response.json({ error: { code: known.code, message: "Gemini could not complete this request. Your draft is preserved. Preview again before retrying.", ...(known.retrySeconds ? { retryAt: now + known.retrySeconds * 1000 } : {}) } }, { status: known.code === "timeout" ? 504 : known.code === "quota_exhausted" ? 429 : 502, headers: { ...noStore, ...(known.retrySeconds ? { "Retry-After": String(known.retrySeconds) } : {}) } });
  }
}

export function assistantRoute(request: Request, env: AssistantEnv, adapter: GeminiAdapter = geminiAdapter, now: () => number = Date.now): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/assistant/")) return null;
  return (async () => {
    if (env.AI_RELEASE_ENABLED !== "true") return failure(404, "ai_disabled", "Tutor Chat is not available in this release.");
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in to open Tutor Chat.");
    if (request.method !== "GET") { const denied = await requireMutation(request, env, session); if (denied) return denied; }
    const blocked = await assessmentBlock(env, session.account_id); if (blocked) return blocked;
    const time = now(); const options = catalog(env, time);
    if (!options.length) return failure(503, "eligibility_required", "Tutor Chat is awaiting a current provider eligibility and failure review.");
     if (request.method === "GET" && path === "/api/assistant/options") {
      const saved = await credential(env, session.account_id);
      return json({ options, credential: saved ? { lastFour: saved.last_four } : null, limits: { priorMessages: 8, promptCharacters: 4000, outputTokens: MAX_OUTPUT, requestsPerHour: 20, reservedTokensPerHour: 80000 } });
     }
     if (request.method === "GET" && path === "/api/assistant/attachments") return attachmentList(env, session.account_id);
    if (request.method !== "POST") return failure(405, "method_not_allowed", "This Tutor Chat action is unavailable.");
    const body = await bodyOf(request, path === "/api/assistant/send" ? MAX_SEND_BODY_BYTES : 70000); if (!body) return invalid();
     if (path === "/api/assistant/preview") return preview(body, env, session, options, time, request.url);
     if (path === "/api/assistant/reasoning-preview") return reasoningPreview(body, env, session, options, time);
     if (path === "/api/assistant/send") return send(body, env, session, options, adapter, time, request.url);
     if (path === "/api/assistant/reasoning-send") return reasoningSend(body, env, session, options, adapter, time);
     if (path === "/api/assistant/flashcards-preview") return flashcardPreview(body, env, session, options, time);
     if (path === "/api/assistant/flashcards-send") return flashcardSend(body, env, session, options, adapter, time);
    if (path === "/api/assistant/credential") {
      if (!bodyHasExactly(body, ["key"]) || typeof body.key !== "string" || !/^[A-Za-z0-9_-]{20,256}$/.test(body.key)) return invalid();
      const encrypted = await seal(body.key, env.ASSISTANT_KEY_KEK!, `credential:${session.account_id}`);
      await env.DB.prepare("INSERT INTO assistant_credentials (account_id, version, ciphertext, last_four) VALUES (?, ?, ?, ?) ON CONFLICT(account_id) DO UPDATE SET version = excluded.version, ciphertext = excluded.ciphertext, last_four = excluded.last_four")
        .bind(session.account_id, crypto.randomUUID(), encrypted, body.key.slice(-4)).run();
      return json({ lastFour: body.key.slice(-4) });
    }
    if (path === "/api/assistant/credential/remove" && bodyHasExactly(body, [])) {
      await env.DB.prepare("DELETE FROM assistant_credentials WHERE account_id = ?").bind(session.account_id).run(); return json({ removed: true });
    }
    return failure(404, "not_found", "This Tutor Chat action is unavailable.");
  })();
}
