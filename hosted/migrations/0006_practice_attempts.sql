CREATE TABLE learner_attempts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES package_revisions(id),
  kind TEXT NOT NULL CHECK (kind IN ('practice', 'section_exam')),
  status TEXT NOT NULL CHECK (status IN ('preparing', 'active', 'completed', 'expired')),
  config_json TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  state_json TEXT NOT NULL,
  state_version INTEGER NOT NULL DEFAULT 0 CHECK (state_version >= 0),
  created_at_ms INTEGER NOT NULL,
  started_at_ms INTEGER,
  deadline_at_ms INTEGER,
  completed_at_ms INTEGER,
  result_json TEXT,
  editor_token_hash TEXT,
  editor_lease_expires_at_ms INTEGER,
  CHECK ((editor_token_hash IS NULL) = (editor_lease_expires_at_ms IS NULL)),
  CHECK (status != 'preparing' OR started_at_ms IS NULL),
  CHECK (status != 'active' OR (started_at_ms IS NOT NULL AND editor_token_hash IS NOT NULL)),
  CHECK (deadline_at_ms IS NULL OR started_at_ms IS NOT NULL)
);

CREATE INDEX learner_attempts_account_created
  ON learner_attempts(account_id, created_at_ms DESC);

CREATE INDEX learner_attempts_account_status
  ON learner_attempts(account_id, status);
