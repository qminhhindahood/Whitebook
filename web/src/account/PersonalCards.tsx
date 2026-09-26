import { useEffect, useState } from "react";
import { accountFetch, csrfToken } from "./AccountApp";

export type CardRecord = {
  id: string;
  deck: string;
  front: string;
  definition?: string;
  vietnamese?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  synonyms?: string;
  example?: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
};

type DuplicateMatch = { id: string; deck: string; front: string; archived: boolean; definition?: string; vietnamese?: string };
type FieldErrors = Record<string, string>;

const BACK_FIELDS = ["definition", "vietnamese", "partOfSpeech", "pronunciation", "synonyms", "example"] as const;
type BackField = (typeof BACK_FIELDS)[number];
const BACK_LABELS: Record<BackField, string> = {
  definition: "Definition",
  vietnamese: "Vietnamese meaning",
  partOfSpeech: "Part of speech",
  pronunciation: "Pronunciation",
  synonyms: "Synonyms",
  example: "Example",
};
const FIELD_LABELS: Record<string, string> = { front: "Word or phrase", deck: "Deck", back: "Back fields", ...BACK_LABELS };

type Draft = { deck: string; front: string } & Record<BackField, string>;
const emptyDraft = (): Draft => ({ deck: "", front: "", definition: "", vietnamese: "", partOfSpeech: "", pronunciation: "", synonyms: "", example: "" });

type Editor = { mode: "create" } | { mode: "edit"; card: CardRecord } | { mode: "move"; card: CardRecord };

const FIELD_ORDER: BackField[] = ["definition", "vietnamese", "partOfSpeech", "pronunciation", "synonyms", "example"];

function CardFields({ card }: { card: CardRecord }) {
  return <dl className="cards-fields">
    {FIELD_ORDER.map((field) => card[field] ? <div key={field} className="cards-field"><dt>{BACK_LABELS[field]}</dt><dd>{card[field]}</dd></div> : null)}
  </dl>;
}

