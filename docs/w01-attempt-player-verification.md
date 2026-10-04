# W01 Attempt player release evidence

Date: 2026-10-04 (Asia/Bangkok). Scope: `.scratch/website-visual-refresh/issues/01-attempt-ui.md` and its approved parent specification. Review baseline: `beeba96578a40982bd0531c2d3cb0defa96b000a`.

The desktop/tablet website implementation is ready for release. This evidence does not approve OCR text, repaired crops, answer keys, categories, or replacement publication revisions. No deployment or content activation was performed. Existing Attempts continue to use their immutable content revision.

## Delivered behavior

- Persistent player header/footer across questions, paused Section Exams, and untimed module transitions; Directions, timer visibility, keyboard-resizable R&W split panes, centered Math/SPR, separate answer and elimination targets, flags, and question grids.
- End-of-module/Practice review with unanswered and flagged counts, an explicit irreversible finish confirmation, save/exit feedback, Section Exam pause/resume through the existing loading gate, and SPR guidance/preview.
- Content zoom, inline figure zoom/reset and an image dialog with fullscreen, zoomable References, and Graphing/Scientific calculator modes with native resizing and a keyboard width slider.
- Selection-anchored yellow/blue/pink/none marks, solid/dashed/no underline, deletion, attached note editing/deletion, and a collapsible quoted-span sidebar. Text spans can overlap across reviewed source-format runs. Source emphasis, underlining, blanks, paragraph breaks, KaTeX, and image fallback remain available.
- Rich annotations retain an id, immutable revision id, block/range or normalized image region, exact quote, color, underline, and bounded note. The API validates rich anchors against the Attempt's published content. Legacy saved highlights remain supported. Existing account ownership, editor lease, state-version conflicts, timing, module locks, grading, and evidence eligibility remain authoritative.
- Response and annotation drafts coalesce through the existing save queue and flush before navigation, pause, exit, and submission. Each new Attempt starts clean. Notes typed without clicking Save note still join the durable save queue.

## Browser verification

The local rehearsal served the built hosted website and real worker API over `http://localhost:8801`, backed by disposable in-memory SQLite, publication migrations, and the existing private published release. The first R&W passage was replaced only in this isolated harness with a clearly labelled synthetic fixture to exercise selectable text and source formatting. No production account or data was modified.

Desktop and tablet journeys covered:

1. R&W Practice: create through loading gate; mark/underline/note; independent answer, elimination and flag; keyboard pane resizing; navigate away/back; confirm save/exit; refresh and resume with persisted state; content zoom with persistent chrome and no document horizontal overflow.
2. Same account in a second browser tab with independent editor session: read-only saved annotations, explicit takeover, edit/delete/re-add note, save/exit; first device refresh reads the second device's update. API tests cover stale-token and stale-version rejection and other-account isolation.
3. Review Practice: counts and grid, separate lock/submit confirmation, completed grading and read-only answers. Completed-review annotations remain excluded.
4. Math Section Exam: centered SPR, guidance and response preview; Scientific expression `2+2`; keyboard calculator width; Reference zoom/reset/Escape; inline figure zoom/reset and actual image fullscreen; save/pause/exit; resume through loading gate preserving `3/4`; review/lock Module 1; untimed transition with persistent chrome; explicit continue starts Module 2's 35-minute timer; final review/confirmation completes grading for all 44 questions.
5. Fresh Practice Attempt: empty notes sidebar; double-click selection opens the toolbar; blue/solid mark with typed note. Tablet toolbar bounds were inside the observed viewport. Desktop/tablet screenshots are private/local evidence under `hosted/.scratch/w01-evidence/`.

Graphing was not configured in the disposable browser harness. Its readiness, unavailable state, sandbox integration, and persisted calculator behavior were exercised by existing tests; the browser verified the honest unavailable state and working Scientific mode. A configured production Graphing smoke check remains part of deployment verification.

## O01 contract compatibility

Reviewed O01's extraction contract v1 and pilot validation report. The identified `underline: true` run gap is addressed in `HostedPresentation` and `prepare-publication.py`, with a publication test rejecting non-boolean marks and a renderer/annotation test preserving source formatting across overlapping spans. Re-ran the four-question O01 schema pilot with zero errors and validated all 17 non-placeholder content blocks through the publication validator. The pilot's one `visual_placeholder` still requires W03/W04 crop assembly before publication; it is not silently flattened or accepted as a compiled asset. O01's static diagnostic still names the historical underline gap; this release supplies that support.

## Automated verification

- Full web suite: 40 files, 222 tests passed.
- Full hosted suite: 22 files, 231 passed, one intentionally skipped; seven Node checks passed. After adding the final Section Exam annotation persistence/lock case, targeted Attempt API suite: 45 passed.
- Hosted TypeScript check passed; final staging build includes the web TypeScript project check and passed.
- Python publication suite: eight passed, including source underline validation.
- Full hosted release build passed and staged the existing `reviewed-five-20260927` release: 2,272 files / 260,980,875 bytes. Final UI assets rebuilt after browser findings using `build:staging -- --emptyOutDir=false` against that staged content.
- Worker deployment dry run passed. Wrangler emitted the existing Smart Placement/static-assets warning; no upload/deployment occurred. Dry-run asset inventory also included retained incremental build chunks.
- Impeccable mechanical detector returned no findings for the changed player/annotation UI. Scoped whitespace check passed.

Logs are under `.scratch/website-visual-refresh/`: `web-full-tests.log`, `hosted-full-tests.log`, `w01-final-build.log`, `w01-worker-dry-run.log`, and `ui-detector.json`.

## Standards and specification review

Reviewed the W01 changes against repository/domain instructions and the approved specification in the primary session. No subagents were used, as requested. The review caught and corrected the transition footer's empty question count, tablet sidebar crowding, lost paragraph whitespace, image-fit sizing, and an overlong-selection save failure (the UI now asks for a span of at most 4,000 characters).

Standards: no unresolved actionable findings in W01's scoped diff. Private publication inputs, credentials, and unrelated account/Question Bank work are excluded from this commit.

Specification: no unresolved implementation findings in W01. Deployment smoke checks and bulk content review are separate gates. Phone-focused redesign, offline operation, and completed-review annotation display remain outside scope.
