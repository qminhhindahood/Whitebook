import { mkdirSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { readFileSync } from "node:fs";
import { rmSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { buildImportSql, canonicalJson, sha256Hex } from "../scripts/build-deck-import.mjs";

const REAL_MANIFEST_DIR = new URL("../../vocab/manifests/", import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, "$1"); // Windows drive paths from URL

function syntheticManifest(dir: string, deckId: string, overrides: Record<string, unknown> = {}) {
  const cards = [
    { stable_id: "a".repeat(16), front: "corroborate", part_of_speech: "verb", ipa: "",
      meaning_vi: "xác nhận", definition_en: "to support with evidence", synonyms: "confirm",
      example_en: "Evidence corroborated the claim.", example_vi: "", cefr: "C1",
      audio: [], source_ref: "note 1", review_status: "approved" },
  ];
  const manifest: Record<string, unknown> = {
    schema_version: 1, deck_id: deckId, version: 1, status: "published",
    created_at: "2026-09-26T00:00:00+00:00", card_count: cards.length, approved_count: cards.length,
    source: { path: "D:\\Notion\\secret.pdf", sha256: "f".repeat(64), extraction: "test", imported_at: "2026-09-26T00:00:00+00:00" },
    cards_file: `${deckId}-v1-cards.json`,
    cards_sha256: sha256Hex(canonicalJson(cards)),
    manifest_sha256: "", ...overrides,
  };
  manifest.manifest_sha256 = sha256Hex(canonicalJson({ ...manifest, manifest_sha256: undefined }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${deckId}-manifest.json`), JSON.stringify(manifest), "utf8");
  writeFileSync(join(dir, manifest.cards_file as string), JSON.stringify(cards), "utf8");
  return { manifest, cards };
}

it("canonical JSON matches the manifest hash format byte for byte", () => {
  const value = { b: "xác nhận", a: [1, "two"], c: { deeper: "value\" with 'quotes'" } };
  // Python: json.dumps(value, ensure_ascii=False, sort_keys=True)
  expect(canonicalJson(value)).toBe(
    `{"a": [1, "two"], "b": "xác nhận", "c": {"deeper": "value\\" with 'quotes'"}}`,
  );
  expect(sha256Hex(canonicalJson({ a: 1 }))).toBe(sha256Hex(canonicalJson({ a: 1 })));
});

it("imports exactly the owner-reviewed published decks and skips drafts", () => {
  const { sql, imported, skipped } = buildImportSql(REAL_MANIFEST_DIR);
  expect(imported.map((deck) => `${deck.deck} v${deck.version} (${deck.cards})`).sort()).toEqual([
    "anki_starter v2 (839)",
    "b2c1_1000 v3 (1000)",
  ]);
  expect(skipped.map((deck) => deck.deck)).toEqual(["c1c2_wic500"]);
  expect(skipped[0].reason).toContain("not published");
  expect(sql.split("INSERT OR IGNORE INTO starter_deck_cards").length - 1).toBe(1839);
});

it("keeps manifest provenance out of the learner payload SQL", () => {
  const { sql } = buildImportSql(REAL_MANIFEST_DIR);
  // Only the reviewed card columns may be inserted.
  const insert = /INSERT OR IGNORE INTO starter_deck_cards \(([^)]*)\)/.exec(sql)![1];
  expect(insert.split(", ").sort()).toEqual([
    "cefr", "deck_id", "definition_en", "example_en", "example_vi", "front",
    "ipa", "meaning_vi", "part_of_speech", "stable_id", "synonyms", "version",
  ]);
  // Provenance values from the real manifests must never appear.
  for (const forbidden of [
    "D:\\Notion", "1000_tu_SAT_B2-C1", "aanhlle", ".apkg", ".pdf",
    "anki21b-sqlite", "tesseract-eng+vie-300dpi-threshold", "pymupdf-table-grid+span-rebuild",
    "review_status", "draft-pending-owner-review",
  ])
    expect(sql.includes(forbidden), `learner SQL must not contain ${forbidden}`).toBe(false);
});

it("refuses a published manifest whose cards file was tampered with", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-import-"));
  try {
    const { manifest } = syntheticManifest(dir, "tampered_deck");
    const cards = JSON.parse(readFileSync(join(dir, manifest.cards_file as string), "utf8"));
    cards[0].meaning_vi = "tampered";
    writeFileSync(join(dir, manifest.cards_file as string), JSON.stringify(cards), "utf8");
    expect(() => buildImportSql(dir)).toThrowError(/tampering or truncation/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("refuses a published manifest whose declared card_count does not match the cards file", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-import-"));
  try {
    syntheticManifest(dir, "short_deck", { card_count: 5 }); // cards file actually holds 1 row
    expect(() => buildImportSql(dir)).toThrowError(/declares card_count 5/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("skips a draft manifest and refuses a published manifest with a missing cards file", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-import-"));
  try {
    syntheticManifest(dir, "draft_deck", { status: "draft-pending-owner-review" });
    const draft = buildImportSql(dir);
    expect(draft.imported).toEqual([]);
    expect(draft.skipped[0].deck).toBe("draft_deck");

    const { manifest } = syntheticManifest(dir, "orphan_deck");
    rmSync(join(dir, manifest.cards_file as string));
    expect(() => buildImportSql(dir)).toThrowError(/missing or unreadable/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

it("applies the real bundle into D1-shaped storage idempotently", () => {
  const db = new DatabaseSync(":memory:");
  for (const name of ["0001_staging_fixture.sql", "0002_learner_accounts.sql", "0003_personal_cards.sql", "0004_account_time_zone.sql", "0005_starter_decks.sql"])
    db.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  const { sql } = buildImportSql(REAL_MANIFEST_DIR);
  db.exec(sql);
  const versions = db.prepare("SELECT deck_id, version, status, card_count FROM starter_deck_versions ORDER BY deck_id").all();
  expect(versions).toEqual([
    { deck_id: "anki_starter", version: 2, status: "published", card_count: 839 },
    { deck_id: "b2c1_1000", version: 3, status: "published", card_count: 1000 },
  ]);
  const cards = db.prepare("SELECT COUNT(*) AS n FROM starter_deck_cards").get() as { n: number };
  expect(cards.n).toBe(1839);
  const vietnamese = db.prepare(
    "SELECT front, meaning_vi FROM starter_deck_cards WHERE deck_id = 'anki_starter' AND stable_id = '9aab0358a15c8172'",
  ).get() as { front: string; meaning_vi: string };
  expect(vietnamese.front).toBe("confound");
  expect(vietnamese.meaning_vi.length).toBeGreaterThan(0); // diacritics survived the round trip
  db.exec(sql); // re-running the same bundle must be a no-op
  const after = db.prepare("SELECT COUNT(*) AS n FROM starter_deck_cards").get() as { n: number };
  expect(after.n).toBe(1839);
});
