-- Shared, read-only Starter Deck content, imported only from owner-reviewed
-- versioned deck bundles (see vocab/scripts/publish_decks.py and
-- hosted/scripts/build-deck-import.mjs). The schema-level CHECK makes it
-- impossible to store a deck version that was not imported as published.
-- Per-account rating state lives in starter_card_rating_events and never in
-- this shared content.

CREATE TABLE starter_deck_versions (
  deck_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status = 'published'),
  cards_sha256 TEXT NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  card_count INTEGER NOT NULL,
  imported_at INTEGER NOT NULL,
  PRIMARY KEY (deck_id, version)
);

-- Only the reviewed learner-facing fields are stored. Provenance columns from
-- the manifest (source path/hash, extraction, review status, source_ref) are
-- deliberately dropped at import so they can never reach a learner payload.
CREATE TABLE starter_deck_cards (
  deck_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  stable_id TEXT NOT NULL,
  front TEXT NOT NULL,
  part_of_speech TEXT NOT NULL DEFAULT '',
  ipa TEXT NOT NULL DEFAULT '',
  meaning_vi TEXT NOT NULL DEFAULT '',
  definition_en TEXT NOT NULL DEFAULT '',
  synonyms TEXT NOT NULL DEFAULT '',
  example_en TEXT NOT NULL DEFAULT '',
  example_vi TEXT NOT NULL DEFAULT '',
  cefr TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (deck_id, version, stable_id)
);

-- One row per rating event. The primary key is derived from the learner's
-- request id, so a retried request applies the same rating exactly once even
-- across a travel-day zone change that repeats the local calendar date.
CREATE TABLE starter_card_rating_events (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  deck_id TEXT NOT NULL,
  stable_id TEXT NOT NULL,
  rating TEXT NOT NULL CHECK (rating IN ('not_sure', 'sure')),
  rating_zone TEXT NOT NULL,
  next_due TEXT NOT NULL,
  rated_at INTEGER NOT NULL
);

CREATE INDEX starter_card_rating_events_account ON starter_card_rating_events(account_id);
