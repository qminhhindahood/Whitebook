# F — Implement storage-path and redaction primitives

**Parent tickets:** 12 — Manage Library and History lifecycle; 13 — Export and restore verified backups; 14 — Add privacy-safe diagnostics and hardening.

**Read first:** `AGENTS.md`, `CONTEXT.md`, `.scratch/whitebook-mvp/spec.md` under “Architecture and isolation” and “Results, history, and storage,” and `.scratch/whitebook-mvp/issues/14-add-privacy-safe-diagnostics-and-hardening.md`.

## Outcome

Create small security primitives that generate opaque storage names, resolve a candidate path only when it remains below a supplied Whitebook data root, validate portable ZIP member names without extracting them, and redact registered secrets plus sensitive absolute paths from diagnostic strings.

## Owned paths

- `src/whitebook/safety.py`
- `tests/test_safety.py`

Do not configure application logging, open folders, delete files, extract backups, add routes, or touch frontend files.

## Interface bound

Every path decision must be explicit: return a safe resolved path or a structured rejection, never silently rewrite traversal input. Keep redaction deterministic and ensure the returned diagnostic remains useful by preserving non-sensitive stage/error metadata.

## Completion criteria

- Tests cover `..`, absolute paths, drive-prefixed paths, mixed separators, symlink escape, ZIP traversal names, generated-name uniqueness/character set, token/key redaction, and sensitive-root redaction.
- Tests create only temporary roots and never resolve or mutate paths outside them.
- `uv run pytest tests/test_safety.py -q` passes.

Return the commit hash and the structured rejection codes.

