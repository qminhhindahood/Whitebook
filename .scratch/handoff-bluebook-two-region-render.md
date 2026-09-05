# Handoff: Bluebook-style two-region question rendering

> SUPERSEDED on 2026-09-05 after the user's design review. Use [the current interface design and content handoff](player-content-layout/spec.md). The user requires answer content inside individually clickable boxes, new layouts only, no content zoom, centered Math multiple choice, and split Math typed responses with directions. Another agent will convert the three banks. The original analysis below is historical; its two-crop solution, migration assumptions, and live-instance details must not be treated as current instructions.

Status: analysis complete, **no code changes made yet**. Everything below was verified by reading the code and probing the live app on 2026-09-05.

## 1. Goal

In the real Bluebook app the player shows: **left panel = passage/stimulus, right panel = question stem + answer choices with full text**. Whitebook currently dumps every region into the left panel and shows bare A–D bubbles on the right. The user wants the Bluebook layout.

User decision (from an explicit choice): **two-region split** — in the Region Mapper the user draws two regions per question: a `stimulus` region (renders left) and a `question` region (renders right, as a cropped image above the A–D buttons). No OCR, no CSV text columns; works with the scanned PDFs as-is.

Reference for the target look: user-supplied Bluebook screenshot (bluebooky.com watermark) — header "Section 1: Reading and Writing" + timer + Report/Highlights/Exit, colorful accent strip, left passage panel, right panel with question-number badge, "Mark for Review", stem, bordered A–D choice boxes, footer "Question 1 of N" pill + Next.

## 2. How to run / current live state

- Repo: `D:\Notion\UI` (win32, Git Bash shell). Build: `npm run build` (runs `tsc -b && vite build`). Backend tests: `uv run pytest -q`. Frontend tests: `npm --prefix web test`. Lint: `uv run ruff check src tests`.
- Server currently running in background: pid 4364, **port 63324**. Bootstrap URL: `http://127.0.0.1:63324/bootstrap/<token>` with token from `data/runtime/instance.json` (`rqsrODh-AM3cKFx5dldNhfy-BAnr6qvGuSGvzEbmSpc`). Kill it before swapping code (delete `data/runtime/instance.json` if stale). Start with `uv run whitebook --no-browser` from the repo root.
- Test packages in `data/` (Library shows all):
  - "Hardest SAT Math Questions" — 237 Math, PDF `cb15cb3d…pdf` (241 pages, **scanned, no text layer** except cover)
  - "August Math" — 201 Math (151 MC + 50 SPR), PDF `c9ca4b13…pdf` (203 pages, **scanned, no text layer**)
  - "August R&W" — 254 RW, PDF `46e7e83b…pdf` (254 pages, **scanned, no text layer**)
  - "Synthetic Practice Set" — 2 RW + 2 Math, PDF `2c564d4a…pdf` (4 pages, **has real text layer**) — good for fast GUI verification
