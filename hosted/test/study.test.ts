import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { cardRoute } from "../src/cards";
import { accountRoute } from "../src/accounts";
import { studyRoute } from "../src/study";
import type { AccountEnv } from "../src/accounts";
import { buildImportSql } from "../scripts/build-deck-import.mjs";

const origin = "https://whitebook.example.test";
const SESSION_A = "a".repeat(64);
const SESSION_B = "b".repeat(64);
const CSRF_A = "c".repeat(64);
const CSRF_B = "d".repeat(64);

/** 2026-10-02 03:59:30 UTC = Oct 1, 23:59:30 in America/New_York (local date 2026-10-01). */
const NY_LATE_EVENING = Date.parse("2026-10-02T03:59:30Z");
/** 2026-10-02 04:00:30 UTC = Oct 2, 00:00:30 in America/New_York (just past local midnight). */
const NY_PAST_MIDNIGHT = Date.parse("2026-10-02T04:00:30Z");
/** 2026-10-01 17:30 UTC = Oct 2, 00:30 in Asia/Ho_Chi_Minh but Oct 1, 10:30 in America/Los_Angeles. */
const TRAVEL_INSTANT = Date.parse("2026-10-01T17:30:00Z");

const MIGRATIONS = [
  "0001_staging_fixture.sql", "0002_learner_accounts.sql", "0003_personal_cards.sql",
  "0004_account_time_zone.sql", "0005_starter_decks.sql",
];

