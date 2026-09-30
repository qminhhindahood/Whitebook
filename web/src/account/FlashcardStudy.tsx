import { useEffect, useRef, useState } from "react";
import { accountFetch, csrfToken } from "./AccountApp";
import { PersonalCards } from "./PersonalCards";
import { deviceZone } from "./satCountdown";
import "./flashcard-experience.css";

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

export function FlashcardsArea({ onSessionEnded, learnerName }: { onSessionEnded?: () => void; learnerName?: string }) {
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
    {tab === "cards" ? <PersonalCards onSessionEnded={onSessionEnded} learnerName={learnerName} /> :
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
  const [query, setQuery] = useState("");

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

  const decks = overview ? [
    ...overview.personal.map(deck => ({ key: `personal:${deck.deck}`, title: deck.deck, total: deck.total, due: deck.due, shared: false })),
    ...overview.starter.map(deck => ({ key: `starter:${deck.deckId}`, title: deck.title, total: deck.total, due: deck.due, shared: true })),
  ].filter(deck => deck.title.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim())) : [];
  const start = (deck: string | null, deckLabel: string, total: number) => {
    if (overview) onStart({ deck, deckLabel, total, studyDate: overview.studyDate, zone: overview.zone, zoneSource: overview.zoneSource });
  };

  return <section className="cards wb-flash-home" aria-labelledby="study-heading">
    <div className="wb-flash-home__intro"><div><span className="wb-flash-eyebrow">Your word collection</span><h2 id="study-heading">Study</h2>
      <p>Choose a deck and make a little progress today.</p></div>
      <button type="button" className="wb-flash-home__new" onClick={onAddCard}>Manage my cards</button></div>
    {error ? <>
      <p className="cards-notice" role="alert">Your due cards could not be loaded. Check your connection and try again.</p>
      <button type="button" className="study-start" onClick={() => void load()}>Try again</button>
    </> : overview === null ? <p>Loading your study day…</p> : <>
      <div className="wb-flash-due"><div><strong>Ready for today</strong><p>{overview.totalDue ? `${overview.totalDue} words are due — including new words and your 1-day and 4-day reviews.` : "Nothing is due today. Your next review will appear here."}</p>
        <small>Study day {studyDateLabel(overview.studyDate)} · {overview.zone} ({zoneLabel(overview.zoneSource)})</small></div>
        {overview.totalDue > 0 && <button type="button" className="study-start" onClick={() => start(null, "All due cards", overview.totalDue)}>Start studying ({overview.totalDue})</button>}</div>
      <div className="wb-flash-search"><label htmlFor="flashcard-deck-search">Find a deck</label><input id="flashcard-deck-search" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search your decks…" /></div>
      {[true, false].map(shared => <section key={String(shared)} className="wb-flash-deck-group" aria-label={shared ? "Starter Decks" : "Personal Cards"}>
      <div className="wb-flash-home__section-head"><h3>{shared ? "Starter Decks" : "Personal Cards"}</h3><span>{decks.filter(deck => deck.shared === shared).length} shown</span></div>
      <div className="wb-flash-decks">
        {decks.filter(deck => deck.shared === shared).map((deck, position) => <article key={deck.key} className={`wb-flash-deck wb-flash-deck--${position % 4}`}>
          <div><span className="wb-flash-deck__kind">{deck.shared ? "Starter deck" : "Personal deck"}</span><h4>{deck.title}</h4></div>
          <div className="wb-flash-deck__bottom"><span>{deck.total} cards</span><span>{deck.due} due of {deck.total} cards</span>
            {deck.due > 0 && <button type="button" aria-label={`Study deck ${deck.title}`} onClick={() => start(deck.key, deck.title, deck.due)}>Study deck <span aria-hidden="true">↗</span></button>}</div>
        </article>)}
      </div>
      {!shared && overview.personal.length === 0 && <p className="cards-empty">You have no personal cards yet. Manage my cards to add your own; Starter Decks are ready above.</p>}
      </section>)}
      {decks.length === 0 && query.trim() && <p className="cards-empty">No decks match your search.</p>}
      <p className="study-decks-note">Starter decks are shared by Whitebook. Only your ratings and due dates are private.</p>
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

  const cardFields = (card: StudyCard) => <div className="wb-flash-answer">
    {card.pronunciation && <p className="wb-flash-answer__pronunciation">{card.pronunciation}</p>}
    {card.vietnamese && <p className="wb-flash-answer__meaning">{card.vietnamese}</p>}
    {card.definition && <p className="wb-flash-answer__definition">{card.definition}</p>}
    {card.synonyms && <div className="wb-flash-answer__synonyms"><strong>Synonyms</strong><div>{card.synonyms.split(/[,;]+/).filter(Boolean).map(term => <span key={term.trim()}>{term.trim()}</span>)}</div></div>}
    {card.example && <div className="wb-flash-answer__example"><strong>In context</strong><p>{card.example}</p>{card.exampleVi && <p>{card.exampleVi}</p>}</div>}
    {BACK_LABELS.filter(([field]) => !["definition", "vietnamese", "pronunciation", "synonyms", "example", "exampleVi"].includes(field)).map(([field, label]) => card[field] ? <p key={field} className="wb-flash-answer__extra"><strong>{label}:</strong> {card[field]}</p> : null)}
  </div>;

  return <section className="cards wb-flash-session" aria-labelledby="session-heading">
    <header className="wb-flash-session__header"><div className="wb-flash-session__title"><span>Flashcards</span><span aria-hidden="true">·</span><h2 id="session-heading">{plan.deckLabel}</h2></div>
      <button type="button" onClick={onExit}>Exit session</button></header>
    <div className="wb-flash-session__body">
    {loadError && <p className="cards-notice" role="alert">More due cards could not be loaded. Check your connection and try again.</p>}
    {notice && <p className="cards-notice" role="alert">{notice}</p>}
    {finished ? <div className="study-done">
      <p className="cards-empty">All caught up for today. Rated {ratedCount} cards; the rest are scheduled for their next due dates.</p>
      <button type="button" className="study-start" onClick={onExit}>Back to your study day</button>
    </div> : current === undefined ? <p role="status">Loading your due cards…</p> : <div className="wb-flash-session__stage">
      <span className="wb-flash-session__position">Study session · Card {Math.min(index + 1, plan.total)} of {plan.total}</span>
      <div className={`study-card wb-flash-study-card${revealed.has(current.key) ? " wb-flash-study-card--back" : ""}`} aria-live="polite">
        <div className="study-card-head">
          {current.level && <span className="cards-chip">{current.level}</span>}
          {current.dueDate && <span className="cards-chip">Was due {dueDateLabel(current.dueDate)}</span>}
          {ratings.has(current.key) && <span className="cards-chip study-chip-rated">
          Rated {ratings.get(current.key)!.rating === "sure" ? "Sure" : "Not sure"} · next due {dueDateLabel(ratings.get(current.key)!.dueDate)}
          </span>}
        </div>
        {!revealed.has(current.key) && !ratings.has(current.key) ? <button type="button" className="wb-flash-study-card__front" onClick={reveal} aria-label="Flip card"><span>{current.front}</span><small>Tap to see meaning</small></button> : <><p className="study-front">{current.front}{current.partOfSpeech && <small> {current.partOfSpeech}</small>}</p>{cardFields(current)}</>}
      </div>
      <div className="study-controls">
        {!revealed.has(current.key) && !ratings.has(current.key) && <button type="button" className="study-reveal" onClick={reveal}>Show answer</button>}
        {revealed.has(current.key) && !ratings.has(current.key) && <>
          <button type="button" className="study-rate study-rate--notsure" aria-label="Not sure" disabled={busy} onClick={() => void rate("not_sure")}>Not sure <small>Review in 1 day</small></button>
          <button type="button" className="study-rate study-rate--sure" aria-label="Sure" disabled={busy} onClick={() => void rate("sure")}>Sure <small>Review in 4 days</small></button>
        </>}
      </div>
      <div className="wb-flash-progress"><div role="progressbar" aria-label="Cards reviewed" aria-valuenow={ratedCount} aria-valuemin={0} aria-valuemax={plan.total} style={{ width: `${Math.max(2, ratedCount / plan.total * 100)}%` }} /></div>
      </div>}
    </div>
    <footer className="wb-flash-session__footer"><span className="wb-flash-session__reviewed" aria-live="polite">Reviewed {ratedCount} of {plan.total}</span>
      <div className="study-nav"><button type="button" disabled={index === 0 || finished} onClick={() => setIndex(value => value - 1)}>Previous</button>
      <span className="study-position">Card {Math.min(index + 1, plan.total)} of {plan.total}</span>
      <button type="button" disabled={finished || index + 1 >= cards.length && cards.length >= plan.total} onClick={() => setIndex(value => value + 1)}>Next</button></div></footer>
  </section>;
}
