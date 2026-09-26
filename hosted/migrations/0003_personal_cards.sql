CREATE TABLE personal_cards (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  deck TEXT NOT NULL,
  deck_key TEXT NOT NULL,
  front TEXT NOT NULL,
  front_key TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  vietnamese TEXT NOT NULL DEFAULT '',
  part_of_speech TEXT NOT NULL DEFAULT '',
  pronunciation TEXT NOT NULL DEFAULT '',
  synonyms TEXT NOT NULL DEFAULT '',
  example TEXT NOT NULL DEFAULT '',
  archived_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX personal_cards_account_deck ON personal_cards(account_id, deck_key);
CREATE INDEX personal_cards_account_front ON personal_cards(account_id, front_key);

-- Prior review history lives here and is never rewritten by content edits.
-- Ticket 10 (due flashcards) adds the rating API on top of this table.
CREATE TABLE card_rating_events (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES personal_cards(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('not_sure', 'sure')),
  rating_zone TEXT NOT NULL,
  next_due TEXT NOT NULL,
  rated_at INTEGER NOT NULL
);

CREATE INDEX card_rating_events_card ON card_rating_events(card_id);