async function environment(): Promise<{ env: AccountEnv; db: DatabaseSync }> {
  const raw = new DatabaseSync(":memory:");
  for (const name of MIGRATIONS)
    raw.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  raw.exec(buildImportSql(new URL("../../vocab/manifests/", import.meta.url).pathname
    .replace(/^\/([A-Za-z]:)/, "$1")).sql);
  const env: AccountEnv = {
    DB: {
      prepare(sql: string) {
        let args: unknown[] = [];
        return {
          bind(...values: unknown[]) { args = values; return this; },
          async first<T>(): Promise<T | null> {
            return (raw.prepare(sql).get(...(args as never[])) ?? null) as T | null;
          },
          async all() {
            const rows = raw.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
            return { results: rows, meta: { rows_read: rows.length, rows_written: 0 } };
          },
          async run() {
            const result = raw.prepare(sql).run(...(args as never[]));
            const changes = Number(result.changes);
            return { success: true, meta: { changes, rows_read: 0, rows_written: changes } };
          },
        };
      },
    } as AccountEnv["DB"],
    APP_ORIGIN: origin,
  };
  raw.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, nickname, created_at) VALUES ('account-a', 'google', 'sub-a', 'a@example.test', 'Learner A', '', 100)").run();
  raw.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, nickname, created_at) VALUES ('account-b', 'google', 'sub-b', 'b@example.test', 'Learner B', '', 100)").run();
  await env.DB.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, 'account-a', ?, 9999999999, 100)").bind(await sha256(SESSION_A), await sha256(CSRF_A)).run();
  await env.DB.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, 'account-b', ?, 9999999999, 100)").bind(await sha256(SESSION_B), await sha256(CSRF_B)).run();
  return { env, db: raw };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function request(path: string, options: { method?: string; token?: string; csrf?: string; originHeader?: string; body?: unknown } = {}) {
  const headers: Record<string, string> = {};
  if (options.token) headers.Cookie = `__Host-wb_session=${options.token}`;
  if (options.csrf) headers["X-CSRF-Token"] = options.csrf;
  if (options.originHeader !== undefined) headers.Origin = options.originHeader;
  return new Request(`${origin}${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function rateCard(env: AccountEnv, ref: unknown, rating: string, options: {
  token?: string; csrf?: string; zone?: string; requestId?: string; now?: number; origin?: string;
} = {}) {
  return studyRoute(request("/api/cards/study/rate", {
    method: "POST",
    token: options.token ?? SESSION_A,
    csrf: options.csrf ?? CSRF_A,
    originHeader: options.origin ?? origin,
    body: {
      ref, rating,
      requestId: options.requestId ?? crypto.randomUUID(),
      ...(options.zone ? { zone: options.zone } : {}),
    },
  }), env, () => options.now ?? NY_LATE_EVENING)!;
}

async function createPersonalCard(env: AccountEnv, front: string, deck?: string): Promise<string> {
  const response = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front, definition: `Definition of ${front}.`, ...(deck ? { deck } : {}) },
  }), env)!;
  const { card } = await (response as Response).json() as { card: { id: string } };
  return card.id;
}

async function firstStarterCard(env: AccountEnv, deckId: string): Promise<{ stableId: string; front: string }> {
  const response = await studyRoute(request(
    `/api/cards/study/cards?zone=UTC&deck=starter:${deckId}`,
    { token: SESSION_A },
  ), env, () => NY_LATE_EVENING)!;
  const body = await (response as Response).json() as { cards: { kind: string; front: string; ref: { deckId: string; stableId: string } }[] };
  const card = body.cards[0];
  return { stableId: card.ref.stableId, front: card.front };
}

it("the due queue starts with never-rated cards and the two starter decks carry the imported bundle", async () => {
  const { env } = await environment();
  const overview = await studyRoute(request("/api/cards/study?zone=Asia/Ho_Chi_Minh", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  expect(overview.status).toBe(200);
  const body = await (overview as Response).json() as {
    studyDate: string; zone: string; zoneSource: string; totalDue: number;
    personal: { deck: string; total: number; due: number }[];
    starter: { deckId: string; title: string; version: number; total: number; due: number }[];
  };
  expect(body.studyDate).toBe("2026-10-02"); // the instant falls on Oct 2 in Ho Chi Minh City
  expect(body.zoneSource).toBe("device");
  expect(body.starter).toEqual([
    { deckId: "anki_starter", title: "Anki starter: SAT words", version: 2, total: 839, due: 839 },
    { deckId: "b2c1_1000", title: "B2-C1 SAT vocabulary (1,000 words)", version: 3, total: 1000, due: 1000 },
  ]);
  expect(body.personal).toEqual([]);
  expect(body.totalDue).toBe(1839);

  const page = await studyRoute(request("/api/cards/study/cards?zone=Asia/Ho_Chi_Minh&limit=2&offset=839", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const pageBody = await (page as Response).json() as {
    cards: { kind: string; front: string; deck: string; deckTitle?: string; ref: { kind: string } }[];
  };
  expect(pageBody.cards).toHaveLength(2);
  expect(pageBody.cards.every((card) => card.kind === "starter")).toBe(true);
  expect(pageBody.cards[0].ref.kind).toBe("starter");
  expect(typeof pageBody.cards[0].front).toBe("string");
});

it("a starter card shows its reviewed back fields and nothing else", async () => {
  const { env } = await environment();
  const response = await studyRoute(request("/api/cards/study/cards?zone=UTC&deck=starter:anki_starter&limit=1", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const body = await (response as Response).json() as { cards: Record<string, unknown>[] };
  const card = body.cards[0];
  expect(card.vietnamese).toBeTruthy();
  expect(card.front).toBeTruthy();
  expect(card.deckTitle).toBeTruthy();
  expect(Object.keys(card).every((key) =>
    ["key", "kind", "ref", "deck", "deckTitle", "front", "dueDate", "definition", "vietnamese",
      "partOfSpeech", "pronunciation", "synonyms", "example", "exampleVi", "level"].includes(key),
  )).toBe(true);
  for (const forbidden of ["sourcePath", "sourceRef", "reviewStatus", "extraction", "audio", "source", "sha"])
    expect(card[forbidden]).toBeUndefined();
});

it("rates Not sure to the next local day and Sure four days later, with overdue cards due today", async () => {
  const { env, db } = await environment();
  env.DB.prepare("INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, created_at, updated_at) VALUES ('p1', 'account-a', 'My words', 'my words', 'serendipity', 'serendipity', 'By chance.', 1, 1)").run();
  env.DB.prepare("INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at) VALUES ('e0', 'p1', 'account-a', 'not_sure', 'America/New_York', '2026-09-20', 1000)").run();

  // The overdue card (due 2026-09-20 <= today 2026-10-01) is in the queue first.
  const before = await studyRoute(request("/api/cards/study/cards?zone=America/New_York&deck=personal:My%20words", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  expect(((await (before as Response).json()) as { cards: { key: string }[] }).cards.map((card) => card.key)).toContain("personal:p1");

  const notSure = await rateCard(env, { kind: "personal", cardId: "p1" }, "not_sure", { zone: "America/New_York" });
  expect(await (notSure as Response).json()).toEqual({
    applied: true, dueDate: "2026-10-02", zone: "America/New_York", zoneSource: "device",
  });

  // ...and it leaves the queue once rated into the future.
  const after = await studyRoute(request("/api/cards/study/cards?zone=America/New_York&deck=personal:My%20words", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  expect(((await (after as Response).json()) as { cards: { key: string }[] }).cards.map((card) => card.key)).not.toContain("personal:p1");

  const sure = await rateCard(env, { kind: "personal", cardId: "p1" }, "sure", {
    zone: "America/New_York", requestId: crypto.randomUUID(), now: NY_PAST_MIDNIGHT,
  });
  // Latest rating wins: rated just past local midnight on Oct 2, so Sure lands on Oct 6.
  expect(((await (sure as Response).json()) as { dueDate: string }).dueDate).toBe("2026-10-06");
  const events = await db.prepare("SELECT rating, next_due FROM card_rating_events WHERE card_id = 'p1' ORDER BY rated_at").all();
  expect(events).toEqual([
    { rating: "not_sure", next_due: "2026-09-20" }, // seeded history from ticket 09 fixtures
    { rating: "not_sure", next_due: "2026-10-02" },
    { rating: "sure", next_due: "2026-10-06" },
  ]);
});

it("when two ratings land in the same second, the one inserted last wins", async () => {
  const { env } = await environment();
  env.DB.prepare("INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, created_at, updated_at) VALUES ('p1', 'account-a', 'My words', 'my words', 'tie', 'tie', 'd', 1, 1)").run();
  // Same rated_at second: the first-inserted event is due today, the second-inserted one is not.
  env.DB.prepare("INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at) VALUES ('e-first', 'p1', 'account-a', 'not_sure', 'UTC', '2026-10-02', 5000)").run();
  env.DB.prepare("INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at) VALUES ('e-second', 'p1', 'account-a', 'sure', 'UTC', '2026-10-05', 5000)").run();
  const queue = await studyRoute(request("/api/cards/study/cards?zone=UTC&deck=personal:My%20words", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const body = await (queue as Response).json() as { cards: { key: string }[] };
  // The latest rating (sure -> Oct 5, past today Oct 2) must set the current due date.
  expect(body.cards.some((card) => card.key === "personal:p1")).toBe(false);
});

it("rates a starter card exactly once per request id even when the local date repeats", async () => {
  const { env, db } = await environment();
  const { stableId } = await firstStarterCard(env, "anki_starter");
  const ref = { kind: "starter", deckId: "anki_starter", stableId };
  const requestId = crypto.randomUUID();

  // 00:30 on Oct 2 in Ho Chi Minh City: Not sure -> due Oct 3 (local calendar day).
  const first = await rateCard(env, ref, "not_sure", { zone: "Asia/Ho_Chi_Minh", requestId, now: TRAVEL_INSTANT });
  expect(((await (first as Response).json()) as { dueDate: string }).dueDate).toBe("2026-10-03");

  // A network retry replays the same request id: no second event, same due date.
  const retry = await rateCard(env, ref, "not_sure", { zone: "Asia/Ho_Chi_Minh", requestId, now: TRAVEL_INSTANT });
  expect(await (retry as Response).json()).toEqual({
    applied: false, dueDate: "2026-10-03", zone: "Asia/Ho_Chi_Minh", zoneSource: "device",
  });
  const events = await db.prepare("SELECT COUNT(*) AS n, COUNT(DISTINCT id) AS ids FROM starter_card_rating_events").get() as { n: number; ids: number };
  expect(events).toEqual({ n: 1, ids: 1 });
});

it("changing the saved zone keeps stored due dates and does not replay ratings", async () => {
  const { env, db } = await environment();
  const { stableId } = await firstStarterCard(env, "anki_starter");
  const ref = { kind: "starter", deckId: "anki_starter", stableId };
  const saveZone = await accountRoute(request("/api/account/profile", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { timeZone: "Asia/Ho_Chi_Minh" },
  }), env)!;
  expect(saveZone.status).toBe(200);

  const rated = await rateCard(env, ref, "sure", { now: TRAVEL_INSTANT });
  const ratedBody = await (rated as Response).json() as { dueDate: string; zone: string; zoneSource: string };
  // The saved zone (Oct 2) decides the study day; Sure -> four calendar days later.
  expect(ratedBody).toEqual({ applied: true, dueDate: "2026-10-06", zone: "Asia/Ho_Chi_Minh", zoneSource: "account" });

  // The learner flies west: the saved zone becomes Los Angeles, where it is still Oct 1.
  await accountRoute(request("/api/account/profile", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { timeZone: "America/Los_Angeles" },
  }), env)!;

  const overview = await studyRoute(request("/api/cards/study", { token: SESSION_A }), env, () => TRAVEL_INSTANT)!;
  const overviewBody = await (overview as Response).json() as {
    studyDate: string; zone: string; zoneSource: string; totalDue: number;
    starter: { deckId: string; due: number }[];
  };
  expect(overviewBody.zone).toBe("America/Los_Angeles");
  expect(overviewBody.zoneSource).toBe("account");
  expect(overviewBody.studyDate).toBe("2026-10-01"); // today re-evaluated in the new zone
  // The rated card keeps its stored due date (Oct 6) and is not due again today.
  const queue = await studyRoute(request("/api/cards/study/cards", { token: SESSION_A }), env, () => TRAVEL_INSTANT)!;
  const queueBody = await (queue as Response).json() as { cards: { key: string; dueDate?: string }[] };
  expect(queueBody.cards.some((card) => card.key === `starter:anki_starter:${stableId}`)).toBe(false);
  expect(overviewBody.starter.find((deck) => deck.deckId === "anki_starter")?.due).toBe(838);
  const events = await db.prepare("SELECT COUNT(*) AS n FROM starter_card_rating_events").get() as { n: number };
  expect(events.n).toBe(1); // the zone change replayed nothing
  const stored = await db.prepare("SELECT next_due FROM starter_card_rating_events").get() as { next_due: string };
  expect(stored.next_due).toBe("2026-10-06"); // stored due date untouched by the zone change
});

it("two learners study the same shared decks with independent histories and due counts", async () => {
  const { env } = await environment();
  const { stableId } = await firstStarterCard(env, "b2c1_1000");
  const ref = { kind: "starter", deckId: "b2c1_1000", stableId };
  const cardKey = `starter:b2c1_1000:${stableId}`;

  // Learner A rates the shared card Sure at the same instant Learner B has not.
  await rateCard(env, ref, "sure", { token: SESSION_A, zone: "UTC", now: NY_LATE_EVENING });
  const forA = await studyRoute(request("/api/cards/study?zone=UTC", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const forB = await studyRoute(request("/api/cards/study?zone=UTC", { token: SESSION_B }), env, () => NY_LATE_EVENING)!;
  const bodyA = await (forA as Response).json() as { starter: { deckId: string; due: number }[] };
  const bodyB = await (forB as Response).json() as { starter: { deckId: string; due: number }[] };
  expect(bodyA.starter.find((deck) => deck.deckId === "b2c1_1000")).toMatchObject({ due: 999 });
  expect(bodyB.starter.find((deck) => deck.deckId === "b2c1_1000")).toMatchObject({ due: 1000 });

  const aQueue = await studyRoute(request("/api/cards/study/cards?zone=UTC&deck=starter:b2c1_1000", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const aCards = await (aQueue as Response).json() as { cards: { key: string }[] };
  expect(aCards.cards.some((card) => card.key === cardKey)).toBe(false);
  const bQueue = await studyRoute(request("/api/cards/study/cards?zone=UTC&deck=starter:b2c1_1000", { token: SESSION_B }), env, () => NY_LATE_EVENING)!;
  const bCards = await (bQueue as Response).json() as { cards: { key: string }[] };
  expect(bCards.cards.some((card) => card.key === cardKey)).toBe(true);

  // B rates the same shared card differently; the stored due dates stay independent.
  await rateCard(env, ref, "not_sure", { token: SESSION_B, csrf: CSRF_B, zone: "UTC", now: NY_LATE_EVENING });
  const events = await env.DB.prepare(
    "SELECT account_id, rating, next_due FROM starter_card_rating_events ORDER BY account_id",
  ).all();
  expect(events.results).toEqual([
    { account_id: "account-a", rating: "sure", next_due: "2026-10-06" }, // UTC today is Oct 2: +4 days
    { account_id: "account-b", rating: "not_sure", next_due: "2026-10-03" }, // same instant, +1 day
  ]);
  const zones = await env.DB.prepare("SELECT account_id, rating_zone FROM starter_card_rating_events ORDER BY account_id").all();
  expect(zones.results).toEqual([
    { account_id: "account-a", rating_zone: "UTC" },
    { account_id: "account-b", rating_zone: "UTC" },
  ]);
});

it("deck filters scope the queue to one personal deck or one starter deck", async () => {
  const { env } = await environment();
  env.DB.prepare("INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, created_at, updated_at) VALUES ('p1', 'account-a', 'My words', 'my words', 'alpha', 'alpha', 'd', 1, 1)").run();
  env.DB.prepare("INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, created_at, updated_at) VALUES ('p2', 'account-a', 'Hard words', 'hard words', 'beta', 'beta', 'd', 1, 1)").run();
  await createPersonalCard(env, "gamma"); // default deck "My words"

  const mine = await studyRoute(request("/api/cards/study/cards?zone=UTC&deck=personal:My%20words", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const mineBody = await (mine as Response).json() as { cards: { deck: string }[] };
  expect(mineBody.cards.every((card) => card.deck === "My words")).toBe(true);
  expect(mineBody.cards).toHaveLength(2);

  const starter = await studyRoute(request("/api/cards/study/cards?zone=UTC&deck=starter:anki_starter&limit=3", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const starterBody = await (starter as Response).json() as { cards: { kind: string; deck: string }[] };
  expect(starterBody.cards).toHaveLength(3);
  expect(starterBody.cards.every((card) => card.kind === "starter" && card.deck === "anki_starter")).toBe(true);

  const bad = await studyRoute(request("/api/cards/study/cards?zone=UTC&deck=bogus", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  expect(bad.status).toBe(400);
});

it("archived personal cards stay out of study, and rating one is refused", async () => {
  const { env } = await environment();
  const id = await createPersonalCard(env, "archived-word");
  await cardRoute(request(`/api/cards/${id}/archive`, {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
  }), env)!;
  const queue = await studyRoute(request("/api/cards/study/cards?zone=UTC", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const cards = await (queue as Response).json() as { cards: { key: string }[] };
  expect(cards.cards.some((card) => card.key === `personal:${id}`)).toBe(false);
  const rated = await rateCard(env, { kind: "personal", cardId: id }, "sure", { zone: "UTC" });
  expect(rated.status).toBe(404);
});

it("study reads and ratings require a session, and ratings require same-origin and CSRF", async () => {
  const { env } = await environment();
  expect((await studyRoute(request("/api/cards/study?zone=UTC"), env)!).status).toBe(401);
  expect((await studyRoute(request("/api/cards/study/cards?zone=UTC"), env)!).status).toBe(401);
  const unsigned = await rateCard(env, { kind: "personal", cardId: "p1" }, "sure", {
    token: SESSION_A, csrf: undefined, origin: "https://evil.example", zone: "UTC",
  });
  expect(unsigned.status).toBe(403);
  const missingCsrf = await rateCard(env, { kind: "personal", cardId: "p1" }, "sure", {
    token: SESSION_A, csrf: "", zone: "UTC",
  });
  expect(missingCsrf.status).toBe(403);
});

it("rejects invalid ratings, request ids, zones, and unknown cards", async () => {
  const { env } = await environment();
  const { stableId } = await firstStarterCard(env, "anki_starter");
  expect((await rateCard(env, { kind: "personal", cardId: "p1" }, "easy", { zone: "UTC" })).status).toBe(400);
  expect((await rateCard(env, { kind: "personal", cardId: "p1" }, "sure", { zone: "UTC", requestId: "short" })).status).toBe(400);
  expect((await rateCard(env, { kind: "personal", cardId: "p1" }, "sure", { zone: "Mars/Olympus" })).status).toBe(400);
  expect((await rateCard(env, { kind: "starter", deckId: "nope_deck", stableId }, "sure", { zone: "UTC" })).status).toBe(404);
  expect((await rateCard(env, { kind: "starter", deckId: "anki_starter", stableId: "0".repeat(16) }, "sure", { zone: "UTC" })).status).toBe(404);
  expect((await rateCard(env, { kind: "personal", cardId: "missing" }, "sure", { zone: "UTC" })).status).toBe(404);
  const extra = await studyRoute(request("/api/cards/study/rate", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { ref: { kind: "personal", cardId: "x" }, rating: "sure", requestId: "12345678", zone: "UTC", hacked: true },
  }), env, () => NY_LATE_EVENING)!;
  expect(extra.status).toBe(400);
  expect((await studyRoute(request("/api/cards/study/unknown", { token: SESSION_A }), env)!).status).toBe(404);
});

it("the saved zone and the study date agree across reads for the same account", async () => {
  const { env } = await environment();
  await accountRoute(request("/api/account/profile", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { timeZone: "Asia/Ho_Chi_Minh" },
  }), env)!;
  const overview = await studyRoute(request("/api/cards/study?zone=America/New_York", { token: SESSION_A }), env, () => NY_LATE_EVENING)!;
  const body = await (overview as Response).json() as { zone: string; zoneSource: string; studyDate: string };
  // The client-supplied zone is ignored once a saved zone exists.
  expect(body).toMatchObject({ zone: "Asia/Ho_Chi_Minh", zoneSource: "account", studyDate: "2026-10-02" });
  const profile = await accountRoute(request("/api/account/me", { token: SESSION_A }), env)!;
  const me = await (profile as Response).json() as { account: { timeZone: string } };
  expect(me.account.timeZone).toBe("Asia/Ho_Chi_Minh");
});
