CREATE TABLE publication_releases (
  id TEXT PRIMARY KEY,
  manifest_sha256 TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE package_revisions (
  id TEXT PRIMARY KEY,
  family_id TEXT NOT NULL,
  title TEXT NOT NULL,
  source_revision INTEGER NOT NULL,
  published_revision INTEGER NOT NULL,
  content_sha256 TEXT NOT NULL,
  question_count INTEGER NOT NULL CHECK (question_count > 0)
);

CREATE TABLE publication_release_revisions (
  release_id TEXT NOT NULL REFERENCES publication_releases(id),
  revision_id TEXT NOT NULL REFERENCES package_revisions(id),
  PRIMARY KEY (release_id, revision_id)
);

CREATE TABLE publication_questions (
  revision_id TEXT NOT NULL REFERENCES package_revisions(id),
  question_id TEXT NOT NULL,
  source_question_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  section TEXT NOT NULL,
  module INTEGER NOT NULL,
  question_number INTEGER NOT NULL,
  response_type TEXT NOT NULL,
  presentation_json TEXT NOT NULL,
  PRIMARY KEY (revision_id, question_id),
  UNIQUE (revision_id, ordinal),
  UNIQUE (revision_id, source_question_id)
);

CREATE TABLE publication_answers (
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  accepted_answers_json TEXT NOT NULL,
  PRIMARY KEY (revision_id, question_id),
  FOREIGN KEY (revision_id, question_id) REFERENCES publication_questions(revision_id, question_id)
);

CREATE TABLE publication_assets (
  path TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  FOREIGN KEY (revision_id, question_id) REFERENCES publication_questions(revision_id, question_id)
);

CREATE TABLE active_publication (
  slot INTEGER PRIMARY KEY CHECK (slot = 1),
  release_id TEXT NOT NULL REFERENCES publication_releases(id)
);

CREATE TABLE activated_publication_releases (
  release_id TEXT PRIMARY KEY REFERENCES publication_releases(id)
);

CREATE TRIGGER active_publication_insert AFTER INSERT ON active_publication
BEGIN
  INSERT INTO activated_publication_releases (release_id)
    SELECT NEW.release_id WHERE NOT EXISTS
      (SELECT 1 FROM activated_publication_releases WHERE release_id = NEW.release_id);
END;

CREATE TRIGGER active_publication_update AFTER UPDATE OF release_id ON active_publication
BEGIN
  INSERT INTO activated_publication_releases (release_id)
    SELECT NEW.release_id WHERE NOT EXISTS
      (SELECT 1 FROM activated_publication_releases WHERE release_id = NEW.release_id);
END;

CREATE TABLE private_revision_entitlements (
  account_id TEXT NOT NULL REFERENCES learner_accounts(id) ON DELETE CASCADE,
  revision_id TEXT NOT NULL REFERENCES package_revisions(id),
  PRIMARY KEY (account_id, revision_id)
);
