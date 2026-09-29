CREATE TABLE reminder_dismissals (
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  reminder_key TEXT NOT NULL,
  dismissed_at_ms INTEGER NOT NULL,
  PRIMARY KEY (account_id, reminder_key)
);
