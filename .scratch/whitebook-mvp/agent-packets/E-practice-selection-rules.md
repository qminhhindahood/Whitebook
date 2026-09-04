# E — Implement pure Practice selection rules

**Parent ticket:** 07 — Configure Practice with the Practice Builder.

**Read first:** `AGENTS.md`, `CONTEXT.md`, `.scratch/whitebook-mvp/spec.md` under “Practice Builder,” and `.scratch/whitebook-mvp/issues/07-configure-practice-with-the-practice-builder.md`.

## Outcome

Create a pure planner for filtering questions from exactly one package, capping requested counts without duplication, allocating counts across one or two selected Modules, preserving source order, deterministic per-Section shuffle, and determining timing eligibility. SAT-Paced Timing is available only for a complete Reading and Writing Module (32 minutes) or complete Math Module (35 minutes); partial selections allow Elapsed Timing or a caller-supplied Custom Countdown with no proportional SAT time.

## Owned paths

- `src/whitebook/practice_rules.py`
- `tests/test_practice_rules.py`

Do not implement presets copy, remembered settings persistence, Attempt creation, routes, database work, or frontend files.

## Interface bound

Accept immutable question descriptors from one package and an explicit selection request. Return an immutable ordered plan or structured reason codes. Randomness must be injected as a seed or random source so tests stay deterministic.

## Completion criteria

- Tests cover All Questions including uncategorized rows, category filtering, cap-to-availability, no duplicates, even allocation with odd totals, exact per-Module allocation, source order, shuffle boundaries, and all timing eligibility cases.
- Invalid requests return structured reasons rather than partially valid plans.
- `uv run pytest tests/test_practice_rules.py -q` passes.

Return the commit hash and the final request/result types.

