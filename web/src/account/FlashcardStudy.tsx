import { useEffect, useRef, useState } from "react";
import { accountFetch, csrfToken } from "./AccountApp";
import { PersonalCards } from "./PersonalCards";
import { deviceZone } from "./satCountdown";

/**
 * Flashcards area (ticket 10): a due study session over Personal Cards and
 * read-only Starter Decks, plus the existing card collection manager.
 * Navigation between cards never creates a rating; only the Not sure / Sure
 * controls do, and only after the back was revealed.
 */

export type CardRating = "not_sure" | "sure";

export type StudyOverview = {
  studyDate: string;
  zone: string;
  zoneSource: "account" | "device" | "default";
  totalDue: number;
  personal: { deck: string; total: number; due: number }[];
  starter: { deckId: string; title: string; version: number; total: number; due: number }[];
};

export type StudyCard = {
  key: string;
  kind: "personal" | "starter";
  front: string;
  dueDate?: string;
  deck: string;
  deckTitle?: string;
  ref: { kind: "personal"; cardId: string } | { kind: "starter"; deckId: string; stableId: string };
  definition?: string;
  vietnamese?: string;
  partOfSpeech?: string;
  pronunciation?: string;
  synonyms?: string;
  example?: string;
  exampleVi?: string;
  level?: string;
};

export type SessionPlan = {
  deck: string | null;
  deckLabel: string;
  total: number;
  studyDate: string;
  zone: string;
  zoneSource: StudyOverview["zoneSource"];
};

const PAGE_SIZE = 25;
const PREFETCH_AHEAD = 5;

type StudyTextField = "definition" | "vietnamese" | "partOfSpeech" | "pronunciation" | "synonyms" | "example" | "exampleVi" | "level";

const BACK_LABELS: [StudyTextField, string][] = [
  ["definition", "Definition"],
  ["vietnamese", "Vietnamese meaning"],
  ["partOfSpeech", "Part of speech"],
  ["pronunciation", "Pronunciation"],
  ["synonyms", "Synonyms"],
  ["example", "Example"],
  ["exampleVi", "Example (Vietnamese)"],
];

