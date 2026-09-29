import { useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import type { CardRecord } from "./PersonalCards";

const BACK_FIELDS = ["definition", "vietnamese", "partOfSpeech", "pronunciation", "synonyms", "example"] as const;
type BackField = (typeof BACK_FIELDS)[number];
type Draft = { deck: string; front: string } & Record<BackField, string>;
type AssistantOption = { route: string; model: string; languages: string[]; payer: string; price: string; terms: string; termsUrl: string; termsVersion: string };
const BACK_LABELS: Record<BackField, string> = { definition: "definition", vietnamese: "Vietnamese meaning", partOfSpeech: "part of speech", pronunciation: "pronunciation", synonyms: "synonyms", example: "example" };

function parseDrafts(text: string, deck: string): Draft[] | null {
  const fenced = text.trim().match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const source = fenced?.[1] ?? text.trim();
  try {
    const value = JSON.parse(source) as unknown;
    const rows = Array.isArray(value) ? value : value && typeof value === "object" && "cards" in value && Array.isArray(value.cards) ? value.cards : null;
    if (!rows || rows.length === 0 || rows.length > 20) return null;
    const drafts: Draft[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) return null;
      const item = row as Record<string, unknown>;
      if (typeof item.front !== "string" || !item.front.trim() || BACK_FIELDS.some(field => item[field] !== undefined && typeof item[field] !== "string")) return null;
      const back = Object.fromEntries(BACK_FIELDS.map(field => [field, typeof item[field] === "string" ? item[field] : ""])) as Record<BackField, string>;
      if (!BACK_FIELDS.some(field => back[field].trim())) return null;
      drafts.push({ deck, front: item.front, ...back });
    }
    return drafts;
  } catch { return null; }
}

export type PersonalCardsAssistantProps = {
  cards: CardRecord[]; decks: string[]; onSessionEnded?: () => void; onSaved: () => Promise<void>;
};

