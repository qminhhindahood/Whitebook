-- Only explicitly reviewed passage transcription for image fallback belongs here.
-- Ordinary reviewed text is read from stimulus blocks; prompts and keys are excluded.
CREATE TABLE publication_passage_search (
  revision_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  passage_text TEXT NOT NULL,
  PRIMARY KEY (revision_id, question_id),
  FOREIGN KEY (revision_id, question_id) REFERENCES publication_questions(revision_id, question_id)
);
