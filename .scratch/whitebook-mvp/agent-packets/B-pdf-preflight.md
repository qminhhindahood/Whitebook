# B — Implement Source PDF preflight

**Parent tickets:** 02 — Create and validate an Import Draft; 14 — Add privacy-safe diagnostics and hardening.

**Read first:** `AGENTS.md`, `CONTEXT.md`, `.scratch/whitebook-mvp/spec.md` under “PDF authoring and Test Packages,” and `.scratch/whitebook-mvp/issues/02-create-and-validate-an-import-draft.md`.

## Outcome

Create a backend-only Source PDF preflight that validates the `.pdf` extension, PDF signature and parseability, the 250 MB size limit, the 500-page limit, and password protection. For accepted input, compute its SHA-256 hash and copy it into a caller-supplied private directory under a generated filename while returning the original filename only as display metadata.

## Owned paths

- `src/whitebook/pdf_preflight.py`
- `tests/test_pdf_preflight.py`
- `tests/fixtures/pdfs/` only for compact generated fixtures
- `pyproject.toml` and `uv.lock` only to add the selected PDF parsing dependency

Do not add routes, database tables, PDF rendering, region mapping, or frontend files.

## Interface bound

Return a structured accepted result or structured diagnostics; callers must not infer failure types from exception prose. Stream hashing and copying so the implementation does not need to load a permitted 250 MB file into memory. A failed preflight must not leave a copied file behind.

## Completion criteria

- Tests cover ordinary, malformed, extension-mismatched, password-protected, oversized, and over-page-limit inputs.
- Tests prove generated storage names do not contain the original base filename and remain inside the supplied directory.
- Tests prove a failed copy/preflight leaves no partial durable file.
- `uv run pytest tests/test_pdf_preflight.py -q` passes.

Return the commit hash and name the PDF dependency/version range added.
