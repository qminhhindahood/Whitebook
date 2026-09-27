-- Category metadata is stored separately so existing immutable publication rows remain valid.
-- An absent row means the source Question Category has not been reviewed for hosted use.
CREATE TABLE publication_question_categories (
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  category TEXT NOT NULL,
  PRIMARY KEY (revision_id, question_id),
  FOREIGN KEY (revision_id, question_id) REFERENCES publication_questions(revision_id, question_id)
);
