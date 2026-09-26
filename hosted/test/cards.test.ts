import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { cardRoute } from "../src/cards";
import type { AccountEnv } from "../src/accounts";

const origin = "https://whitebook.example.test";
const SESSION_A = "a".repeat(64);
const SESSION_B = "b".repeat(64);
const CSRF_A = "c".repeat(64);
const CSRF_B = "d".repeat(64);

function d1FromMigrations(): AccountEnv["DB"] {
  const db = new DatabaseSync(":memory:");
  for (const name of ["0001_staging_fixture.sql", "0002_learner_accounts.sql", "0003_personal_cards.sql"])
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  return {
    prepare(sql: string) {
      let args: unknown[] = [];
      return {
        bind(...values: unknown[]) { args = values; return this; },
        async first<T>(): Promise<T | null> {
          return (db.prepare(sql).get(...(args as never[])) ?? null) as T | null;
        },
        async all() {
          const rows = db.prepare(sql).all(...(args as never[])) as Record<string, unknown>[];
          return { results: rows, meta: { rows_read: rows.length, rows_written: 0 } };
        },
        async run() {
          const result = db.prepare(sql).run(...(args as never[]));
          const changes = Number(result.changes);
          return { success: true, meta: { changes, rows_read: 0, rows_written: changes } };
        },
      };
    },
  } as AccountEnv["DB"];
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function environment() {
  const db = d1FromMigrations();
  const env: AccountEnv = { DB: db, APP_ORIGIN: origin };
  db.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, nickname, created_at) VALUES ('account-a', 'google', 'sub-a', 'a@example.test', 'Learner A', '', 100)").run();
  db.prepare("INSERT INTO learner_accounts (id, provider, provider_subject, email, display_name, nickname, created_at) VALUES ('account-b', 'google', 'sub-b', 'b@example.test', 'Learner B', '', 100)").run();
  db.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, 'account-a', ?, 9999999999, 100)").bind(await sha256(SESSION_A), await sha256(CSRF_A)).run();
  db.prepare("INSERT INTO learner_sessions (token_hash, account_id, csrf_hash, expires_at, created_at) VALUES (?, 'account-b', ?, 9999999999, 100)").bind(await sha256(SESSION_B), await sha256(CSRF_B)).run();
  return env;
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


it("creates, lists, and shows personal cards with only the fields that are present", async () => {
  const env = await environment();
  const created = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "serendipity", definition: "The occurrence of events by chance in a happy way.", vietnamese: "Sự tình cờ may mắn" },
  }), env)!;
  expect(created.status).toBe(201);
  const { card } = await (created as Response).json() as { card: Record<string, unknown> };
  expect(card.front).toBe("serendipity");
  expect(card.deck).toBe("My words");
  expect(card.definition).toContain("by chance");
  expect(card.vietnamese).toBe("Sự tình cờ may mắn");
  expect(card.partOfSpeech).toBeUndefined();
  expect(card.pronunciation).toBeUndefined();
  expect(card.synonyms).toBeUndefined();
  expect(card.example).toBeUndefined();
  expect(card.archived).toBe(false);
  expect(String(card.id)).toMatch(/^[0-9a-f-]{36}$/);

  const listed = await cardRoute(request("/api/cards", { token: SESSION_A }), env)!;
  const listBody = await (listed as Response).json() as { decks: string[]; cards: { id: unknown }[] };
  expect(listBody.decks).toEqual(["My words"]);
  expect(listBody.cards).toHaveLength(1);
  expect(listBody.cards[0].id).toBe(card.id);

  const shown = await cardRoute(request(`/api/cards/${card.id}`, { token: SESSION_A }), env)!;
  expect((await (shown as Response).json() as { card: { id: unknown } }).card.id).toBe(card.id);

  // Normalization: the same front with different case and spacing is recognized as a likely duplicate.
  const second = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "  SERENDIPITY ", definition: "Another sense kept separately." },
  }), env)!;
  expect(second.status).toBe(409);
});

it("rejects invalid cards with structured field errors", async () => {
  const env = await environment();
  const missingFront = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { definition: "Only a back field." },
  }), env)!;
  expect(missingFront.status).toBe(400);
  const missingFrontBody = await (missingFront as Response).json() as { error: { code: string; fieldErrors: Record<string, string> } };
  expect(missingFrontBody.error.code).toBe("validation");
  expect(missingFrontBody.error.fieldErrors.front).toBeTruthy();

  const noBack = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "word", vietnamese: "  " },
  }), env)!;
  expect((await (noBack as Response).json() as { error: { fieldErrors: Record<string, string> } }).error.fieldErrors.back).toBeTruthy();

  const tooLong = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "x".repeat(241), definition: "sense" },
  }), env)!;
  expect(tooLong.status).toBe(400);

  const unknownField = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "word", definition: "sense", hacker: "nope" },
  }), env)!;
  expect(unknownField.status).toBe(400);

  const malformed = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin, body: undefined,
  }), env)!;
  expect(malformed.status).toBe(400);
});

