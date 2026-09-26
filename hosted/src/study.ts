import { currentSession, failure, json, requireMutation, type AccountEnv, type Session } from "./accounts";
import { isCardRating, isValidZone, localCalendarDate, nextDueDate, type CardRating } from "./schedule";

/**
 * Due flashcards and read-only Starter Decks (ticket 10).
 *
 * Schedules live on the Learner Account: current due state is derived from
 * each card's latest rating event, so a zone change can never rewrite a
 * stored due date and a retried rating request (same requestId) can never be
 * applied twice. Starter Deck content is shared read-only rows imported from
 * the owner-reviewed bundle; ratings against it are account-private.
 */

const BODY_MAX = 4096;
const REQUEST_ID_MAX = 100;
const CARD_ID_MAX = 64;
const PAGE_DEFAULT = 25;
const PAGE_MAX = 50;

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

type Zone = { zone: string; source: "account" | "device" | "default" };

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function effectiveZone(env: AccountEnv, accountId: string, suppliedZone: string | null): Promise<Zone | Response> {
  const row = await env.DB.prepare("SELECT time_zone FROM learner_accounts WHERE id = ?")
    .bind(accountId).first<{ time_zone: string }>();
  const saved = row?.time_zone?.trim();
  if (saved && isValidZone(saved)) return { zone: saved, source: "account" };
  if (saved) return { zone: "UTC", source: "default" };
  if (suppliedZone !== null) {
    if (!isValidZone(suppliedZone))
      return failure(400, "invalid_zone", "That time zone is not a valid IANA name.");
    return { zone: suppliedZone, source: "device" };
  }
  return { zone: "UTC", source: "default" };
}

type DeckFilter = { personalDeckKey?: string; starterDeckId?: string };

function parseDeckFilter(raw: string | null): DeckFilter | Response {
  if (!raw || raw === "all") return {};
  const [kind, ...rest] = raw.split(":");
  const value = rest.join(":").trim();
  if (kind === "personal" && value) {
    if (value.length > 80) return failure(400, "invalid_request", "That deck filter is too long.");
    return { personalDeckKey: normalize(value) };
  }
  if (kind === "starter" && value) {
    if (!/^[a-z0-9_]{1,80}$/.test(value))
      return failure(400, "invalid_request", "That deck filter is not a starter deck.");
    return { starterDeckId: value };
  }
  return failure(400, "invalid_request", "Deck filters look like “personal:Deck name” or “starter:deck_id”.");
}

const PERSONAL_LATEST_EVENTS = `SELECT card_id, next_due FROM (
  SELECT card_id, next_due, ROW_NUMBER() OVER (PARTITION BY card_id ORDER BY rated_at DESC, rowid DESC) AS rn
  FROM card_rating_events WHERE account_id = ?) WHERE rn = 1`;
const STARTER_LATEST_EVENTS = `SELECT deck_id, stable_id, next_due FROM (
  SELECT deck_id, stable_id, next_due, ROW_NUMBER() OVER (PARTITION BY deck_id, stable_id ORDER BY rated_at DESC, rowid DESC) AS rn
  FROM starter_card_rating_events WHERE account_id = ?) WHERE rn = 1`;
const CURRENT_STARTER_VERSIONS = `SELECT deck_id, MAX(version) AS version FROM starter_deck_versions WHERE status = 'published' GROUP BY deck_id`;

async function personalDeckCounts(env: AccountEnv, accountId: string, today: string, filter: DeckFilter) {
  const rows = await env.DB.prepare(
    `SELECT c.deck AS deck, COUNT(*) AS total,
       SUM(CASE WHEN l.next_due IS NULL OR l.next_due <= ? THEN 1 ELSE 0 END) AS due
     FROM personal_cards c
     LEFT JOIN (${PERSONAL_LATEST_EVENTS}) l ON l.card_id = c.id
     WHERE c.account_id = ? AND c.archived_at IS NULL${filter.personalDeckKey ? " AND c.deck_key = ?" : ""}
     GROUP BY c.deck ORDER BY c.deck`,
  ).bind(...(filter.personalDeckKey
    ? [today, accountId, accountId, filter.personalDeckKey]
    : [today, accountId, accountId])).all();
  return rows.results as { deck: string; total: number; due: number }[];
}

