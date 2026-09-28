import { currentSession, failure, json, noStore, requireMutation, type AccountEnv, type Session } from "./accounts";

type CardRow = {
  id: string;
  deck: string;
  front: string;
  definition: string;
  vietnamese: string;
  part_of_speech: string;
  pronunciation: string;
  synonyms: string;
  example: string;
  archived_at: number | null;
  created_at: number;
  updated_at: number;
};

type DuplicateRow = Pick<CardRow, "id" | "deck" | "front" | "definition" | "vietnamese" | "archived_at">;

const BACK_FIELDS = ["definition", "vietnamese", "partOfSpeech", "pronunciation", "synonyms", "example"] as const;
type BackField = (typeof BACK_FIELDS)[number];
const BACK_COLUMNS: Record<BackField, keyof CardRow> = {
  definition: "definition",
  vietnamese: "vietnamese",
  partOfSpeech: "part_of_speech",
  pronunciation: "pronunciation",
  synonyms: "synonyms",
  example: "example",
};
const CARD_COLUMNS = "id, deck, front, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at";
const FRONT_MAX = 240;
const BACK_MAX = 2000;
const DECK_MAX = 80;
const BODY_MAX = 16384;
const DEFAULT_DECK = "My words";
const BATCH_MAX = 20;

const normalize = (value: string) => value.replace(/\s+/g, " ").trim().toLowerCase();

function cardJson(row: CardRow): Record<string, unknown> {
  const card: Record<string, unknown> = {
    id: row.id,
    deck: row.deck,
    front: row.front,
    archived: row.archived_at !== null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const field of BACK_FIELDS) {
    const value = row[BACK_COLUMNS[field]];
    if (value) card[field] = value;
  }
  return card;
}

function duplicateJson(row: DuplicateRow): Record<string, unknown> {
  const match: Record<string, unknown> = { id: row.id, deck: row.deck, front: row.front, archived: row.archived_at !== null };
  if (row.definition) match.definition = row.definition;
  if (row.vietnamese) match.vietnamese = row.vietnamese;
  return match;
}

function fieldErrorsFor(front: string, back: Record<BackField, string>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!front) errors.front = "Add the word or phrase for the front of the card.";
  else if (front.length > FRONT_MAX) errors.front = `Keep the front at ${FRONT_MAX} characters or fewer.`;
  if (!BACK_FIELDS.some((field) => back[field])) errors.back = "Add at least one back field, such as a definition or Vietnamese meaning.";
  for (const field of BACK_FIELDS)
    if (back[field].length > BACK_MAX) errors[field] = "Keep this field at 2,000 characters or fewer.";
  return Object.keys(errors).length ? errors : null;
}

function validationError(fieldErrors: Record<string, string>): Response {
  return Response.json(
    { error: { code: "validation", message: "Check the highlighted card fields.", fieldErrors } },
    { status: 400, headers: noStore },
  );
}

function duplicateGate(duplicate: DuplicateRow): Response {
  return Response.json(
    {
      error: {
        code: "duplicate_possible",
        message: `“${duplicate.front}” already looks like a card in “${duplicate.deck}”. Check it before saving so different senses stay separate, or save anyway to keep both.`,
        duplicateOf: duplicateJson(duplicate),
      },
    },
    { status: 409, headers: noStore },
  );
}

async function parseBody(request: Request): Promise<{ body?: Record<string, unknown>; response?: Response }> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return { response: failure(400, "invalid_card", "Send the card as JSON.") };
  }
  if (raw.length > BODY_MAX) return { response: failure(413, "too_large", "That card is too large.") };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return { body: parsed as Record<string, unknown> };
  } catch {
    return { response: failure(400, "invalid_card", "Send the card as JSON.") };
  }
}

type FieldValue = { present: boolean; value: string; invalid: boolean };

function stringField(body: Record<string, unknown>, key: string): FieldValue {
  const value = body[key];
  if (value === undefined) return { present: false, value: "", invalid: false };
  if (typeof value !== "string") return { present: true, value: "", invalid: true };
  return { present: true, value: value.trim(), invalid: false };
}

async function findDuplicate(env: AccountEnv, accountId: string, deck: string, front: string, excludeId?: string): Promise<DuplicateRow | null> {
  const sql = `SELECT id, deck, front, definition, vietnamese, archived_at FROM personal_cards
    WHERE account_id = ? AND deck_key = ? AND front_key = ?${excludeId ? " AND id <> ?" : ""}
    ORDER BY archived_at IS NOT NULL, created_at LIMIT 1`;
  const args: unknown[] = [accountId, normalize(deck), normalize(front)];
  if (excludeId) args.push(excludeId);
  return env.DB.prepare(sql).bind(...args).first<DuplicateRow>();
}