/** Long English label for a date-only value, e.g. "Friday, October 2". */
export function studyDateLabel(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", weekday: "long", month: "long", day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

/** Compact English label for chips, e.g. "Sep 28". */
export function dueDateLabel(ymd: string): string {
  const [year, month, day] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC", month: "short", day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function zoneLabel(source: StudyOverview["zoneSource"]): string {
  if (source === "account") return "saved to your account";
  return source === "device" ? "from this device" : "default (UTC)";
}

export function FlashcardsArea({ onSessionEnded }: { onSessionEnded?: () => void }) {
  const [tab, setTab] = useState<"study" | "cards">("study");
  const [plan, setPlan] = useState<SessionPlan | null>(null);
  return <>
    <div className="cards-tabs" role="tablist" aria-label="Flashcards areas">
      <button type="button" role="tab" aria-selected={tab === "study"}
        className={tab === "study" ? "cards-tab cards-tab--active" : "cards-tab"}
        onClick={() => { setTab("study"); }}>Study</button>
      <button type="button" role="tab" aria-selected={tab === "cards"}
        className={tab === "cards" ? "cards-tab cards-tab--active" : "cards-tab"}
        onClick={() => { setTab("cards"); setPlan(null); }}>My cards</button>
    </div>
    {tab === "cards" ? <PersonalCards onSessionEnded={onSessionEnded} /> :
      plan ? <StudySession key={`${plan.deck ?? "all"}:${plan.total}`} plan={plan} onExit={() => setPlan(null)} onSessionEnded={onSessionEnded} /> :
      <StudyHome onStart={setPlan} onSessionEnded={onSessionEnded} onAddCard={() => setTab("cards")} />}
  </>;
}

export function StudyHome({ onStart, onSessionEnded, onAddCard }: {
  onAddCard?: () => void;
  onStart: (plan: SessionPlan) => void;
  onSessionEnded?: () => void;
}) {
  const [overview, setOverview] = useState<StudyOverview | null>(null);
  const [error, setError] = useState(false);

  async function load() {
    setError(false);
    try {
      const response = await accountFetch(`/api/cards/study?zone=${encodeURIComponent(deviceZone())}`);
      if (response.status === 401) { onSessionEnded?.(); return; }
      if (!response.ok) throw new Error("study overview unavailable");
      setOverview(await response.json() as StudyOverview);
    } catch {
      setError(true);
    }
  }

  useEffect(() => { void load(); }, []);

  const starterDue = overview?.starter.reduce((sum, deck) => sum + deck.due, 0) ?? 0;
  const personalDue = overview?.personal.reduce((sum, deck) => sum + deck.due, 0) ?? 0;

  return <section className="cards" aria-labelledby="study-heading">
    <div className="cards-toolbar">
      <div>
        <h2 id="study-heading">Study</h2>
        <p>Review the words that are due today. Your ratings and due dates stay private to your account.</p>
      </div>
    </div>
    {error ? <>
      <p className="cards-notice" role="alert">Your due cards could not be loaded. Check your connection and try again.</p>
      <button type="button" className="study-start" onClick={() => void load()}>Try again</button>
    </> : overview === null ? <p>Loading your study day…</p> : <>
      <p className="study-day">
        Study day: <strong>{studyDateLabel(overview.studyDate)}</strong>
        <span className="cards-chip">{overview.zone} ({zoneLabel(overview.zoneSource)})</span>
      </p>
      {overview.totalDue === 0 ?
        <p className="cards-empty">Nothing is due today. Come back tomorrow — new words and reviews will appear here.</p> :
        <div className="study-start-row">
          <button type="button" className="study-start" onClick={() => onStart({
            deck: null, deckLabel: "All due cards", total: overview.totalDue,
            studyDate: overview.studyDate, zone: overview.zone, zoneSource: overview.zoneSource,
          })}>Start studying ({overview.totalDue})</button>
        </div>}
      {(personalDue > 0 || overview.personal.length > 0) && <div className="study-decks">
        <h3>Your decks</h3>
        <ul>
          {overview.personal.map((deck) => <li key={deck.deck}>
            <span className="study-deck-name">{deck.deck}</span>
            <span>{deck.due} due of {deck.total} cards</span>
            {deck.due > 0 && <button type="button" onClick={() => onStart({
              deck: `personal:${deck.deck}`, deckLabel: deck.deck, total: deck.due,
              studyDate: overview.studyDate, zone: overview.zone, zoneSource: overview.zoneSource,
            })}>Study deck</button>}
          </li>)}
        </ul>
      </div>}
      {(starterDue > 0 || overview.starter.length > 0) && <div className="study-decks">
        <h3>Starter decks</h3>
        <p className="study-decks-note">Shared by Whitebook and the same for every learner. Only your ratings and due dates are private.</p>
        <ul>
          {overview.starter.map((deck) => <li key={deck.deckId}>
            <span className="study-deck-name">{deck.title}</span>
            <span className="cards-chip">v{deck.version}</span>
            <span>{deck.due} due of {deck.total} cards</span>
            {deck.due > 0 && <button type="button" onClick={() => onStart({
              deck: `starter:${deck.deckId}`, deckLabel: deck.title, total: deck.due,
              studyDate: overview.studyDate, zone: overview.zone, zoneSource: overview.zoneSource,
            })}>Study deck</button>}
          </li>)}
        </ul>
      </div>}
    </>}
  </section>;
}

export function StudySession({ plan, onExit, onSessionEnded }: {
  plan: SessionPlan;
  onExit: () => void;
  onSessionEnded?: () => void;
}) {
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [ratings, setRatings] = useState<Map<string, { rating: CardRating; dueDate: string }>>(new Map());
  const [loadError, setLoadError] = useState(false);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const offsetRef = useRef(0);
  const loadingRef = useRef(false);

  async function fetchPage() {
    if (loadingRef.current || cards.length >= plan.total) return;
    loadingRef.current = true;
    try {
      const params = new URLSearchParams({
        zone: plan.zoneSource === "device" ? deviceZone() : plan.zone,
        offset: String(offsetRef.current),
        limit: String(PAGE_SIZE),
      });
      if (plan.deck) params.set("deck", plan.deck);
      const response = await accountFetch(`/api/cards/study/cards?${params.toString()}`);
      if (response.status === 401) { onSessionEnded?.(); return; }
      if (!response.ok) throw new Error("queue unavailable");
      const data = await response.json() as { cards: StudyCard[] };
      setCards((current) => {
        const seen = new Set(current.map((card) => card.key));
        return [...current, ...data.cards.filter((card) => !seen.has(card.key))];
      });
      offsetRef.current += data.cards.length;
      setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => { void fetchPage(); }, []);
  useEffect(() => {
    if (cards.length < plan.total && index > cards.length - PREFETCH_AHEAD) void fetchPage();
  }, [index, cards.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const current = cards[index];
  const ratedCount = ratings.size;
  const finished = ratedCount >= plan.total;

  function reveal() {
    if (current) setRevealed(new Set(revealed).add(current.key));
  }

  async function rate(rating: CardRating) {
    if (!current || busy || !revealed.has(current.key) || ratings.has(current.key)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await accountFetch("/api/cards/study/rate", {
        method: "POST",
        headers: { "X-CSRF-Token": csrfToken(), "Content-Type": "application/json" },
        body: JSON.stringify({ ref: current.ref, rating, requestId: crypto.randomUUID(), zone: plan.zoneSource === "device" ? deviceZone() : undefined }),
      });
      if (response.status === 401) { onSessionEnded?.(); return; }
      if (!response.ok) throw new Error("rating failed");
      const data = await response.json() as { dueDate: string };
      setRatings(new Map(ratings).set(current.key, { rating, dueDate: data.dueDate }));
      setIndex((value) => value + 1);
    } catch {
      setNotice("Your rating was not saved. Check your connection and try again — the card stays in place.");
    } finally {
      setBusy(false);
    }
  }

  const cardFields = (card: StudyCard) => <dl className="cards-fields">
    {BACK_LABELS.map(([field, label]) => card[field] ? <div key={field} className="cards-field"><dt>{label}</dt><dd>{card[field]}</dd></div> : null)}
  </dl>;

  return <section className="cards" aria-labelledby="session-heading">
    <div className="cards-toolbar">
      <div>
        <h2 id="session-heading">{plan.deckLabel}</h2>
        <p>Study day {studyDateLabel(plan.studyDate)} · {plan.zone} ({zoneLabel(plan.zoneSource)})</p>
      </div>
      <div className="cards-toolbar-actions">
        <span className="cards-chip" aria-live="polite">Reviewed {ratedCount} of {plan.total}</span>
        <button type="button" onClick={onExit}>End session</button>
      </div>
    </div>
    {loadError && <p className="cards-notice" role="alert">More due cards could not be loaded. Check your connection and try again.</p>}
    {notice && <p className="cards-notice" role="alert">{notice}</p>}
    {finished ? <div className="study-done">
      <p className="cards-empty">All caught up for today. Rated {ratedCount} cards; the rest are scheduled for their next due dates.</p>
      <button type="button" className="study-start" onClick={onExit}>Back to your study day</button>
    </div> : current === undefined ? <p>Loading your due cards…</p> : <div className="study-card" aria-live="polite">
      <div className="study-card-head">
        <span className="cards-chip">{current.kind === "starter" ? `${current.deckTitle ?? current.deck} (shared)` : current.deck}</span>
        {current.level && <span className="cards-chip">{current.level}</span>}
        {current.dueDate && <span className="cards-chip">Was due {dueDateLabel(current.dueDate)}</span>}
        {ratings.has(current.key) && <span className="cards-chip study-chip-rated">
          Rated {ratings.get(current.key)!.rating === "sure" ? "Sure" : "Not sure"} · next due {dueDateLabel(ratings.get(current.key)!.dueDate)}
        </span>}
      </div>
      <p className="study-front">{current.front}</p>
      {(revealed.has(current.key) || ratings.has(current.key)) && cardFields(current)}
      <div className="study-controls">
        {!revealed.has(current.key) && !ratings.has(current.key) &&
          <button type="button" className="study-reveal" onClick={reveal}>Show answer</button>}
        {revealed.has(current.key) && !ratings.has(current.key) && <>
          <button type="button" className="study-rate study-rate--notsure" disabled={busy} onClick={() => void rate("not_sure")}>Not sure</button>
          <button type="button" className="study-rate study-rate--sure" disabled={busy} onClick={() => void rate("sure")}>Sure</button>
        </>}
      </div>
      <div className="study-nav">
        <button type="button" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>Previous</button>
        <span className="study-position">Card {Math.min(index + 1, plan.total)} of {plan.total}</span>
        <button type="button" disabled={index + 1 >= cards.length && cards.length >= plan.total}
          onClick={() => setIndex((value) => value + 1)}>Next</button>
      </div>
    </div>}
  </section>;
}