async function starterDeckCounts(env: AccountEnv, accountId: string, today: string, filter: DeckFilter) {
  // Placeholder order in the SQL text: the due comparison in the SELECT list,
  // the latest-events join, then the optional deck filter.
  const rows = await env.DB.prepare(
    `SELECT v.deck_id, v.title, v.version, COUNT(*) AS total,
       SUM(CASE WHEN l.next_due IS NULL OR l.next_due <= ? THEN 1 ELSE 0 END) AS due
     FROM starter_deck_cards k
     JOIN starter_deck_versions v ON v.deck_id = k.deck_id AND v.version = k.version
     JOIN (${CURRENT_STARTER_VERSIONS}) cur ON cur.deck_id = v.deck_id AND cur.version = v.version
     LEFT JOIN (${STARTER_LATEST_EVENTS}) l ON l.deck_id = k.deck_id AND l.stable_id = k.stable_id
     ${filter.starterDeckId ? "WHERE v.deck_id = ?" : ""}
     GROUP BY v.deck_id, v.title, v.version ORDER BY v.deck_id`,
  ).bind(...(filter.starterDeckId ? [today, accountId, filter.starterDeckId] : [today, accountId])).all();
  return rows.results as { deck_id: string; title: string; version: number; total: number; due: number }[];
}

async function overview(request: Request, env: AccountEnv, session: Session, now: number): Promise<Response> {
  const url = new URL(request.url);
  const zone = await effectiveZone(env, session.account_id, url.searchParams.get("zone"));
  if (zone instanceof Response) return zone;
  const filter = parseDeckFilter(url.searchParams.get("deck"));
  if (filter instanceof Response) return filter;
  const today = localCalendarDate(now, zone.zone);
  const [personal, starter] = await Promise.all([
    personalDeckCounts(env, session.account_id, today, filter),
    starterDeckCounts(env, session.account_id, today, filter),
  ]);
  return json({
    studyDate: today,
    zone: zone.zone,
    zoneSource: zone.source,
    totalDue: personal.reduce((sum, deck) => sum + Number(deck.due), 0) +
      starter.reduce((sum, deck) => sum + Number(deck.due), 0),
    personal: personal.map((deck) => ({ deck: deck.deck, total: Number(deck.total), due: Number(deck.due) })),
    starter: starter.map((deck) => ({
      deckId: deck.deck_id, title: deck.title, version: deck.version,
      total: Number(deck.total), due: Number(deck.due),
    })),
  });
}

type DueCardRow = {
  kind: "personal" | "starter";
  card_id: string | null;
  deck_id: string | null;
  stable_id: string | null;
  deck_label: string;
  title: string;
  version: number;
  front: string;
  definition: string;
  vietnamese: string;
  part_of_speech: string;
  pronunciation: string;
  synonyms: string;
  example: string;
  example_vi: string;
  cefr: string;
  due_date: string | null;
};

function dueCardJson(row: DueCardRow): Record<string, unknown> {
  const card: Record<string, unknown> = row.kind === "personal"
    ? { key: `personal:${row.card_id}`, kind: "personal", ref: { kind: "personal", cardId: row.card_id }, deck: row.deck_label }
    : { key: `starter:${row.deck_id}:${row.stable_id}`, kind: "starter", ref: { kind: "starter", deckId: row.deck_id, stableId: row.stable_id }, deck: row.deck_id, deckTitle: row.title };
  card.front = row.front;
  if (row.due_date) card.dueDate = row.due_date;
  for (const [field, value] of Object.entries({
    definition: row.definition, vietnamese: row.vietnamese, partOfSpeech: row.part_of_speech,
    pronunciation: row.pronunciation, synonyms: row.synonyms, example: row.example,
    exampleVi: row.example_vi, level: row.cefr,
  }) as [string, string][]) {
    if (value) card[field] = value;
  }
  return card;
}