it("warns on a likely duplicate in the chosen deck and keeps both senses when the learner confirms", async () => {
  const env = await environment();
  const first = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "bank", deck: "My words", definition: "Land alongside a river." },
  }), env)!;
  expect(first.status).toBe(201);

  const duplicate = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "Bank", definition: "An institution holding money." },
  }), env)!;
  expect(duplicate.status).toBe(409);
  const duplicateBody = await (duplicate as Response).json() as { error: { code: string; duplicateOf: { id: string; front: string; deck: string; definition?: string } } };
  expect(duplicateBody.error.code).toBe("duplicate_possible");
  expect(duplicateBody.error.duplicateOf.front).toBe("bank");
  expect(duplicateBody.error.duplicateOf.definition).toBe("Land alongside a river.");

  const confirmed = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "Bank", definition: "An institution holding money.", confirm: true },
  }), env)!;
  expect(confirmed.status).toBe(201);
  const listed = await cardRoute(request("/api/cards", { token: SESSION_A }), env)!;
  const listBody = await (listed as Response).json() as { cards: { front: string; definition: string }[] };
  expect(listBody.cards).toHaveLength(2);
  expect(new Set(listBody.cards.map((card) => card.definition))).toEqual(
    new Set(["Land alongside a river.", "An institution holding money."]));

  const check = await cardRoute(request("/api/cards/duplicates?front=bank&deck=My%20words", { token: SESSION_A }), env)!;
  const checkBody = await (check as Response).json() as { matches: unknown[] };
  expect(checkBody.matches).toHaveLength(2);
});

it("does not warn about the same front in a different deck", async () => {
  const env = await environment();
  await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "bank", deck: "My words", definition: "Land alongside a river." },
  }), env)!;
  const otherDeck = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "bank", deck: "Hard words", definition: "An institution holding money." },
  }), env)!;
  expect(otherDeck.status).toBe(201);
});

it("edits content without changing the card identity or its review history", async () => {
  const env = await environment();
  const created = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "ephemeral", definition: "Lasting for a very short time." },
  }), env)!;
  const { card } = await (created as Response).json() as { card: { id: string; createdAt: number } };
  env.DB.prepare("INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at) VALUES ('event-1', ?, 'account-a', 'sure', 'Asia/Ho_Chi_Minh', '2026-09-30', 1000)").bind(card.id).run();
  env.DB.prepare("INSERT INTO card_rating_events (id, card_id, account_id, rating, rating_zone, next_due, rated_at) VALUES ('event-2', ?, 'account-a', 'not_sure', 'Asia/Ho_Chi_Minh', '2026-09-27', 2000)").bind(card.id).run();

  const edited = await cardRoute(request(`/api/cards/${card.id}`, {
    method: "PATCH", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { definition: "Lasting for a very short time; fleeting.", partOfSpeech: "adjective" },
  }), env)!;
  expect(edited.status).toBe(200);
  const editedBody = await (edited as Response).json() as { card: Record<string, unknown> };
  expect(editedBody.card.id).toBe(card.id);
  expect(editedBody.card.createdAt).toBe(card.createdAt);
  expect(editedBody.card.definition).toContain("fleeting");
  expect(editedBody.card.partOfSpeech).toBe("adjective");
  expect(editedBody.card.front).toBe("ephemeral");

  const events = await env.DB.prepare("SELECT id, rating, next_due FROM card_rating_events WHERE card_id = ? ORDER BY id").bind(card.id).all();
  expect(events.results).toEqual([
    { id: "event-1", rating: "sure", next_due: "2026-09-30" },
    { id: "event-2", rating: "not_sure", next_due: "2026-09-27" },
  ]);

  const clearingBack = await cardRoute(request(`/api/cards/${card.id}`, {
    method: "PATCH", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { definition: "", partOfSpeech: "" },
  }), env)!;
  expect(clearingBack.status).toBe(400);
});

