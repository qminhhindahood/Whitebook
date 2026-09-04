# G — Implement local Math configuration loading

**Parent tickets:** 10 — Gate Math on Desmos and Reference readiness; 13 — Export and restore verified backups; 14 — Add privacy-safe diagnostics and hardening.

**Read first:** `AGENTS.md`, `CONTEXT.md`, `.scratch/whitebook-mvp/spec.md` under “Desmos and Reference Sheet,” ADR `docs/adr/0003-gate-math-on-desmos-readiness.md`, and `.scratch/whitebook-mvp/issues/10-gate-math-on-desmos-and-reference-readiness.md`.

## Outcome

Create a backend configuration reader for the one project-wide Desmos API key and the one global Reference Sheet PNG path. Use environment variable `WHITEBOOK_DESMOS_API_KEY` for the key and a data-root-relative non-secret setting for the image. Report missing/invalid values with structured readiness diagnostics while ensuring the key cannot appear through `repr`, `str`, serialization, or ordinary diagnostic output.

## Owned paths

- `src/whitebook/math_config.py`
- `tests/test_math_config.py`
- `.env.example`

Do not load Desmos, implement a calculator, parse the PNG beyond a conservative signature/path check, add backup code, add routes, or touch frontend files.

## Interface bound

Return a configuration value that exposes the actual key only through an intentionally named method used later by the browser bootstrap adapter. Its normal representation must remain redacted. Resolve the Reference Sheet below the supplied data root through a caller-provided path boundary.

## Completion criteria

- Tests cover missing/present key, redacted representations, missing/outside/non-PNG reference image, and valid PNG signature.
- Tests prove the key does not appear in diagnostic values or serialized non-secret settings.
- `.env.example` contains the variable name with no real key.
- `uv run pytest tests/test_math_config.py -q` passes.

Return the commit hash and the intentional secret-access method name.