export function PersonalCardsAssistant({ cards, decks, onSessionEnded, onSaved }: PersonalCardsAssistantProps) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<"draft_cards" | "deck_advice">("draft_cards");
  const [assistantSource, setAssistantSource] = useState<"words" | "cards">("words");
  const [assistantWords, setAssistantWords] = useState("");
  const [assistantContext, setAssistantContext] = useState("");
  const [assistantDeck, setAssistantDeck] = useState("My words");
  const [assistantOptions, setAssistantOptions] = useState<AssistantOption[]>([]);
  const [assistantProvider, setAssistantProvider] = useState("");
  const [assistantPreview, setAssistantPreview] = useState<{ previewId: string; payload: string; provider: AssistantOption; mode: "draft_cards" | "deck_advice"; deck: string } | null>(null);
  const [assistantDrafts, setAssistantDrafts] = useState<Draft[]>([]);
  const [assistantFindings, setAssistantFindings] = useState<Record<number, string[]>>({});
  const [assistantRawDraft, setAssistantRawDraft] = useState("");
  const [assistantCardIds, setAssistantCardIds] = useState<string[]>([]);
  const [assistantAdvice, setAssistantAdvice] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistantVisit] = useState(() => crypto.randomUUID());
  const assistantProviderDetails = assistantOptions.find(option => `${option.route}/${option.model}` === assistantProvider);
  const canPreview = assistantMode === "deck_advice" ? !!assistantWords.trim() : assistantSource === "words" ? !!assistantWords.trim() : assistantCardIds.length > 0;

  async function openAssistant() {
    setBusy(true);
    setNotice("");
    try {
      const response = await accountFetch("/api/assistant/options");
      if (response.status === 401) { onSessionEnded?.(); return; }
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const code = data.error?.code;
        let message = data.error?.message;
        if (code === "active_section_exam") {
          message = "Finish the active Section Exam before using Flashcard Assistant. AI tools are locked during an exam.";
        } else if (code === "assisted_practice_required") {
          message = "Flashcard Assistant is unavailable during unassisted Practice. Switch to Assisted Practice or complete your Practice Attempt before using the assistant.";
        } else if (code === "eligibility_required" || response.status === 503) {
          message = "Flashcard Assistant is awaiting provider configuration or review.";
        } else if (code === "credential_required") {
          message = "A Gemini credential is required. Save your API key in AI Tutor before using Flashcard Assistant.";
        } else if (response.status === 429 || code === "quota_exhausted" || code === "rate_limited") {
          message = "Flashcard Assistant is temporarily rate limited or at capacity. Please try again shortly.";
        } else {
          message = data.error?.message ?? "Flashcard Assistant is unavailable. Your cards still work normally.";
        }
        setNotice(message);
        return;
      }
      const data = await response.json() as { options: AssistantOption[] };
      setAssistantOptions(data.options);
      setAssistantProvider(data.options[0] ? `${data.options[0].route}/${data.options[0].model}` : "");
      setAssistantOpen(true);
    } catch {
      setNotice("Flashcard Assistant could not connect. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function previewAssistant() {
    const [route, model] = assistantProvider.split("/");
    if (!route || !model || !assistantDeck.trim() || !canPreview) return;
    setBusy(true); setNotice("");
    try {
      const response = await accountFetch("/api/assistant/flashcards-preview", { method: "POST", headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" }, body: JSON.stringify({ visitId: assistantVisit, route, model, locale: "en", mode: assistantMode,
        words: assistantMode === "deck_advice" || assistantSource === "words" ? assistantWords : "",
        cardIds: assistantMode === "draft_cards" && assistantSource === "cards" ? assistantCardIds : [], context: assistantContext, deck: assistantDeck }) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const code = data.error?.code;
        const message = data.error?.message;
        if (response.status === 429 || code === "rate_limited" || code === "quota_exhausted") {
          throw new Error(message ?? "Flashcard Assistant is temporarily rate limited. Your draft is preserved. Try again in a moment.");
        } else if (response.status === 502 || response.status === 503) {
          throw new Error(message ?? "Temporary provider capacity error. Your draft is preserved. Try again in a moment.");
        } else if (code === "active_section_exam" || code === "assisted_practice_required") {
          throw new Error(message ?? "Flashcard Assistant is blocked during an active exam or unassisted practice.");
        } else if (code === "credential_required") {
          throw new Error(message ?? "A Gemini credential is required. Save your API key in AI Tutor before previewing.");
        }
        throw new Error(message ?? "The assistant preview could not be created. Your draft is preserved.");
      }
      const data = await response.json() as { previewId: string; payload: string };
      if (!assistantProviderDetails) throw new Error("provider unavailable");
      setAssistantPreview({ ...data, provider: assistantProviderDetails, mode: assistantMode, deck: assistantDeck });
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "The assistant preview could not be created. Your draft is preserved.");
    } finally { setBusy(false); }
  }

  async function sendAssistant() {
    if (!assistantPreview) return;
    setBusy(true); setNotice("");
    try {
      const response = await accountFetch("/api/assistant/flashcards-send", { method: "POST", headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" }, body: JSON.stringify({ previewId: assistantPreview.previewId, visitId: assistantVisit, consent: true }) });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        const code = data.error?.code;
        const message = data.error?.message;
        if (response.status === 429 || code === "rate_limited" || code === "quota_exhausted") {
          throw new Error(message ?? "Temporary provider capacity or rate limit reached. Your reviewed cards and draft remain unchanged. Please retry shortly.");
        } else if (response.status === 502 || response.status === 503) {
          throw new Error(message ?? "Temporary provider capacity error. Your reviewed cards and draft remain unchanged. Please retry shortly.");
        }
        throw new Error(message ?? "The assistant request failed. Your reviewed cards and draft remain unchanged.");
      }
      const data = await response.json() as { text: string };
      if (assistantMode === "deck_advice") setAssistantAdvice(data.text);
      else {
        const drafts = parseDrafts(data.text, assistantDeck);
        if (drafts) { setAssistantDrafts(drafts); setAssistantRawDraft(""); }
        else { setAssistantRawDraft(data.text); setNotice("Gemini's reply did not match the card format. The complete raw draft is preserved below for manual review."); }
      }
      setAssistantPreview(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "The assistant request failed. Your reviewed cards and draft remain unchanged.");
    } finally { setBusy(false); }
  }

  async function saveAssistantBatch() {
    setBusy(true);
    try {
      const response = await accountFetch("/api/cards/batch", { method: "POST", headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" }, body: JSON.stringify({ cards: assistantDrafts }) });
      const data = await response.json() as { error?: { code?: string; message?: string; duplicates?: Record<string, { front?: string; deck?: string }>; fieldErrors?: Record<string, Record<string, string>> } };
      if (!response.ok) {
        const findings: Record<number, string[]> = {};
        for (const [index, match] of Object.entries(data.error?.duplicates ?? {}))
          findings[Number(index)] = [`Possible duplicate: “${match.front ?? "this word"}” already exists in “${match.deck ?? assistantDeck}”. Edit this draft before saving.`];
        for (const [index, fields] of Object.entries(data.error?.fieldErrors ?? {}))
          findings[Number(index)] = [...(findings[Number(index)] ?? []), ...Object.entries(fields).map(([field, message]) => `${field}: ${message}`)];
        setAssistantFindings(findings); setNotice(data.error?.message ?? "Review the findings for each card before saving."); return;
      }
      setAssistantFindings({}); setAssistantDrafts([]); setAssistantOpen(false); setNotice("All reviewed cards were saved."); await onSaved();
    } catch { setNotice("The batch was not saved. Your reviewed drafts are still here."); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className="cards-add-button" onClick={() => void openAssistant()}>Flashcard Assistant</button>
    {assistantOpen && <section className="cards-assistant" aria-label="Flashcard Assistant">
      <h3>Flashcard Assistant</h3><p>Draft cards or get visit-only advice for one Personal Deck. Nothing is saved until you review and confirm.</p>
      <label>Action<select value={assistantMode} onChange={event => { setAssistantMode(event.target.value as typeof assistantMode); setAssistantPreview(null); }}><option value="draft_cards">Draft Personal Cards</option><option value="deck_advice">Deck advice</option></select></label>
      {assistantMode === "draft_cards" ? <label>Destination Personal Deck<input list="personal-card-decks" value={assistantDeck} maxLength={80} onChange={event => { setAssistantDeck(event.target.value); setAssistantPreview(null); }} />
        <datalist id="personal-card-decks"><option value="My words" />{decks.map(deck => <option key={deck} value={deck} />)}</datalist></label>
        : <label>Personal Deck for advice<select value={assistantDeck} onChange={event => { setAssistantDeck(event.target.value); setAssistantPreview(null); }}><option value="My words">My words</option>{decks.map(deck => <option key={deck} value={deck}>{deck}</option>)}</select></label>}
      <label>Gemini route/model<select value={assistantProvider} onChange={event => { setAssistantProvider(event.target.value); setAssistantPreview(null); }}>{assistantOptions.map(option => <option key={`${option.route}/${option.model}`} value={`${option.route}/${option.model}`}>{option.model}</option>)}</select></label>
      {assistantMode === "draft_cards" && <fieldset><legend>Source words</legend>
        <label><input type="radio" name="assistant-source" checked={assistantSource === "words"} onChange={() => { setAssistantSource("words"); setAssistantPreview(null); }} /> Paste words or phrases</label>
        <label><input type="radio" name="assistant-source" checked={assistantSource === "cards"} onChange={() => { setAssistantSource("cards"); setAssistantPreview(null); }} /> Select Personal Cards</label>
      </fieldset>}
      {(assistantMode === "deck_advice" || assistantSource === "words") && <label>{assistantMode === "draft_cards" ? "Words or phrases" : "Ask about this deck"}<textarea value={assistantWords} onChange={event => { setAssistantWords(event.target.value); setAssistantPreview(null); }} /></label>}
      {assistantMode === "draft_cards" && assistantSource === "cards" && <fieldset><legend>Choose source Personal Cards</legend>{cards.filter(card => !card.archived).map(card => <label key={card.id}><input type="checkbox" checked={assistantCardIds.includes(card.id)} onChange={event => { setAssistantCardIds(current => event.target.checked ? [...current, card.id] : current.filter(id => id !== card.id)); setAssistantPreview(null); }} /> {card.front}</label>)}</fieldset>}
      <label>Optional context<textarea value={assistantContext} onChange={event => { setAssistantContext(event.target.value); setAssistantPreview(null); }} /></label>
      {assistantPreview ? <div className="cards-assistant__preview"><h4>Review exact send</h4>
        <dl><div><dt>Personal Deck</dt><dd>{assistantPreview.deck}</dd></div><div><dt>Gemini route and model</dt><dd>{assistantPreview.provider.route} · {assistantPreview.provider.model}</dd></div>
          <div><dt>Who pays</dt><dd>{assistantPreview.provider.payer}</dd></div><div><dt>Price</dt><dd>{assistantPreview.provider.price}</dd></div>
          <div><dt>Terms</dt><dd>{assistantPreview.provider.terms} · <a href={assistantPreview.provider.termsUrl} target="_blank" rel="noreferrer">Gemini terms</a> ({assistantPreview.provider.termsVersion})</dd></div></dl>
        <pre aria-label="Exact Flashcard Assistant request">{JSON.stringify(JSON.parse(assistantPreview.payload), null, 2)}</pre>
        <button type="button" disabled={busy} onClick={() => void sendAssistant()}>I consent — send to Gemini</button><button type="button" disabled={busy} onClick={() => setAssistantPreview(null)}>Cancel preview</button></div>
        : <button type="button" disabled={busy || !canPreview || !assistantProviderDetails} onClick={() => void previewAssistant()}>Preview assistant request</button>}
      {assistantAdvice && <div className="cards-assistant__advice" role="status"><p>{assistantAdvice}</p><small>Visit-only advice; it is not saved to your account.</small></div>}
      {assistantRawDraft && <section aria-label="Unparsed assistant draft"><p role="alert">The assistant draft could not be parsed into cards.</p><pre aria-label="Raw assistant draft">{assistantRawDraft}</pre></section>}
      {assistantDrafts.length > 0 && <section aria-label="Reviewed card drafts"><h4>Review drafts</h4>{assistantDrafts.map((item, index) => <div className="cards-assistant__draft" key={index}>
        <label>Draft {index + 1} front<input aria-label={`Draft ${index + 1} front`} value={item.front} onChange={event => { setAssistantDrafts(current => current.map((draft, i) => i === index ? { ...draft, front: event.target.value } : draft)); setAssistantFindings(current => ({ ...current, [index]: [] })); }} /></label>
        {BACK_FIELDS.map(field => <label key={field}>Draft {index + 1} {BACK_LABELS[field]}<textarea aria-label={`Draft ${index + 1} ${field}`} value={item[field]} onChange={event => { setAssistantDrafts(current => current.map((draft, i) => i === index ? { ...draft, [field]: event.target.value } : draft)); setAssistantFindings(current => ({ ...current, [index]: [] })); }} /></label>)}
        {!!assistantFindings[index]?.length && <ul role="alert" aria-label={`Draft ${index + 1} findings`}>{assistantFindings[index].map((finding, findingIndex) => <li key={findingIndex}>{finding}</li>)}</ul>}
        <button type="button" disabled={busy} onClick={() => { setAssistantDrafts(current => current.filter((_, i) => i !== index)); setAssistantFindings({}); }}>Remove draft {index + 1}</button>
      </div>)}<button type="button" disabled={busy} onClick={() => void saveAssistantBatch()}>Save all reviewed cards</button></section>}
      <button type="button" disabled={busy} onClick={() => setAssistantOpen(false)}>Close Assistant</button>
    </section>}
    {notice && <div className="cards-notice-row"><p className="cards-notice" role="status">{notice}</p>{!assistantOpen && (notice.includes("rate limited") || notice.includes("capacity") || notice.includes("could not connect") || notice.includes("awaiting provider") || notice.includes("credential")) && <button type="button" className="cards-notice-retry" disabled={busy} onClick={() => void openAssistant()}>Retry</button>}</div>}
  </>;
}