async function ownedCard(env: AccountEnv, accountId: string, id: string): Promise<CardRow | null> {
  return env.DB.prepare(`SELECT ${CARD_COLUMNS} FROM personal_cards WHERE id = ? AND account_id = ?`)
    .bind(id, accountId).first<CardRow>();
}

async function list(request: Request, env: AccountEnv, session: Session): Promise<Response> {
  const url = new URL(request.url);
  const archived = url.searchParams.get("archived") === "1";
  const deck = url.searchParams.get("deck");
  const cards = await env.DB.prepare(
    `SELECT ${CARD_COLUMNS} FROM personal_cards WHERE account_id = ? AND archived_at IS ${archived ? "NOT" : ""} NULL${deck ? " AND deck_key = ?" : ""} ORDER BY updated_at DESC`,
  ).bind(...(deck ? [session.account_id, normalize(deck)] : [session.account_id])).all();
  const decks = await env.DB.prepare(
    "SELECT DISTINCT deck FROM personal_cards WHERE account_id = ? ORDER BY deck",
  ).bind(session.account_id).all();
  return json({ decks: decks.results.map((row) => (row as { deck: string }).deck), cards: cards.results.map((row) => cardJson(row as CardRow)) });
}

async function duplicates(request: Request, env: AccountEnv, session: Session): Promise<Response> {
  const url = new URL(request.url);
  const front = (url.searchParams.get("front") ?? "").trim();
  const deck = (url.searchParams.get("deck") ?? "").trim();
  const exclude = (url.searchParams.get("exclude") ?? "").trim();
  if (!front || front.length > FRONT_MAX || !deck || deck.length > DECK_MAX)
    return failure(400, "invalid_request", "Provide the card front and deck to check for duplicates.");
  const matches = await env.DB.prepare(
    `SELECT id, deck, front, definition, vietnamese, archived_at FROM personal_cards
     WHERE account_id = ? AND deck_key = ? AND front_key = ?${exclude ? " AND id <> ?" : ""}
     ORDER BY archived_at IS NOT NULL, created_at LIMIT 5`,
  ).bind(...(exclude ? [session.account_id, normalize(deck), normalize(front), exclude] : [session.account_id, normalize(deck), normalize(front)])).all();
  return json({ matches: matches.results.map((row) => duplicateJson(row as DuplicateRow)) });
}

async function show(env: AccountEnv, session: Session, id: string): Promise<Response> {
  const row = await ownedCard(env, session.account_id, id);
  return row ? json({ card: cardJson(row) }) : failure(404, "not_found", "This card is unavailable.");
}

async function create(request: Request, env: AccountEnv, session: Session): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body!;
  if (Object.keys(body).some((key) => key !== "confirm" && key !== "deck" && key !== "front" && !BACK_FIELDS.includes(key as BackField)))
    return failure(400, "invalid_card", "Only card fields can be saved here.");
  const deckField = stringField(body, "deck");
  const frontField = stringField(body, "front");
  const back = {} as Record<BackField, string>;
  const errors: Record<string, string> = {};
  if (deckField.invalid || deckField.value.length > DECK_MAX)
    errors.deck = deckField.invalid ? "The deck name must be text." : `Keep the deck name at ${DECK_MAX} characters or fewer.`;
  for (const field of BACK_FIELDS) {
    const value = stringField(body, field);
    if (value.invalid) errors[field] = "This field must be text.";
    else back[field] = value.value;
  }
  const fieldErrors = fieldErrorsFor(frontField.value, back);
  const allErrors = { ...errors, ...fieldErrors };
  if (Object.keys(allErrors).length) return validationError(allErrors);
  const deck = deckField.value || DEFAULT_DECK;
  const duplicate = await findDuplicate(env, session.account_id, deck, frontField.value);
  if (duplicate && body.confirm !== true) return duplicateGate(duplicate);
  const now = Math.floor(Date.now() / 1000);
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
  ).bind(
    id, session.account_id, deck, normalize(deck), frontField.value, normalize(frontField.value),
    back.definition, back.vietnamese, back.partOfSpeech, back.pronunciation, back.synonyms, back.example, now, now,
  ).run();
  const row = await ownedCard(env, session.account_id, id);
  return row ? json({ card: cardJson(row) }, 201) : failure(503, "card_unavailable", "The card could not be opened. Try again.");
}

type BatchDraft = { front?: unknown; deck?: unknown; definition?: unknown; vietnamese?: unknown; partOfSpeech?: unknown; pronunciation?: unknown; synonyms?: unknown; example?: unknown };

