-- The learner's saved IANA time zone for date-only study math (flashcards due
-- dates, countdowns). Empty means "not saved yet": reads and ratings fall back
-- to the zone supplied by the learner's device. Changing this value never
-- rewrites stored due dates or rating events; it only changes how "today" is
-- evaluated from now on.
ALTER TABLE learner_accounts ADD COLUMN time_zone TEXT NOT NULL DEFAULT '';