async function dueCards(request: Request, env: AccountEnv, session: Session, now: number): Promise<Response> {
  const url = new URL(request.url);
  const zone = await effectiveZone(env, session.account_id, url.searchParams.get("zone"));
  if (zone instanceof Response) return zone;
  const filter = parseDeckFilter(url.searchParams.get("deck"));
  if (filter instanceof Response) return filter;
  const offset = Math.max(0, Number(url.searchParams.get("offset") ?? "0") || 0);
  const limit = Math.min(PAGE_MAX, Math.max(1, Number(url.searchParams.get("limit") ?? String(PAGE_DEFAULT)) || PAGE_DEFAULT));
  const today = localCalendarDate(now, zone.zone);
  const accountId = session.account_id;
  // A deck filter zeroes out the other card kind's branch entirely.
  const personalWhere = filter.personalDeckKey
    ? " AND c.deck_key = ?"
    : filter.starterDeckId ? " AND 1 = 0" : "";
  const starterWhere = filter.starterDeckId
    ? "WHERE v.deck_id = ?"
    : filter.personalDeckKey ? "WHERE 1 = 0" : "";
  // Placeholder order in the SQL text: personal latest-events join, personal
  // WHERE (account, due date, optional deck), starter latest-events join,
  // optional starter deck filter, outer due-date check, LIMIT, OFFSET.
  const rows = await env.DB.prepare(
    `SELECT * FROM (
       SELECT 'personal' AS kind, c.id AS card_id, NULL AS deck_id, NULL AS stable_id,
              c.deck AS deck_label, '' AS title, 0 AS version, c.front,
              c.definition, c.vietnamese, c.part_of_speech, c.pronunciation, c.synonyms, c.example,
              '' AS example_vi, '' AS cefr, l.next_due AS due_date
       FROM personal_cards c
       LEFT JOIN (${PERSONAL_LATEST_EVENTS}) l ON l.card_id = c.id
       WHERE c.account_id = ? AND c.archived_at IS NULL AND (l.next_due IS NULL OR l.next_due <= ?)${personalWhere}
       UNION ALL
       SELECT 'starter' AS kind, NULL AS card_id, k.deck_id AS deck_id, k.stable_id AS stable_id,
              v.title AS deck_label, v.title AS title, v.version, k.front,
              k.definition_en, k.meaning_vi, k.part_of_speech, k.ipa, k.synonyms,
              COALESCE(NULLIF(k.example_en, ''), k.example_vi), k.example_vi, k.cefr, l.next_due AS due_date
       FROM starter_deck_cards k
       JOIN starter_deck_versions v ON v.deck_id = k.deck_id AND v.version = k.version
       JOIN (${CURRENT_STARTER_VERSIONS}) cur ON cur.deck_id = v.deck_id AND cur.version = v.version
       LEFT JOIN (${STARTER_LATEST_EVENTS}) l ON l.deck_id = k.deck_id AND l.stable_id = k.stable_id
       ${starterWhere}
     )
     WHERE (due_date IS NULL OR due_date <= ?)
     ORDER BY (due_date IS NOT NULL), due_date, kind, deck_label, COALESCE(card_id, stable_id)
     LIMIT ? OFFSET ?`,
  ).bind(...[
    accountId, accountId, today, ...(filter.personalDeckKey ? [filter.personalDeckKey] : []),
    accountId, ...(filter.starterDeckId ? [filter.starterDeckId] : []),
    today, limit, offset,
  ]).all();
  const cards = (rows.results as DueCardRow[]).map(dueCardJson);
  return json({ studyDate: today, zone: zone.zone, zoneSource: zone.source, cards });
}

type RateRef =
  | { kind: "personal"; cardId: string }
  | { kind: "starter"; deckId: string; stableId: string };

function isCardRefId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= CARD_ID_MAX;
}

function parseRef(value: unknown): RateRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ref = value as Record<string, unknown>;
  if (ref.kind === "personal" && isCardRefId(ref.cardId)) return { kind: "personal", cardId: ref.cardId };
  if (ref.kind === "starter" && isCardRefId(ref.deckId) && isCardRefId(ref.stableId))
    return { kind: "starter", deckId: ref.deckId, stableId: ref.stableId };
  return null;
}