export function PersonalCards({ onSessionEnded }: { onSessionEnded?: () => void }) {
  const [cards, setCards] = useState<CardRecord[] | null>(null);
  const [archivedCards, setArchivedCards] = useState<CardRecord[]>([]);
  const [decks, setDecks] = useState<string[]>([]);
  const [deckFilter, setDeckFilter] = useState("all");
  const [view, setView] = useState<"active" | "archived">("active");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [moveDeck, setMoveDeck] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [warning, setWarning] = useState<DuplicateMatch | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [active, archived] = await Promise.all([accountFetch("/api/cards"), accountFetch("/api/cards?archived=1")]);
      if (active.status === 401 || archived.status === 401) { onSessionEnded?.(); return; }
      if (!active.ok || !archived.ok) throw new Error("cards unavailable");
      const activeData = await active.json() as { decks: string[]; cards: CardRecord[] };
      const archivedData = await archived.json() as { cards: CardRecord[] };
      setCards(activeData.cards);
      setDecks(activeData.decks);
      setArchivedCards(archivedData.cards);
    } catch {
      setCards([]);
      setArchivedCards([]);
      setNotice("Your cards could not be loaded. Check your connection and try again.");
    }
  }

  useEffect(() => { void load(); }, []);

  async function mutate(path: string, method: string, body?: unknown): Promise<Response> {
    return accountFetch(path, {
      method,
      headers: { "X-CSRF-Token": csrfToken(), ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }

  function startCreate() {
    setEditor({ mode: "create" });
    setDraft(emptyDraft());
    setFieldErrors({});
    setWarning(null);
    setNotice("");
  }

  function startEdit(card: CardRecord) {
    setEditor({ mode: "edit", card });
    setDraft({ deck: card.deck, front: card.front, definition: card.definition ?? "", vietnamese: card.vietnamese ?? "", partOfSpeech: card.partOfSpeech ?? "", pronunciation: card.pronunciation ?? "", synonyms: card.synonyms ?? "", example: card.example ?? "" });
    setFieldErrors({});
    setWarning(null);
    setNotice("");
  }

  function startMove(card: CardRecord) {
    setEditor({ mode: "move", card });
    setMoveDeck(card.deck);
    setFieldErrors({});
    setWarning(null);
    setNotice("");
  }

  function closeEditor() {
    setEditor(null);
    setWarning(null);
    setFieldErrors({});
  }

  function clientErrors(): FieldErrors {
    const errors: FieldErrors = {};
    if (editor?.mode === "move") {
      if (!moveDeck.trim()) errors.deck = "Name the deck to move the card into.";
      return errors;
    }
    if (!draft.front.trim()) errors.front = "Add the word or phrase for the front of the card.";
    if (!BACK_FIELDS.some((field) => draft[field].trim())) errors.back = "Add at least one back field, such as a definition or Vietnamese meaning.";
    return errors;
  }

  async function duplicateFor(deck: string, front: string, excludeId?: string): Promise<DuplicateMatch | null> {
    const params = new URLSearchParams({ deck, front });
    if (excludeId) params.set("exclude", excludeId);
    const response = await accountFetch(`/api/cards/duplicates?${params.toString()}`);
    if (!response.ok) return null;
    const data = await response.json() as { matches: DuplicateMatch[] };
    return data.matches[0] ?? null;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!editor || busy) return;
    const errors = clientErrors();
    if (Object.keys(errors).length) { setFieldErrors(errors); setWarning(null); return; }
    setFieldErrors({});
    setBusy(true);
    try {
      if (editor.mode === "create") {
        if (!warning) {
          const duplicate = await duplicateFor(draft.deck.trim() || "My words", draft.front.trim());
          if (duplicate) { setWarning(duplicate); return; }
        }
        const response = await mutate("/api/cards", "POST", { ...draft, confirm: true });
        if (response.status === 401) { onSessionEnded?.(); return; }
        if (!response.ok) throw new Error("create failed");
        setNotice("Card saved to your account.");
      } else if (editor.mode === "edit") {
        if (draft.front.trim() !== editor.card.front && !warning) {
          const duplicate = await duplicateFor(editor.card.deck, draft.front.trim(), editor.card.id);
          if (duplicate) { setWarning(duplicate); return; }
        }
        const response = await mutate(`/api/cards/${editor.card.id}`, "PATCH", draft);
        if (response.status === 401) { onSessionEnded?.(); return; }
        if (!response.ok) throw new Error("edit failed");
        setNotice("Card updated. Its history stays with the card.");
      } else {
        if (!warning) {
          const duplicate = await duplicateFor(moveDeck.trim(), editor.card.front, editor.card.id);
          if (duplicate) { setWarning(duplicate); return; }
        }
        const response = await mutate(`/api/cards/${editor.card.id}/move`, "POST", { deck: moveDeck.trim(), confirm: true });
        if (response.status === 401) { onSessionEnded?.(); return; }
        if (!response.ok) throw new Error("move failed");
        setNotice(`Card moved to “${moveDeck.trim()}”.`);
      }
      closeEditor();
      await load();
    } catch {
      setNotice("The card was not saved. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function toggleArchive(card: CardRecord) {
    if (busy) return;
    setBusy(true);
    setWarning(null);
    try {
      const response = await mutate(`/api/cards/${card.id}/${card.archived ? "restore" : "archive"}`, "POST");
      if (response.status === 401) { onSessionEnded?.(); return; }
      if (!response.ok) throw new Error("archive failed");
      setNotice(card.archived ? "Card restored to your decks." : "Card archived. It is kept but no longer appears for study.");
      await load();
    } catch {
      setNotice("The card was not updated. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  async function confirmAnyway() {
    setBusy(true);
    try {
      if (!editor) return;
      if (editor.mode === "create") {
        const response = await mutate("/api/cards", "POST", { ...draft, confirm: true });
        if (response.status === 401) { onSessionEnded?.(); return; }
        if (!response.ok) throw new Error("create failed");
        setNotice("Card saved to your account.");
      } else if (editor.mode === "edit") {
        const response = await mutate(`/api/cards/${editor.card.id}`, "PATCH", draft);
        if (response.status === 401) { onSessionEnded?.(); return; }
        if (!response.ok) throw new Error("edit failed");
        setNotice("Card updated. Its history stays with the card.");
      } else {
        const response = await mutate(`/api/cards/${editor.card.id}/move`, "POST", { deck: moveDeck.trim(), confirm: true });
        if (response.status === 401) { onSessionEnded?.(); return; }
        if (!response.ok) throw new Error("move failed");
        setNotice(`Card moved to “${moveDeck.trim()}”.`);
      }
      closeEditor();
      await load();
    } catch {
      setNotice("The card was not saved. Check your connection and try again.");
    } finally { setBusy(false); }
  }

  function errorText(field: string): string | undefined {
    return fieldErrors[field];
  }

  function fieldRow(id: string, errorKey: string, label: string, value: string, onChange: (value: string) => void, options?: { maxLength?: number; textarea?: boolean }) {
    const error = fieldErrors[errorKey];
    const shared = { id, value, maxLength: options?.maxLength, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), "aria-invalid": error ? true : undefined };
    return <div className={`cards-form-field${error ? " cards-form-field--error" : ""}`}>
      <label htmlFor={id}>{label}</label>
      {options?.textarea ? <textarea {...shared} rows={2} /> : <input {...shared} />}
      {error && <p className="cards-field-error" role="alert">{error}</p>}
    </div>;
  }

  const editing = editor?.mode === "create" || editor?.mode === "edit";
  const shownCards = (view === "archived" ? archivedCards : cards ?? [])
    .filter((card) => deckFilter === "all" || card.deck === deckFilter);

  return <section className="cards" aria-labelledby="cards-heading">
    <div className="cards-toolbar">
      <div>
        <h2 id="cards-heading">Flashcards</h2>
        <p>Your personal vocabulary. Cards stay private to your account and follow you across devices.</p>
      </div>
      <div className="cards-toolbar-actions">
        <label className="cards-filter" htmlFor="cards-deck-filter">Deck</label>
        <select id="cards-deck-filter" value={deckFilter} onChange={(event) => setDeckFilter(event.target.value)}>
          <option value="all">All decks</option>
          {decks.map((deck) => <option key={deck} value={deck}>{deck}</option>)}
        </select>
        <select aria-label="Card list" value={view} onChange={(event) => setView(event.target.value as "active" | "archived")}>
          <option value="active">Studying</option>
          <option value="archived">Archived</option>
        </select>
        <button type="button" className="cards-add-button" onClick={startCreate}>Add card</button>
      </div>
    </div>
    {notice && <p className="cards-notice" role="status">{notice}</p>}
    {editing && <form className="cards-form" onSubmit={submit} noValidate>
      <h3>{editor?.mode === "create" ? "Add a card" : "Edit card"}</h3>
      <div className="cards-form-grid">
        {fieldRow("card-front", "front", "Word or phrase (front)", draft.front, (value) => setDraft((current) => ({ ...current, front: value })), { maxLength: 240 })}
        {fieldRow("card-deck", "deck", "Deck (defaults to “My words”)", draft.deck, (value) => setDraft((current) => ({ ...current, deck: value })), { maxLength: 80 })}
        {FIELD_ORDER.map((field) => fieldRow(`card-${field}`, field, `${BACK_LABELS[field]} (back)`, draft[field], (value) => setDraft((current) => ({ ...current, [field]: value })), { maxLength: 2000, textarea: true }))}
      </div>
      {errorText("back") && <p className="cards-field-error" role="alert">{errorText("back")}</p>}
      <div className="cards-form-actions">
        <button type="submit" disabled={busy}>{editor?.mode === "create" ? "Save card" : "Save changes"}</button>
        <button type="button" disabled={busy} onClick={closeEditor}>Cancel</button>
      </div>
    </form>}
    {editor?.mode === "move" && <form className="cards-form" onSubmit={submit} noValidate>
      <h3>Move “{editor.card.front}”</h3>
      {fieldRow("card-move-deck", "deck", "New deck", moveDeck, setMoveDeck, { maxLength: 80 })}
      <div className="cards-form-actions">
        <button type="submit" disabled={busy}>Move card</button>
        <button type="button" disabled={busy} onClick={closeEditor}>Cancel</button>
      </div>
    </form>}
    {warning && <div className="cards-warning" role="alert">
      <p>“{warning.front}” already looks like a card in “{warning.deck}”{warning.archived ? " (archived)" : ""}. Check the existing card before saving so different senses stay separate.</p>
      {warning.definition && <p>Existing definition: {warning.definition}</p>}
      {warning.vietnamese && <p>Existing Vietnamese meaning: {warning.vietnamese}</p>}
      <div className="cards-form-actions">
        <button type="button" disabled={busy} onClick={confirmAnyway}>Save anyway</button>
        <button type="button" disabled={busy} onClick={() => setWarning(null)}>Go back</button>
      </div>
    </div>}
    {cards === null ? <p>Loading your cards…</p> : shownCards.length === 0 ?
      <p className="cards-empty">{view === "archived" ? "No archived cards." : "You have no cards here yet. Add your first word."}</p> :
      <ul className="cards-list">
        {shownCards.map((card) => <li key={card.id} className="cards-item">
          <div className="cards-item-main">
            <h3 className="cards-front">{card.front}</h3>
            <span className="cards-chip">{card.deck}{card.archived ? " · archived" : ""}</span>
          </div>
          <CardFields card={card} />
          {editor?.mode === "move" && editor.card.id === card.id ? null :
            <div className="cards-item-actions">
              {!card.archived && <button type="button" onClick={() => startEdit(card)}>Edit</button>}
              {!card.archived && <button type="button" onClick={() => startMove(card)}>Move</button>}
              <button type="button" onClick={() => toggleArchive(card)}>{card.archived ? "Restore" : "Archive"}</button>
            </div>}
        </li>)}
      </ul>}
  </section>;
}
