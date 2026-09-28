-- Preview content never enters D1. Only single-use, session-bound nonces live here.
CREATE TABLE assistant_previews (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  session_hash TEXT NOT NULL REFERENCES learner_sessions(token_hash) ON DELETE CASCADE ON UPDATE CASCADE,
  visit_id TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL
);
CREATE INDEX assistant_previews_expiry ON assistant_previews(expires_at_ms);
CREATE INDEX assistant_previews_account ON assistant_previews(account_id);

CREATE TABLE assistant_credentials (
  account_id TEXT PRIMARY KEY REFERENCES learner_accounts(id) ON DELETE CASCADE,
  version TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  last_four TEXT NOT NULL
);

-- Conservative reservations include input bytes + maximum output tokens, even on failure.
CREATE TABLE assistant_limits (
  scope TEXT NOT NULL,
  window_ms INTEGER NOT NULL,
  requests INTEGER NOT NULL,
  tokens INTEGER NOT NULL,
  PRIMARY KEY (scope, window_ms)
);
