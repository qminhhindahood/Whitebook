ALTER TABLE learner_attempts ADD COLUMN answers_exposed_at_ms INTEGER;

CREATE TABLE guided_reviews (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL REFERENCES learner_attempts(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  prior_answer_exposure TEXT NOT NULL CHECK (prior_answer_exposure IN ('seen', 'possible')),
  retry_response TEXT,
  hint_used INTEGER NOT NULL DEFAULT 0 CHECK (hint_used IN (0, 1)),
  revealed_at_ms INTEGER,
  mistake_label TEXT,
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (revision_id, question_id) REFERENCES publication_questions(revision_id, question_id)
);
CREATE INDEX guided_reviews_attempt_question ON guided_reviews(account_id, attempt_id, question_id, created_at_ms DESC);
CREATE INDEX guided_reviews_revision_question ON guided_reviews(account_id, revision_id, question_id, revealed_at_ms);

CREATE TABLE study_notes (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at_ms INTEGER NOT NULL,
  updated_at_ms INTEGER NOT NULL,
  FOREIGN KEY (revision_id, question_id) REFERENCES publication_questions(revision_id, question_id)
);
CREATE INDEX study_notes_question ON study_notes(account_id, revision_id, question_id, created_at_ms);

CREATE TABLE publication_review_help (
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  reviewed_hint TEXT,
  reviewed_explanation TEXT,
  PRIMARY KEY (revision_id, question_id),
  FOREIGN KEY (revision_id, question_id) REFERENCES publication_questions(revision_id, question_id),
  CHECK (reviewed_hint IS NOT NULL OR reviewed_explanation IS NOT NULL)
);