async function saveBatch(request: Request, env: AccountEnv, session: Session): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body!;
  if (Object.keys(body).some(key => key !== "cards")) return failure(400, "invalid_batch", "Only the reviewed card batch can be saved.");
  if (!Array.isArray(body.cards) || body.cards.length === 0 || body.cards.length > BATCH_MAX)
    return failure(400, "invalid_batch", `Save between 1 and ${BATCH_MAX} reviewed cards.`);
  const errors: Record<string, Record<string, string>> = {};
  const normalizedCards: { deck: string; front: string; back: Record<BackField, string> }[] = [];
  const seen = new Map<string, number>();
  for (const [index, raw] of body.cards.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) { errors[String(index)] = { card: "This draft is invalid." }; continue; }
    const item = raw as BatchDraft;
    const values = {} as Record<BackField, string>;
    const fieldErrors: Record<string, string> = {};
    const front = typeof item.front === "string" ? item.front.trim() : "";
    const deck = item.deck === undefined ? DEFAULT_DECK : typeof item.deck === "string" ? item.deck.trim() : "";
    if (!deck || deck.length > DECK_MAX) fieldErrors.deck = deck ? `Keep the deck name at ${DECK_MAX} characters or fewer.` : "Name the destination deck.";
    if (front.length > FRONT_MAX) fieldErrors.front = `Keep the front at ${FRONT_MAX} characters or fewer.`;
    for (const field of BACK_FIELDS) {
      const value = item[field];
      if (value !== undefined && typeof value !== "string") fieldErrors[field] = "This field must be text.";
      values[field] = typeof value === "string" ? value.trim() : "";
      if (values[field].length > BACK_MAX) fieldErrors[field] = "Keep this field at 2,000 characters or fewer.";
    }
    if (!front) fieldErrors.front = "Add the word or phrase for the front of the card.";
    if (!BACK_FIELDS.some(field => values[field])) fieldErrors.back = "Add at least one back field.";
    if (Object.keys(fieldErrors).length) { errors[String(index)] = fieldErrors; continue; }
    const key = `${normalize(deck)}\u0000${normalize(front)}`;
    const prior = seen.get(key);
    if (prior !== undefined) { errors[String(index)] = { duplicate: `This draft duplicates draft ${prior + 1}.` }; continue; }
    seen.set(key, index);
    normalizedCards.push({ deck, front, back: values });
  }
  if (Object.keys(errors).length) return Response.json({ error: { code: "batch_invalid", message: "Review the card drafts before saving.", fieldErrors: errors } }, { status: 400, headers: noStore });
  const duplicates: Record<string, unknown> = {};
  for (const [index, card] of normalizedCards.entries()) {
    const duplicate = await findDuplicate(env, session.account_id, card.deck, card.front);
    if (duplicate) duplicates[String(index)] = duplicateJson(duplicate);
  }
  if (Object.keys(duplicates).length) return Response.json({ error: { code: "batch_duplicates", message: "Resolve duplicate cards before saving the batch.", duplicates } }, { status: 409, headers: noStore });
  const now = Math.floor(Date.now() / 1000);
  const statements = normalizedCards.map(card => {
    const id = crypto.randomUUID();
    return env.DB.prepare(`INSERT INTO personal_cards (id, account_id, deck, deck_key, front, front_key, definition, vietnamese, part_of_speech, pronunciation, synonyms, example, archived_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`)
      .bind(id, session.account_id, card.deck, normalize(card.deck), card.front, normalize(card.front), card.back.definition, card.back.vietnamese, card.back.partOfSpeech, card.back.pronunciation, card.back.synonyms, card.back.example, now, now);
  });
  try { await env.DB.batch(statements); }
  catch { return failure(503, "batch_failed", "The card batch was not saved. Your reviewed drafts are unchanged."); }
  const cards = await env.DB.prepare(`SELECT ${CARD_COLUMNS} FROM personal_cards WHERE account_id = ? AND created_at = ? ORDER BY rowid DESC LIMIT ?`).bind(session.account_id, now, normalizedCards.length).all();
  return json({ cards: (cards.results as CardRow[]).map(cardJson) }, 201);
}

