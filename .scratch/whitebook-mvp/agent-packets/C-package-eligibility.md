# C — Implement Test Package eligibility rules

**Parent tickets:** 04 — Publish an immutable Test Package; 08 — Run a Full SAT Simulation.

**Read first:** `AGENTS.md`, `CONTEXT.md`, `.scratch/whitebook-mvp/spec.md` under “PDF authoring and Test Packages,” and `.scratch/whitebook-mvp/issues/04-publish-an-immutable-test-package.md`.

## Outcome

Create a pure classifier that reports whether a validated set of question descriptors is eligible for Full SAT Simulation and, when it is not, returns precise machine-readable reasons. The sole eligible shape is Reading and Writing Modules 1 and 2 with 27 unique ordered questions each plus Math Modules 1 and 2 with 22 unique ordered questions each. Partial shapes remain Practice-eligible.

## Owned paths

- `src/whitebook/package_eligibility.py`
- `tests/test_package_eligibility.py`

Do not implement publication, hashing, identifiers, revisions, database persistence, routes, or frontend files.

## Interface bound

Accept ordinary immutable descriptors rather than importing database models. Return a value object containing `practice_eligible`, `simulation_eligible`, and reason codes. Keep the function deterministic and free of I/O.

## Completion criteria

- Tests cover the exact full shape, single Module, one missing question, one extra question, duplicate numbering, invalid Module, and Math-only/Reading-and-Writing-only packages.
- The classifier never rejects a nonempty structurally valid partial package for Practice merely because it is not Simulation-capable.
- `uv run pytest tests/test_package_eligibility.py -q` passes.

Return the commit hash and the final public function signature.
