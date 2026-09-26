ALTER TABLE learner_accounts ADD COLUMN time_zone TEXT NOT NULL DEFAULT '';

CREATE TABLE learner_sat_dates (
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  test_date TEXT NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
  selected_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, test_date)
);