async function edit(request: Request, env: AccountEnv, session: Session, id: string): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const row = await ownedCard(env, session.account_id, id);
  if (!row) return failure(404, "not_found", "This card is unavailable.");
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body!;
  if (Object.keys(body).some((key) => key !== "front" && !BACK_FIELDS.includes(key as BackField)))
    return failure(400, "invalid_card", "Only card fields can be changed here. Use move for the deck.");
  const frontField = stringField(body, "front");
  const back = { definition: row.definition, vietnamese: row.vietnamese, partOfSpeech: row.part_of_speech, pronunciation: row.pronunciation, synonyms: row.synonyms, example: row.example } as Record<BackField, string>;
  const errors: Record<string, string> = {};
  for (const field of BACK_FIELDS) {
    const value = stringField(body, field);
    if (value.invalid) errors[field] = "This field must be text.";
    else if (value.present) back[field] = value.value;
  }
  const fieldErrors = fieldErrorsFor(frontField.present ? frontField.value : row.front, back);
  const allErrors = { ...errors, ...fieldErrors };
  if (Object.keys(allErrors).length) return validationError(allErrors);
  const updates: string[] = [];
  const args: unknown[] = [];
  if (frontField.present) {
    updates.push("front = ?", "front_key = ?");
    args.push(frontField.value, normalize(frontField.value));
  }
  for (const field of BACK_FIELDS)
    if (body[field] !== undefined) {
      updates.push(`${String(BACK_COLUMNS[field])} = ?`);
      args.push(back[field]);
    }
  updates.push("updated_at = ?");
  args.push(Math.floor(Date.now() / 1000));
  await env.DB.prepare(`UPDATE personal_cards SET ${updates.join(", ")} WHERE id = ? AND account_id = ?`)
    .bind(...args, id, session.account_id).run();
  const updated = await ownedCard(env, session.account_id, id);
  return updated ? json({ card: cardJson(updated) }) : failure(503, "card_unavailable", "The card could not be opened. Try again.");
}

async function move(request: Request, env: AccountEnv, session: Session, id: string): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const row = await ownedCard(env, session.account_id, id);
  if (!row) return failure(404, "not_found", "This card is unavailable.");
  const parsed = await parseBody(request);
  if (parsed.response) return parsed.response;
  const body = parsed.body!;
  if (Object.keys(body).some((key) => key !== "deck" && key !== "confirm"))
    return failure(400, "invalid_card", "Only the deck can be changed here.");
  const deckField = stringField(body, "deck");
  if (deckField.invalid || !deckField.value || deckField.value.length > DECK_MAX)
    return validationError({ deck: deckField.invalid ? "The deck name must be text." : deckField.value ? `Keep the deck name at ${DECK_MAX} characters or fewer.` : "Name the deck to move the card into." });
  const duplicate = await findDuplicate(env, session.account_id, deckField.value, row.front, id);
  if (duplicate && body.confirm !== true) return duplicateGate(duplicate);
  await env.DB.prepare("UPDATE personal_cards SET deck = ?, deck_key = ?, updated_at = ? WHERE id = ? AND account_id = ?")
    .bind(deckField.value, normalize(deckField.value), Math.floor(Date.now() / 1000), id, session.account_id).run();
  const moved = await ownedCard(env, session.account_id, id);
  return moved ? json({ card: cardJson(moved) }) : failure(503, "card_unavailable", "The card could not be opened. Try again.");
}

async function setArchived(request: Request, env: AccountEnv, session: Session, id: string, archived: boolean): Promise<Response> {
  const rejected = await requireMutation(request, env, session);
  if (rejected) return rejected;
  const row = await ownedCard(env, session.account_id, id);
  if (!row) return failure(404, "not_found", "This card is unavailable.");
  if ((row.archived_at !== null) !== archived) {
    await env.DB.prepare(`UPDATE personal_cards SET archived_at = ?, updated_at = ? WHERE id = ? AND account_id = ?`)
      .bind(archived ? Math.floor(Date.now() / 1000) : null, Math.floor(Date.now() / 1000), id, session.account_id).run();
  }
  const updated = await ownedCard(env, session.account_id, id);
  return updated ? json({ card: cardJson(updated) }) : failure(503, "card_unavailable", "The card could not be opened. Try again.");
}

export function cardRoute(request: Request, env: AccountEnv): Promise<Response> | null {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/cards")) return null;
  return (async () => {
    const session = await currentSession(request, env);
    if (!session) return failure(401, "signed_out", "Sign in with Google to open your workspace.");
    if (request.method === "GET" && path === "/api/cards") return list(request, env, session);
    if (request.method === "GET" && path === "/api/cards/duplicates") return duplicates(request, env, session);
    if (request.method === "POST" && path === "/api/cards/batch") return saveBatch(request, env, session);
    if (request.method === "POST" && path === "/api/cards") return create(request, env, session);
    const single = /^\/api\/cards\/([A-Za-z0-9-]+)$/.exec(path);
    if (request.method === "GET" && single) return show(env, session, single[1]);
    if (request.method === "PATCH" && single) return edit(request, env, session, single[1]);
    const action = /^\/api\/cards\/([A-Za-z0-9-]+)\/(move|archive|restore)$/.exec(path);
    if (request.method === "POST" && action)
      return action[2] === "move" ? move(request, env, session, action[1]) : setArchived(request, env, session, action[1], action[2] === "archive");
    return failure(404, "not_found", "This card action is unavailable.");
  })();
}
