import { useState } from "react";
import { accountFetch, csrfToken } from "./accountClient";
import type { CardRecord } from "./PersonalCards";

const BACK_FIELDS = ["definition", "vietnamese", "partOfSpeech", "pronunciation", "synonyms", "example"] as const;
type BackField = (typeof BACK_FIELDS)[number];
type Draft = { deck: string; front: string } & Record<BackField, string>;
type AssistantOption = { route: string; model: string; languages: string[] };

export type PersonalCardsAssistantProps = {
  cards: CardRecord[]; decks: string[]; onSessionEnded?: () => void; onSaved: () => Promise<void>;
};

export function PersonalCardsAssistant({ cards, decks, onSessionEnded, onSaved }: PersonalCardsAssistantProps) {
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<"draft_cards" | "deck_advice">("draft_cards");
  const [assistantWords, setAssistantWords] = useState("");
  const [assistantContext, setAssistantContext] = useState("");
  const [assistantDeck, setAssistantDeck] = useState("My words");
  const [assistantOptions, setAssistantOptions] = useState<AssistantOption[]>([]);
  const [assistantProvider, setAssistantProvider] = useState("");
  const [assistantPreview, setAssistantPreview] = useState<{ previewId: string; payload: string } | null>(null);
  const [assistantDrafts, setAssistantDrafts] = useState<Draft[]>([]);
  const [assistantCardIds, setAssistantCardIds] = useState<string[]>([]);
  const [assistantAdvice, setAssistantAdvice] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [assistantVisit] = useState(() => crypto.randomUUID());

  async function openAssistant() {
    try {
      const response = await accountFetch("/api/assistant/options");
      if (response.status === 401) { onSessionEnded?.(); return; }
      if (!response.ok) throw new Error("assistant unavailable");
      const data = await response.json() as { options: AssistantOption[] };
      setAssistantOptions(data.options); setAssistantProvider(data.options[0] ? `${data.options[0].route}/${data.options[0].model}` : ""); setAssistantOpen(true);
    } catch { setNotice("Flashcard Assistant is unavailable. Your cards still work normally."); }
  }

  async function previewAssistant() {
    const [route, model] = assistantProvider.split("/");
    if (!route || !model || !assistantWords.trim() || !assistantDeck.trim()) return;
    setBusy(true); setNotice("");
    try {
      const response = await accountFetch("/api/assistant/flashcards-preview", { method: "POST", headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" }, body: JSON.stringify({ visitId: assistantVisit, route, model, locale: "en", mode: assistantMode, words: assistantWords, cardIds: assistantCardIds, context: assistantContext, deck: assistantDeck }) });
      if (!response.ok) throw new Error("preview failed");
      setAssistantPreview(await response.json() as { previewId: string; payload: string });
    } catch { setNotice("The assistant preview could not be created. Your draft is preserved."); }
    finally { setBusy(false); }
  }

  async function sendAssistant() {
    if (!assistantPreview) return;
    setBusy(true);
    try {
      const response = await accountFetch("/api/assistant/flashcards-send", { method: "POST", headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" }, body: JSON.stringify({ previewId: assistantPreview.previewId, visitId: assistantVisit, consent: true }) });
      if (!response.ok) throw new Error("send failed");
      const data = await response.json() as { text: string };
      if (assistantMode === "deck_advice") setAssistantAdvice(data.text);
      else {
        try {
          const parsed = JSON.parse(data.text) as Draft[];
          if (Array.isArray(parsed)) setAssistantDrafts(parsed.slice(0, 20).map(item => ({ deck: assistantDeck, front: String(item.front ?? ""), definition: String(item.definition ?? ""), vietnamese: String(item.vietnamese ?? ""), partOfSpeech: String(item.partOfSpeech ?? ""), pronunciation: String(item.pronunciation ?? ""), synonyms: String(item.synonyms ?? ""), example: String(item.example ?? "") })));
        } catch { setNotice("Gemini returned a draft that needs manual review before editing."); }
      }
      setAssistantPreview(null);
    } catch { setNotice("The assistant request failed. Your reviewed cards and draft remain unchanged."); }
    finally { setBusy(false); }
  }

  async function saveAssistantBatch() {
    setBusy(true);
    try {
      const response = await accountFetch("/api/cards/batch", { method: "POST", headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" }, body: JSON.stringify({ cards: assistantDrafts }) });
      if (!response.ok) throw new Error("batch failed");
      setAssistantDrafts([]); setAssistantOpen(false); setNotice("All reviewed cards were saved."); await onSaved();
    } catch { setNotice("The batch was not saved. Your reviewed drafts are still here."); }
    finally { setBusy(false); }
  }

  return <>
    <button type="button" className="cards-add-button" onClick={() => void openAssistant()}>Flashcard Assistant</button>
    {assistantOpen && <section className="cards-assistant" aria-label="Flashcard Assistant">
      <h3>Flashcard Assistant</h3><p>Draft cards or get visit-only advice for one Personal Deck. Nothing is saved until you review and confirm.</p>
      <label>Action<select value={assistantMode} onChange={event => { setAssistantMode(event.target.value as typeof assistantMode); setAssistantPreview(null); }}><option value="draft_cards">Draft Personal Cards</option><option value="deck_advice">Deck advice</option></select></label>
      <label>Destination Personal Deck<select value={assistantDeck} onChange={event => { setAssistantDeck(event.target.value); setAssistantPreview(null); }}><option value="My words">My words</option>{decks.map(deck => <option key={deck} value={deck}>{deck}</option>)}</select></label>
      <label>Gemini route/model<select value={assistantProvider} onChange={event => { setAssistantProvider(event.target.value); setAssistantPreview(null); }}>{assistantOptions.map(option => <option key={`${option.route}/${option.model}`} value={`${option.route}/${option.model}`}>{option.model}</option>)}</select></label>
      <label>{assistantMode === "draft_cards" ? "Words or phrases" : "Ask about this deck"}<textarea value={assistantWords} onChange={event => { setAssistantWords(event.target.value); setAssistantPreview(null); }} /></label>
      {assistantMode === "draft_cards" && <fieldset><legend>Or select Personal Cards as source words</legend>{cards.map(card => <label key={card.id}><input type="checkbox" checked={assistantCardIds.includes(card.id)} onChange={event => setAssistantCardIds(current => event.target.checked ? [...current, card.id] : current.filter(id => id !== card.id))} /> {card.front}</label>)}</fieldset>}
      <label>Optional context<textarea value={assistantContext} onChange={event => { setAssistantContext(event.target.value); setAssistantPreview(null); }} /></label>
      {assistantPreview ? <div className="cards-assistant__preview"><h4>Review exact send</h4><pre>{JSON.stringify(JSON.parse(assistantPreview.payload), null, 2)}</pre><button type="button" disabled={busy} onClick={() => void sendAssistant()}>I consent — send to Gemini</button><button type="button" disabled={busy} onClick={() => setAssistantPreview(null)}>Cancel preview</button></div> : <button type="button" disabled={busy || !assistantWords.trim()} onClick={() => void previewAssistant()}>Preview assistant request</button>}
      {assistantAdvice && <div className="cards-assistant__advice" role="status"><p>{assistantAdvice}</p><small>Visit-only advice; it is not saved to your account.</small></div>}
      {assistantDrafts.length > 0 && <section aria-label="Reviewed card drafts"><h4>Review drafts</h4>{assistantDrafts.map((item, index) => <div className="cards-assistant__draft" key={index}><input aria-label={`Draft ${index + 1} front`} value={item.front} onChange={event => setAssistantDrafts(current => current.map((draft, i) => i === index ? { ...draft, front: event.target.value } : draft))} /><textarea aria-label={`Draft ${index + 1} definition`} value={item.definition} onChange={event => setAssistantDrafts(current => current.map((draft, i) => i === index ? { ...draft, definition: event.target.value } : draft))} /><button type="button" onClick={() => setAssistantDrafts(current => current.filter((_, i) => i !== index))}>Remove</button></div>)}<button type="button" disabled={busy} onClick={() => void saveAssistantBatch()}>Save all reviewed cards</button></section>}
      <button type="button" disabled={busy} onClick={() => setAssistantOpen(false)}>Close Assistant</button>
    </section>}
    {notice && <p className="cards-notice" role="status">{notice}</p>}
  </>;
}
