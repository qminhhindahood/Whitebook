ALTER TABLE learner_attempts ADD COLUMN assisted_at_ms INTEGER;

CREATE INDEX learner_attempts_assisted ON learner_attempts(account_id, assisted_at_ms);
