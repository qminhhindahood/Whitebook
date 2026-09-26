CREATE TABLE staging_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);

CREATE TABLE fixture_questions (
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  presentation_json TEXT NOT NULL,
  PRIMARY KEY (revision_id, question_id)
);

CREATE TABLE answer_keys (
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  accepted_answers_json TEXT NOT NULL,
  PRIMARY KEY (revision_id, question_id)
);

CREATE TABLE fixture_assets (
  path TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  content_type TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  FOREIGN KEY (revision_id, question_id) REFERENCES fixture_questions(revision_id, question_id)
);

INSERT INTO fixture_questions (revision_id, question_id, presentation_json) VALUES
('v1', 'fixture-1', '{"version":1,"stimulus":[],"stem":[{"kind":"text","text":"What is the area of the triangle?"},{"kind":"asset","src":"/content/v1/fixture-1/triangle.svg","alt":"Triangle with base 4 and height 3"}],"choices":[{"id":"A","content":[{"kind":"text","text":"4"}]},{"id":"B","content":[{"kind":"text","text":"6"}]},{"id":"C","content":[{"kind":"text","text":"8"}]},{"id":"D","content":[{"kind":"text","text":"12"}]}]}');

INSERT INTO answer_keys (revision_id, question_id, accepted_answers_json) VALUES
('v1', 'fixture-1', '["B"]');

INSERT INTO fixture_assets (path, revision_id, question_id, content_type, sha256, byte_size) VALUES
('/content/v1/fixture-1/triangle.svg', 'v1', 'fixture-1', 'image/svg+xml', '9255733aaf9f78b49f5f49474cc16c8cfa79b97e2543527dc1240e82ed157fc2', 714);