async function rate(request: Request, env: AccountEnv, session: Session, now: number): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  let body: Record<string, unknown>;
  try {
    const raw = await request.text();
    if (raw.length > BODY_MAX) return failure(413, "too_large", "That rating request is too large.");
    body = JSON.parse(raw);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("not an object");
  } catch {
    return failure(400, "invalid_request", "Send the rating as JSON.");
  }
  if (Object.keys(body).some((key) => key !== "ref" && key !== "rating" && key !== "requestId" && key !== "zone"))
    return failure(400, "invalid_request", "Only a card reference, rating, request id, and zone can be sent here.");
  const ref = parseRef(body.ref);
  if (!ref) return failure(400, "invalid_request", "Identify the card to rate.");
  const requestId = body.requestId;
  if (typeof requestId !== "string" || requestId.length < 8 || requestId.length > REQUEST_ID_MAX)
    return failure(400, "invalid_request", "A rating needs a request id so it can be applied exactly once.");
  const ratingInput: unknown = body.rating;
  if (!isCardRating(ratingInput))
    return failure(400, "invalid_request", "Rate the card as Not sure or Sure.");
  const rating: CardRating = ratingInput;
  const zone = await effectiveZone(env, session.account_id, typeof body.zone === "string" ? body.zone : null);
  if (zone instanceof Response) return zone;
  const today = localCalendarDate(now, zone.zone);
  const due = nextDueDate(rating, today);
  const eventId = await sha256(`${session.account_id}:${requestId}`);
  const ratedAt = Math.floor(now / 1000);

  if (ref.kind === "personal") {
    const card = await env.DB.prepare(
      "SELECT id FROM personal_cards WHERE id = ? AND account_id = ? AND archived_at IS NULL",
    ).bind(ref.cardId, session.account_id).first<{ id: string }>();
    if (!card) return failure(404, "not_in_study", "That card is not available for study.");
    const applied = await env.DB.prepare(
      `INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
    ).bind(eventId, ref.cardId, session.account_id, rating, zone.zone, due, ratedAt).run();
    if (!applied.meta.changes) {
      const existing = await env.DB.prepare("SELECT next_due FROM card_rating_events WHERE id = ?")
        .bind(eventId).first<{ next_due: string }>();
      return json({ applied: false, dueDate: existing?.next_due ?? due, zone: zone.zone, zoneSource: zone.source });
    }
    return json({ applied: true, dueDate: due, zone: zone.zone, zoneSource: zone.source });
  }

  const card = await env.DB.prepare(
    `SELECT k.stable_id FROM starter_deck_cards k
     JOIN (${CURRENT_STARTER_VERSIONS}) cur ON cur.deck_id = k.deck_id AND cur.version = k.version
     WHERE k.deck_id = ? AND k.stable_id = ? LIMIT 1`,
  ).bind(ref.deckId, ref.stableId).first<{ stable_id: string }>();
  if (!card) return failure(404, "not_in_study", "That starter card is not available for study.");
  const applied = await env.DB.prepare(
    `INSERT INTO starter_card_rating_events (id, account_id, deck_id, stable_id, rating, rating_zone, next_due, rated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO NOTHING`,
  ).bind(eventId, session.account_id, ref.deckId, ref.stableId, rating, zone.zone, due, ratedAt).run();
  if (!applied.meta.changes) {
    const existing = await env.DB.prepare("SELECT next_due FROM starter_card_rating_events WHERE id = ?")
      .bind(eventId).first<{ next_due: string }>();
    return json({ applied: false, dueDate: existing?.next_due ?? due, zone: zone.zone, zoneSource: zone.source });
  }
  return json({ applied: true, dueDate: due, zone: zone.zone, zoneSource: zone.source });
}

export function studyRoute(request: Request, env: AccountEnv, now: () => number = Date.now): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/cards/study")) return null;
  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
    if (request.method === "GET" && path === "/api/cards/study") return overview(request, env, session, now());
    if (request.method === "GET" && path === "/api/cards/study/cards") return dueCards(request, env, session, now());
    if (request.method === "POST" && path === "/api/cards/study/rate") return rate(request, env, session, now());
    return failure(404, "not_found", "This study action is unavailable.");
  })();
}