- A synthetic Practice attempt is mid-flight (Q1 answered A, B eliminated) from GUI testing. It is disposable test data.
- GUI screenshots so far: `D:\Notion\UI\gui-test-screenshots\` (loading gate, player Q1).

## 3. Why text choices are impossible for the real banks

`pymupdf` text extraction probe: synthetic PDF = 594 chars; the three real banks = 0 chars (images only). The CSV contract (`docs/answer-csv.md`) stores only `correct_answer` (A–D), never choice text. Hence the region-image approach.

## 4. Code map (everything verified)

### Backend

- `src/whitebook/storage.py`
  - `SCHEMA_VERSION = "2"` (line 8). `question_regions` table (lines 47–59): columns `id, draft_id, question_index, ordinal, page_number, x, y, width, height, confirmed`, `UNIQUE(draft_id, question_index, ordinal)`. **No role column.**
  - `initialize_database` uses `CREATE TABLE IF NOT EXISTS` only — existing DBs won't gain a column without an explicit `ALTER TABLE`. Add migration: inspect `PRAGMA table_info(question_regions)` and `ALTER TABLE question_regions ADD COLUMN role TEXT NOT NULL DEFAULT 'question'`; bump `SCHEMA_VERSION` to `"3"`.
- `src/whitebook/app.py`
  - `QuestionRegionInput` (lines ~22–32): pydantic model, `extra="forbid"`, alias `pageNumber`, fields `x,y,width,height,confirmed`. **Add `role: str = "question"` and validate it is `"stimulus" | "question"`.** Endpoint `PUT /api/import-drafts/{draft_id}/questions/{question_index}/regions` (line ~301).
- `src/whitebook/authoring.py`
  - `set_question_regions` (lines ~257–331): validates geometry against page bounds, deletes+reinserts region rows. Persist `role` here.
  - `_questions_with_regions` (lines ~520–558): builds the region dicts consumed by the frontend (`id, ordinal, pageNumber, x, y, width, height, confirmed`). Add `"role": row["role"]`.
  - `publish` (lines ~333–435): copies `draft.questions[index]["regions"]` verbatim into `manifest_json`/`regions_json`, so role flows into published packages automatically once `_questions_with_regions` emits it.
- `src/whitebook/attempts.py` and `src/whitebook/backups.py`: regions pass through as opaque dicts (attempt plans, results, backup/restore). **No changes needed.**
- Results view also embeds regions (`attempts.py` ~line 1036) — inherits the new rendering automatically if the Results screen reuses the same split logic.

### Frontend

- `web/src/types.ts`: `Region` type (lines 8–17) — add `role?: "stimulus" | "question"`.
- `web/src/pdf.tsx`: `RegionCrop` renders a region as an `<img class="region-crop">` via canvas render → object URL (CSP already allows `img-src … data: blob:`). Reusable as-is for the right panel.
- `web/src/screens/Mapper.tsx` (323 lines):
  - `save()` (lines ~92–120) strips regions to `{pageNumber,x,y,width,height,confirmed}` — must include `role`.
  - Region editor rows (lines ~190–243): add a role toggle per region (Stimulus / Question), default new draws to `"question"`. Region boxes on the page (`region-box` spans in `pdf.tsx`) could get a color/label per role for clarity.
  - "Player preview" section (lines ~244–269): optionally show the split preview (stimulus left, question crop + disabled A–D right).
- `web/src/screens/Player.tsx` (579 lines):
  - Left panel = `question-viewer` renders `question.regions.map(RegionCrop)` (lines ~357–368) with zoom toolbar.
  - Right panel = `response-panel` (lines ~396–482): banner (number, Mark for Review, category) → `<h1>Select one answer>` → A–D radios with Eliminate buttons.
  - Change: partition regions —
    - `stimuli = regions.filter(r => r.role === "stimulus")`
    - `questionRegions = regions.filter(r => r.role === "question")`
    - **Backward-compat rule (decided):** if the question has **no** region with `role === "stimulus"` (all legacy rows default to `'question'`), render legacy behavior (all regions left, bare choices right). Only when at least one stimulus exists: left shows stimuli, right shows `questionRegions` as image crops between the banner and the "Select one answer" heading, then the A–D controls.
  - Right-panel crop should span panel width; keep left zoom controls as-is.
- `web/src/screens/Results.tsx`: review shows question regions — apply the same partition for consistency.

### Styles

- `web/src/styles.css`: right-panel crop styling (`.response-panel .region-crop { width: 100% }` or a wrapper), stimulus/question region-box color coding in the Mapper, and spacing so the right panel scrolls independently (it already is a grid column).

### Docs

- `docs/answer-csv.md` or new `docs/question-regions.md`: document the two-region workflow (stimulus = passage/stimulus → left; question = stem + choices → right; legacy single-region packages keep working).

## 5. Tests to add

- Backend (`tests/test_authoring_api.py` style): PUT regions with `role` values → draft + published package emit `role`; invalid role rejected (422); legacy PUT without role still succeeds (defaults to `question`).
- Migration test: create DB with old schema (or open the existing `data/whitebook.sqlite3` copy), run `initialize_database`, assert `role` column exists with default `'question'`.
- Frontend (`web/src/player.test.tsx`): player renders split layout when a stimulus region exists (stimulus img left, question img above choices right); legacy rendering when roles absent.
- Existing suites must stay green: `uv run pytest -q`, `npm --prefix web test`, `npm run build`, `uv run ruff check src tests`.

## 6. Verification plan after implementation

1. Rebuild (`npm run build`), restart server, re-open bootstrap URL.
2. Create a fresh import draft of the Synthetic PDF (has text) OR better: re-map the Synthetic package if a draft exists; draw two regions per question (stimulus + question), publish.
3. GUI-verify with screenshots at 1440×900: Bluebook-style split on RW and Math questions (Math SPR shows the input box below the question crop), zoom on left, eliminate/restore still working, navigator, submit → Results shows split too.
4. Spot-check a scanned bank (e.g., August R&W pages 1–3) by re-importing or re-mapping a few questions to prove the two-region workflow works on scans.
5. Then resume the original user request: sweep every question of the three big banks (237 + 201 + 254) in a drill, verifying each renders and accepts an answer; screenshot evidence into `gui-test-screenshots/`.

## 7. Working rules / gotchas

- GUI testing must stay black-box (no JS injection into the page; Playwright locators from DOM snapshots only; screenshots for visual claims). Browser tooling: ZCode in-app browser via `mcp__node_repl__js` with the browser-use bootstrap; file upload through the GUI is unsupported by the IAB backend — import drafts can be created via the API (`POST /api/import-drafts` with multipart PDF+CSV) as environment prep, which is allowed.
- The server binds to an OS-picked loopback port and writes `data/runtime/instance.json`; a second launch just prints the existing URL. The app authorizes the browser via the one-time bootstrap token; direct `/app/` URLs 403 without it.
- Don't edit `data/whitebook.sqlite3` by hand; don't commit `.env` (holds the Desmos key) or `data/`.
- The existing mid-flight attempt predates any schema change; simplest is to pause/abandon it after restarting the server.
