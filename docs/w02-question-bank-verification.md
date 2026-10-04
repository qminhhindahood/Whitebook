# W02 Question Bank and passage search release evidence

Date: 2026-10-04 (Asia/Bangkok). Scope: `.scratch/website-visual-refresh/issues/02-question-bank.md` and its approved parent specification. Review baseline: `c0e0ceb9781b50f1b6a9ac2b7dc7725ac2c756c9`.

The Question Bank search, filter, and viewer implementation is complete and verified. This evidence confirms website runtime and API readiness independently of bulk content OCR, crop repair, or replacement publication releases.

## Delivered behavior

- **Reviewed passage-only search:** Matches word sequences in reviewed passage text (`stimulus` blocks of kind `text` or `reviewed_text`, plus explicit `publication_passage_search` entries for reviewed image-passage fallback). Prompts, answer choices, explanations, and figure labels are strictly excluded from search indexing. Search queries are Unicode NFKC normalized, case-folded, and matched on whole word boundaries.
- **Entitled browse and filters:** Search scope is restricted to the newest published or privately entitled revision per family. Users can browse without a query using Bank, Section, Category, Response Type, Visuals presence, and Source Question Number filters.
- **Provenance and snippets:** Results list question source provenance (package title, published revision, source ID, module, ordinal, question number, category, response type, visual indicator) and an excerpt snippet centered on the matching passage text.
- **Question Bank Viewer:** Opens selected questions in the full practice/exam composition (resizable split pane for Reading and Writing or questions with visual figures; centered layout for text-only Math). Temporary answer selection, option elimination, student-produced response entry and formatted preview, figure controls (inline zoom, pan, reset via keyboard and pointer), and global content zoom (90%–150%). Calculator and References are excluded from the viewer as specified.
- **Separate Show/Hide Answer endpoint:** Answer reveals require a dedicated authenticated request to `/api/library/:revisionId/questions/:questionId/answer`. Returns reviewed choice content for multiple-choice questions or accepted answer strings for student-produced responses. Active-Attempt and Question Bank search payloads never include answer keys. Revealing resets to hidden upon navigating to another question. Missing reviewed keys gracefully return `answer_unavailable`.
- **Navigation and state preservation:** Returning from question viewing restores the search query, active filters, scroll position, and focused result button.
- **Zero test/attempt side effects:** Question Bank search and viewer operations create no Attempts, timers, grades, review statistics, or durable Attempt annotations.

## Automated verification

- **Full web test suite:** 41 test files, 228 tests passed (`npm --prefix web test`).
  - `web/src/account/QuestionBankViewer.test.tsx` (4 tests passed): verifies split layout for image questions, choice-image split, centered text-only Math, and R&W passage split.
  - `web/src/account/CuratedLibrary.test.tsx` (3 tests passed): verifies searching with filters, temporary question controls, answer reveal/hide/reset on navigation, and result restoration.
- **Full hosted test suite:** 22 test files, 232 tests passed, 1 skipped; 7 Node unit tests passed (`npm --prefix hosted test`).
  - `hosted/test/questionBank.integration.test.ts` (4 integration tests passed): verifies passage-only matching, filter combinations, pagination, entitlement enforcement, answer-key separation, fallback transcription indexing, and absence of Attempt creation side effects.
- **TypeScript checks:**
  - `npm --prefix web run typecheck`: clean, 0 errors.
  - `npm --prefix hosted run typecheck`: clean, 0 errors.
- **Python publication test suite:**
  - `hosted/test/test_prepare_publication.py`: 11 tests passed in 33s, including `test_publishes_reviewed_fallback_passage_separately_from_presentation_and_keys`.
- **Full release build:**
  - `npm --prefix hosted run build`: web staging bundle built cleanly in 483ms, staged 2,272 files / 260,980,875 bytes for `reviewed-five-20260927`.
