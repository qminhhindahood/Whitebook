# 06 — Restore and resume safely across content upgrades

**What to build:** Older backups and Attempts remain recoverable. Missing presentation produces an actionable readiness message; it never starts a timer with blank content or silently changes saved responses.

**Blocked by:** 4.

**Owner:** Bank/backend agent.

**Status:** resolved

- [x] Backup restore now runs `initialize_database` after the swap, so a restored database from an older schema is migrated in place (revision column added; the historical unique source-hash constraint rebuilt away) without touching its rows. `tests/test_restore_migration.py` restores a schema-v2 database and verifies version, constraint removal, foreign-key check, and that revisions with identical hash pairs are accepted afterwards.
- [x] Paused attempts resume from their frozen plan: a package revision published after pausing does not leak into the resumed attempt, saved responses are preserved, and grading is unchanged (`test_paused_attempt_resumes_with_its_frozen_content_and_responses`).
- [x] The timer cannot start without usable content: `begin` requires the gate readiness to be `ready`, `resume` requires `resumeReady`, and the Loading Gate blocks Begin with the per-question `presentationIssue` message for content that has not been converted.
- [x] Older attempt records are preserved and reported rather than displayed as blank boxes; completed attempts remain reviewable through the Results region fallback.
