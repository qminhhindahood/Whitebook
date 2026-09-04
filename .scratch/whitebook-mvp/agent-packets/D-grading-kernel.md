# D — Implement deterministic grading primitives

**Parent tickets:** 05 — Take and score one Practice Module; 11 — Review Results and practise mistakes.

**Read first:** `AGENTS.md`, `CONTEXT.md`, `.scratch/whitebook-mvp/spec.md` under “Source and Answer CSV contract” and “Results, history, and storage,” and `.scratch/whitebook-mvp/issues/11-review-results-and-practise-mistakes.md`.

## Outcome

Create pure grading functions for MCQ and student-produced responses plus a Raw Accuracy summary. MCQ grades only the selected A–D response. SPR comparison trims surrounding whitespace and applies a small explicit map of safe minus and decimal glyph variants, then compares only against the representations supplied by the Answer Manifest; it performs no numeric or algebraic equivalence solving. Unanswered questions remain in the denominator.

## Owned paths

- `src/whitebook/grading.py`
- `tests/test_grading.py`

Do not import CSV-parser models, add persistence, create Results filters, add routes, or touch frontend files.

## Interface bound

Accept primitive values or small local immutable value objects so Package Authoring and Results can both call the module later. Return explicit correct/incorrect/unanswered status per question and aggregate counts plus percentage. Define zero-question behavior explicitly even though published Attempts will contain questions.

## Completion criteria

- Tests cover correct/incorrect/unanswered MCQ, each accepted SPR representation, whitespace, safe glyph normalization, deliberately non-equivalent numeric forms, and unanswered denominator behavior.
- Tests prove only the selected response affects grading; eliminated choices are irrelevant.
- `uv run pytest tests/test_grading.py -q` passes.

Return the commit hash and list the exact glyph substitutions implemented.
