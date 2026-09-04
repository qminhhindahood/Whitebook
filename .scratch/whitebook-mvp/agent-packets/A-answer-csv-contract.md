# A — Implement the Answer CSV v1 contract

**Parent tickets:** 02 — Create and validate an Import Draft; 14 — Add privacy-safe diagnostics and hardening.

**Read first:** `AGENTS.md`, `CONTEXT.md`, `.scratch/whitebook-mvp/spec.md` under “Source and Answer CSV contract,” and `.scratch/whitebook-mvp/issues/02-create-and-validate-an-import-draft.md`.

## Outcome

Create a pure parser that accepts CSV bytes and returns either canonical Answer rows or row/field diagnostics. It must enforce the exact six-column v1 contract, canonical Section/type/category values, Module and question-number rules, MCQ values, explicit `|`-separated SPR representations, duplicate numbering, UTF-8, and the 10 MB limit. Include functions that produce the blank and example v1 CSV bytes used later by the HTTP download endpoints.

## Owned paths

- `src/whitebook/answer_csv.py`
- `tests/test_answer_csv.py`

Do not edit package initializers, FastAPI routes, storage code, or frontend files.

## Interface bound

Expose immutable row and diagnostic value objects plus one parse function. Callers must be able to distinguish a valid manifest input from invalid input without parsing exception strings. Preserve source row numbers in diagnostics. Keep generated internal IDs and database persistence outside this packet.

## Completion criteria

- Tests cover exact/missing/extra headers, invalid encoding, required values, duplicate numbering, canonicalization, every approved category, MCQ constraints, and multiple accepted SPR strings.
- Blank and example outputs parse successfully under the same function.
- No CSV content or accepted answer appears in exception text or logs.
- `uv run pytest tests/test_answer_csv.py -q` passes.

Return the commit hash and a short list of any deliberately unresolved integration decisions.

