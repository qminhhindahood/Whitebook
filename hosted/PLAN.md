# Study Plan (ticket 13)

Apply `migrations/0009_study_plans.sql` before serving the Plan API. The migration stores complete versions, their tasks, and append-only task change events under a Learner Account. Rebuilds create a new version; old versions and their final task states remain readable until the account is deleted. Completed work is counted across versions. There is no automatic version pruning.

## API

- `GET /api/account/plan` returns the latest version, every version header, current evidence counts, a stale-evidence flag, and overdue task count. `?version=<id>` reads any version owned by this account.
- `POST /api/account/plan` accepts `{settings, expectedVersionId}` and builds a new version. `settings` contains the selected primary SAT date, all seven days partitioned into study and rest days, 10–240 daily minutes, and an optional valid official-score goal. The primary date must match the account's selected future SAT Weekend date. The expected ID prevents a second device from silently replacing a newer plan.
- `PATCH /api/account/plan/tasks/:id` accepts `expectedRevision` and optional `status`, `date`, `minutes`, and `title`. It changes only a task in the account's current plan, after verifying the current primary date, study day, exam boundary, and daily capacity. A stale revision or account-owned mismatch returns a structured conflict. D1 triggers enforce day and capacity constraints even if concurrent writes race.

All mutations use the account session, same-origin check, and CSRF token. Every task action points to Flashcards, a completed Attempt question in History, or an entitled Test Package and Section in Practice. Clients never submit arbitrary action targets. Task changes are recorded in `study_plan_task_events` in the same D1 batch as the revision update.

Generated tasks are inserted from one bound JSON array in a single D1 statement. This keeps long plans within the [Workers Free D1 query limit](https://developers.cloudflare.com/d1/platform/limits/) while the database checks each task's study day and daily capacity.

## Deterministic rules

The plan uses the account's saved IANA zone, or UTC when none is saved, to decide today's calendar date. It schedules only study days before the primary SAT date. Due cards are a small first task; the title limits the number of cards to what fits in the estimate. Missed questions from completed Attempts are offered for guided review. A correctly completed guided retry removes that question from review suggestions, while unfinished or unsuccessful retries remain eligible. Only currently entitled package revisions become Practice tasks. One section Practice task is scheduled per week, prioritized by unassisted Whitebook Section evidence and, separately, the learner's latest entered official Section score. Recommendations with thin practice evidence are tentative.

Raw Accuracy is labeled Whitebook practice evidence and is never converted into SAT score points. The optional score goal is recorded as a personal target, without a predicted outcome. When there is no completed Attempt or Official SAT Result, the UI gives a baseline prompt. AI availability has no effect on plan generation.

Progress shows done, pending, and skipped counts for the selected version, each week's completed count, and completed work retained across all versions. Past-due tasks offer a move to the next open study day, skip, or rebuild. Moving a task never overrides rest days or daily minutes. A new Attempt, review, due-card count, score entry, or primary-date change marks the latest plan stale; rebuilding preserves the previous version and its edits.