it("moves a card between decks and warns about a duplicate in the target deck", async () => {
  const env = await environment();
  const mover = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "bank", deck: "My words", definition: "Land alongside a river." },
  }), env)!;
  const { card } = await (mover as Response).json() as { card: { id: string } };
  const dweller = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "bank", deck: "Hard words", definition: "An institution holding money." },
  }), env)!;
  expect(dweller.status).toBe(201);

  const warned = await cardRoute(request(`/api/cards/${card.id}/move`, {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { deck: "Hard words" },
  }), env)!;
  expect(warned.status).toBe(409);
  const warnedBody = await (warned as Response).json() as { error: { code: string; duplicateOf: { id: string } } };
  expect(warnedBody.error.code).toBe("duplicate_possible");

  const confirmed = await cardRoute(request(`/api/cards/${card.id}/move`, {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { deck: "Hard words", confirm: true },
  }), env)!;
  expect(confirmed.status).toBe(200);
  const movedBody = await (confirmed as Response).json() as { card: { deck: string } };
  expect(movedBody.card.deck).toBe("Hard words");

  const listed = await cardRoute(request("/api/cards?deck=Hard%20words", { token: SESSION_A }), env)!;
  const listBody = await (listed as Response).json() as { cards: { id: string }[] };
  expect(listBody.cards.map((item) => item.id)).toContain(card.id);
});

it("archives a card out of the normal list without deleting it, and restores it", async () => {
  const env = await environment();
  const created = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "obsolete", definition: "No longer in use." },
  }), env)!;
  const { card } = await (created as Response).json() as { card: { id: string } };

  const archived = await cardRoute(request(`/api/cards/${card.id}/archive`, {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
  }), env)!;
  expect(archived.status).toBe(200);
  expect(((await (archived as Response).json()) as { card: { archived: boolean } }).card.archived).toBe(true);

  const active = await cardRoute(request("/api/cards", { token: SESSION_A }), env)!;
  expect(((await (active as Response).json()) as { cards: unknown[] }).cards).toHaveLength(0);
  const archivedList = await cardRoute(request("/api/cards?archived=1", { token: SESSION_A }), env)!;
  const archivedBody = await (archivedList as Response).json() as { cards: { id: string; front: string }[] };
  expect(archivedBody.cards.map((item) => item.id)).toEqual([card.id]);
  expect(archivedBody.cards[0].front).toBe("obsolete");

  const restored = await cardRoute(request(`/api/cards/${card.id}/restore`, {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
  }), env)!;
  expect(((await (restored as Response).json()) as { card: { archived: boolean } }).card.archived).toBe(false);
  const activeAgain = await cardRoute(request("/api/cards", { token: SESSION_A }), env)!;
  expect(((await (activeAgain as Response).json()) as { cards: unknown[] }).cards).toHaveLength(1);
});

it("keeps every card private: another learner cannot see or change it", async () => {
  const env = await environment();
  const created = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
    body: { front: "private", definition: "Belonging to one learner." },
  }), env)!;
  const { card } = await (created as Response).json() as { card: { id: string } };

  const otherList = await (await cardRoute(request("/api/cards", { token: SESSION_B }), env)! as Response).json() as { cards: unknown[] };
  expect(otherList.cards).toHaveLength(0);

  const otherShow = await cardRoute(request(`/api/cards/${card.id}`, { token: SESSION_B }), env)!;
  expect(otherShow.status).toBe(404);
  const otherEdit = await cardRoute(request(`/api/cards/${card.id}`, {
    method: "PATCH", token: SESSION_B, csrf: CSRF_B, originHeader: origin, body: { definition: "stolen" },
  }), env)!;
  expect(otherEdit.status).toBe(404);
  const otherMove = await cardRoute(request(`/api/cards/${card.id}/move`, {
    method: "POST", token: SESSION_B, csrf: CSRF_B, originHeader: origin, body: { deck: "Theft" },
  }), env)!;
  expect(otherMove.status).toBe(404);
  const otherArchive = await cardRoute(request(`/api/cards/${card.id}/archive`, {
    method: "POST", token: SESSION_B, csrf: CSRF_B, originHeader: origin,
  }), env)!;
  expect(otherArchive.status).toBe(404);

  const own = await cardRoute(request(`/api/cards/${card.id}`, { token: SESSION_A }), env)!;
  expect(((await (own as Response).json()) as { card: { definition: string } }).card.definition).toBe("Belonging to one learner.");
});

it("requires a session, same origin, and CSRF for card reads and mutations", async () => {
  const env = await environment();
  expect((await cardRoute(request("/api/cards"), env)!).status).toBe(401);

  const crossOrigin = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: "https://evil.example", body: { front: "x", definition: "y" },
  }), env)!;
  expect(crossOrigin.status).toBe(403);

  const missingCsrf = await cardRoute(request("/api/cards", {
    method: "POST", token: SESSION_A, originHeader: origin, body: { front: "x", definition: "y" },
  }), env)!;
  expect(missingCsrf.status).toBe(403);

  const unknownRoute = await cardRoute(request("/api/cards/whatever/action", { token: SESSION_A }), env)!;
  expect(unknownRoute.status).toBe(404);
  const unknownAction = await cardRoute(request("/api/cards/00000000-0000-0000-0000-000000000000/archive", {
    method: "POST", token: SESSION_A, csrf: CSRF_A, originHeader: origin,
  }), env)!;
  expect(unknownAction.status).toBe(404);
});
