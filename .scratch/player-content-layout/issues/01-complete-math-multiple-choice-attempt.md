# 01 — Complete one Math multiple-choice Practice Attempt

**What to build:** A learner can complete a published Math multiple-choice question in a centered column, with the stem above four answer boxes containing their actual content. Clicking a box selects its answer; elimination and saving remain reliable.

**Blocked by:** None — can start immediately.

**Status:** resolved

Implementation started after the user selected this ticket. Scope is the first vertical slice, not bank conversion or the later split layouts.

- [x] Versioned presentation accepts ordered text and Source PDF crops for the stem and individual A–D answers, rejects invalid content, and survives publication. (`tests/test_question_presentation_api.py`, `src/whitebook/question_presentation.py`)
- [x] Required presentation crops pass the Attempt Loading Gate before Begin is available. (`LoadingGate.tsx`, `prepareQuestionRegions`; `math-presentation.test.tsx`, `player.test.tsx`)
- [x] The centered Math player has full-box native radio interaction, readable selection/elimination/focus states, and no empty passage pane or content zoom. (`QuestionContent.tsx`, `math-presentation.css`)
- [x] Responses and review state survive saving/reopening, and the Attempt completes with unchanged grading and presentation retained in its result. (`test_presented_math_question_survives_publication_and_completed_attempt`)
- [x] Missing Math multiple-choice content is explained instead of displaying bare answer boxes. (`presentationIssue` blocks the gate and explains in the player.)
- [x] HTTP API lifecycle tests and player interaction tests pass; typechecking, build, and full suites pass at completion. (vitest 42, pytest 113, `tsc -b`, `vite build` clean.)
- [x] Laptop visual verification uses representative published content at 1024×768 and 1440×900. (`.scratch/player-content-layout/shots/` via `.scratch/shotenv/capture-layout.cjs`.)

Testing seams: existing authoring/Attempt HTTP endpoints and user-visible player/loading controls. Full Results layout changes, package revisions, historical compatibility, and bank conversion belong to subsequent tickets.

## Comments

- 2026-09-05: Verified and resolved together with tickets 02–07; the centered Math composition now lives behind `playerLayout` alongside the later split layouts.
